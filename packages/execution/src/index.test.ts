import { expect, it } from "vitest";
import { SimulatedPortfolio } from "@trend-trade/portfolio";
import type { Candle } from "@trend-trade/shared";
import { SimulatedExecutionEngine } from "./index";

it.each(["LONG", "SHORT"] as const)("executes a %s gap stop then the closing reverse signal", (side) => {
  const portfolio = new SimulatedPortfolio(10000);
  portfolio.onFill({ type: side === "LONG" ? "OPEN_LONG" : "OPEN_SHORT", symbol: "QQQ",
    time: 0, price: 100, quantity: 10, fee: 0, stopPrice: side === "LONG" ? 95 : 105 });
  const open = side === "LONG" ? 90 : 110;
  const candle: Candle = { symbol: "QQQ", timeframe: "1d", openTime: 100, closeTime: 200,
    open, high: open + 2, low: open - 2, close: open + 1, volume: 100 };
  new SimulatedExecutionEngine({ feeRate: 0, slippageRate: 0, positionSizing: "ALL_IN" }).execute({
    candle, portfolio, signal: { type: side === "LONG" ? "SELL_SHORT" : "BUY", allowPositionFlip: true, reason: "Trend cross" }
  });
  expect(portfolio.getTrades()[0]).toMatchObject({ exitPrice: open, exitTime: 100, exitReason: "STOP_LOSS" });
  expect(portfolio.getOpenPosition()).toMatchObject({ side: side === "LONG" ? "SHORT" : "LONG", entryPrice: open + 1, entryTime: 200 });
});
