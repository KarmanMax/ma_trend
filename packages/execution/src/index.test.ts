import { expect, it } from "vitest";
import { SimulatedPortfolio } from "@trend-trade/portfolio";
import type { Candle, EntrySignalType, Signal } from "@trend-trade/shared";
import { SimulatedExecutionEngine } from "./index";

it.each(["LONG", "SHORT"] as const)("executes a %s gap stop then the closing reverse signal", (side) => {
  const portfolio = new SimulatedPortfolio(10000);
  portfolio.onFill({ type: side === "LONG" ? "OPEN_LONG" : "OPEN_SHORT", symbol: "QQQ",
    time: 0, price: 100, quantity: 10, fee: 0, stopPrice: side === "LONG" ? 95 : 105 });
  const open = side === "LONG" ? 90 : 110;
  const candle: Candle = { symbol: "QQQ", timeframe: "1d", openTime: 100, closeTime: 200,
    open, high: open + 2, low: open - 2, close: open + 1, volume: 100 };
  new SimulatedExecutionEngine({ feeRate: 0, slippageRate: 0, positionSizing: "ALL_IN", lossCooldownBars: 0 }).execute({
    candle, portfolio, signal: { type: side === "LONG" ? "SELL_SHORT" : "BUY", allowPositionFlip: true, reason: "Trend cross" }
  });
  expect(portfolio.getTrades()[0]).toMatchObject({ exitPrice: open, exitTime: 100, exitReason: "STOP_LOSS" });
  expect(portfolio.getOpenPosition()).toMatchObject({ side: side === "LONG" ? "SHORT" : "LONG", entryPrice: open + 1, entryTime: 200 });
});

function setupCooldown(
  feeRate = 0, slippageRate = 0, revalidateEntry?: (type: EntrySignalType) => Signal | null, keepCooldownSignalsByDirection = false
) {
  const portfolio = new SimulatedPortfolio(10_000);
  const engine = new SimulatedExecutionEngine({
    feeRate, slippageRate, positionSizing: "ALL_IN", lossCooldownBars: 3, keepCooldownSignalsByDirection
  });
  const execute = (index: number, close: number, signal: Signal, prices?: Pick<Candle, "open" | "high" | "low">) => {
    const candle: Candle = {
      symbol: "QQQ", timeframe: "1d", openTime: index * 100, closeTime: (index + 1) * 100 - 1,
      open: close, high: close, low: close, close, volume: 100, ...prices
    };
    engine.execute({ candle, signal, portfolio, revalidateEntry });
  };
  return { portfolio, execute };
}

it("executes the ATR stop and skips the same bar plus exactly three following bars", () => {
  const { portfolio, execute } = setupCooldown();
  const reverse: Signal = { type: "SELL_SHORT", allowPositionFlip: true };
  execute(0, 100, { type: "BUY", stopPrice: 95 });
  execute(1, 100, reverse, { open: 94, high: 101, low: 93 });
  expect(portfolio.getTrades()[0]).toMatchObject({ exitReason: "STOP_LOSS", exitPrice: 94, exitTime: 100 });
  expect(portfolio.getOpenPosition()).toBeNull();
  execute(2, 100, reverse);
  execute(3, 100, { type: "HOLD" });
  execute(4, 100, reverse);
  expect(portfolio.getTrades()).toHaveLength(1);
  execute(5, 100, { type: "HOLD" });
  expect(portfolio.getOpenPosition()).toBeNull();
  execute(6, 100, reverse);
  expect(portfolio.getOpenPosition()).toMatchObject({ side: "SHORT", entryTime: 699 });
});

it.each(["SELL_SHORT", "CLOSE_LONG"] as const)("starts cooldown on a net loss from %s after fees and slippage", (type) => {
  const { portfolio, execute } = setupCooldown(0.001, 0.0005);
  execute(0, 100, { type: "BUY" });
  execute(1, 100.25, { type, allowPositionFlip: true });
  const [trade] = portfolio.getTrades();
  expect(trade.exitReason).toBe("SIGNAL");
  expect(trade.grossPnl).toBeGreaterThan(0);
  expect(trade.netPnl).toBeLessThan(0);
  expect(portfolio.getOpenPosition()).toBeNull();
  execute(2, 101, { type: "BUY" });
  expect(portfolio.getOpenPosition()).toBeNull();
  execute(3, 101, { type: "HOLD" });
  execute(4, 101, { type: "HOLD" });
  execute(5, 101, { type: "BUY" });
  expect(portfolio.getOpenPosition()).toMatchObject({ side: "LONG", entryTime: 599 });
});

it.each([100, 99])("allows a profitable or flat short to flip at %d", (close) => {
  const { portfolio, execute } = setupCooldown();
  execute(0, 100, { type: "SELL_SHORT" });
  execute(1, close, { type: "BUY", allowPositionFlip: true });
  expect(portfolio.getTrades()[0].netPnl).toBeGreaterThanOrEqual(0);
  expect(portfolio.getOpenPosition()).toMatchObject({ side: "LONG", entryTime: 199 });
});

it("rechecks only the most recent blocked entry on the first eligible bar", () => {
  const checked: EntrySignalType[] = [];
  const { portfolio, execute } = setupCooldown(0, 0, (type) => {
    checked.push(type);
    return { type, stopPrice: 95 };
  });
  execute(0, 100, { type: "BUY" });
  execute(1, 90, { type: "SELL_SHORT", allowPositionFlip: true, stopPrice: 97 });
  execute(2, 100, { type: "HOLD" });
  execute(3, 100, { type: "BUY", stopPrice: 85 });
  execute(4, 100, { type: "HOLD" });
  expect(checked).toEqual([]);
  expect(portfolio.getOpenPosition()).toBeNull();
  execute(5, 100, { type: "HOLD" });
  expect(checked).toEqual(["BUY"]);
  expect(portfolio.getOpenPosition()).toMatchObject({ side: "LONG", entryTime: 599, stopPrice: 95 });
});

it.each([
  { older: "BUY", latest: "SELL_SHORT", side: "LONG", closeSignal: "CLOSE_LONG" },
  { older: "SELL_SHORT", latest: "BUY", side: "SHORT", closeSignal: "CLOSE_SHORT" }
] as const)("rechecks the retained $older after the newer $latest fails", ({ older, latest, side, closeSignal }) => {
  const checked: EntrySignalType[] = [];
  const { portfolio, execute } = setupCooldown(0, 0, (type) => {
    checked.push(type);
    return type === older ? { type } : null;
  }, true);
  execute(0, 100, { type: "BUY" });
  execute(1, 90, { type: "CLOSE_LONG" });
  execute(2, 100, { type: older });
  execute(3, 100, { type: latest });
  execute(4, 100, { type: closeSignal, trigger: { price: 99, at: "INTRABAR" } });
  expect(checked).toEqual([]);
  execute(5, 101, { type: latest, trigger: { price: 99, at: "INTRABAR" } });
  expect(checked).toEqual([latest, older]);
  expect(portfolio.getOpenPosition()).toMatchObject({ side, entryTime: 599, entryPrice: 101 });
});

it("checks each direction at most once and clears both candidates when neither passes", () => {
  const checked: EntrySignalType[] = [];
  const { portfolio, execute } = setupCooldown(0, 0, (type) => {
    checked.push(type);
    return null;
  }, true);
  execute(0, 100, { type: "BUY" });
  execute(1, 90, { type: "CLOSE_LONG" });
  execute(2, 100, { type: "BUY" });
  execute(3, 100, { type: "SELL_SHORT" });
  execute(4, 100, { type: "BUY" });
  execute(5, 100, { type: "HOLD" });
  execute(6, 100, { type: "HOLD" });
  expect(checked).toEqual(["BUY", "SELL_SHORT"]);
  expect(portfolio.getOpenPosition()).toBeNull();
});

it.each([false, true])("does not retry a pending entry that fails confirmation or receives a close signal (%s)", (cancel) => {
  const checked: EntrySignalType[] = [];
  const { portfolio, execute } = setupCooldown(0, 0, (type) => {
    checked.push(type);
    return checked.length === 1 ? null : { type };
  });
  execute(0, 100, { type: "BUY" });
  execute(1, 90, { type: "SELL_SHORT", allowPositionFlip: true });
  execute(2, 90, { type: cancel ? "CLOSE_SHORT" : "HOLD" });
  for (let index = 3; index <= 6; index += 1) {
    execute(index, 90, { type: "HOLD" });
  }
  expect(checked).toEqual(cancel ? [] : ["SELL_SHORT"]);
  expect(portfolio.getOpenPosition()).toBeNull();
});

it.each([
  { stopPrice: 95, reason: "SIGNAL", exitPrice: 100 },
  { stopPrice: 105, reason: "STOP_LOSS", exitPrice: 105 }
])("uses the nearer downside level before the other when a bar hits the stop and the MA", ({ stopPrice, reason, exitPrice }) => {
  const { portfolio, execute } = setupCooldown();
  execute(0, 110, { type: "BUY", stopPrice });
  execute(1, 92, { type: "CLOSE_LONG", trigger: { price: 100, at: "INTRABAR" } }, { open: 110, high: 111, low: 90 });
  expect(portfolio.getTrades()[0]).toMatchObject({ exitReason: reason, exitPrice });
});

it.each([
  { at: "OPEN", open: 100, close: 101, stopped: true },
  { at: "INTRABAR", open: 97, close: 101, stopped: false },
  { at: "INTRABAR", open: 97, close: 94, stopped: true }
] as const)("stops a new $at entry only when the stop is known to occur after the entry (close $close)", ({ at, open, close, stopped }) => {
  const { portfolio, execute } = setupCooldown();
  execute(1, close, { type: "BUY", stopPrice: 95, trigger: { price: 100, at } }, { open, high: 102, low: 93 });
  expect(portfolio.getTrades()[0]).toMatchObject({ entryPrice: 100, entryTime: at === "OPEN" ? 100 : 199 });
  if (stopped) {
    expect(portfolio.getTrades()[0]).toMatchObject({ exitReason: "STOP_LOSS", exitPrice: 95, exitTime: 199 });
  } else {
    expect(portfolio.getOpenPosition()?.side).toBe("LONG");
  }
});

it("gives the protective stop priority over a failed breakout exit", () => {
  const { portfolio, execute } = setupCooldown();
  execute(1, 94, { type: "BUY", stopPrice: 95, trigger: { price: 100, at: "OPEN" }, entryInvalidationLevel: 99 },
    { open: 100, high: 102, low: 93 });
  expect(portfolio.getTrades()[0]).toMatchObject({ exitPrice: 95, exitReason: "STOP_LOSS" });
});

it("starts loss cooldown on a failed breakout exit and skips an existing position", () => {
  const { portfolio, execute } = setupCooldown();
  const breakout: Signal = { type: "BUY", trigger: { price: 100, at: "OPEN" }, entryInvalidationLevel: 100 };
  execute(0, 99, breakout, { open: 100, high: 101, low: 98 });
  expect(portfolio.getTrades()[0]).toMatchObject({ exitPrice: 99, exitReason: "FAILED_BREAKOUT" });
  execute(1, 101, { type: "BUY" });
  execute(2, 101, { type: "HOLD" });
  execute(3, 101, { type: "HOLD" });
  expect(portfolio.getOpenPosition()).toBeNull();
  execute(4, 101, { type: "BUY" });
  execute(5, 99, breakout, { open: 100, high: 101, low: 98 });
  expect(portfolio.getOpenPosition()).toMatchObject({ side: "LONG", entryTime: 499 });
});
