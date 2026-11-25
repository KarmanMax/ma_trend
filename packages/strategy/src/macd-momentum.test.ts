import { describe, expect, it } from "vitest";
import type { Candle, MacdMomentumStrategyConfig, MacdMomentumTrendStrategyConfig } from "@trend-trade/shared";
import { MacdMomentumStrategy, MacdMomentumTrendStrategy } from "./index";

const config: MacdMomentumStrategyConfig = {
  type: "MACD_MOMENTUM",
  macdFastPeriod: 2,
  macdSlowPeriod: 3,
  macdSignalPeriod: 2,
  zeroFilterEnabled: false,
  zeroProximityPct: 0.5,
  atrPeriod: 2,
  atrMultiplier: 2,
  atrStopEnabled: false,
  adxPeriod: 2,
  adxThreshold: 20,
  adxFilterEnabled: false,
  volumeMaPeriod: 2,
  volumeMultiplier: 1,
  volumeFilterEnabled: false,
  direction: "LONG_SHORT",
  exitTrigger: "MACD_MOMENTUM"
};

function candles(closes: number[]): Candle[] {
  return closes.map((close, index) => ({
    symbol: "ETH",
    timeframe: "1h",
    openTime: index * 3_600_000,
    closeTime: (index + 1) * 3_600_000 - 1,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100
  }));
}

function signals(closes: number[], options: MacdMomentumStrategyConfig = config) {
  const bars = candles(closes);
  const strategy = new MacdMomentumStrategy(bars, options);
  return bars.map((_, index) => strategy.generateSignal({ candles: bars, index, config: options }));
}

describe("MACD histogram momentum reversal signals", () => {
  it("requires the current histogram slope to confirm the deferred direction", () => {
    const bars = candles([10, 10, 10, 9, 10, 10, 13, 13, 11]);
    const strategy = new MacdMomentumStrategy(bars, config);
    expect(strategy.revalidateEntry(6, "BUY")).toMatchObject({ type: "BUY" });
    expect(strategy.revalidateEntry(7, "BUY")).toBeNull();
    expect(strategy.revalidateEntry(7, "SELL_SHORT")).toMatchObject({ type: "SELL_SHORT" });
    expect(strategy.revalidateEntry(8, "SELL_SHORT")).toBeNull();
  });
  it("buys and sells when positive histogram bars switch between hollow and solid", () => {
    const result = signals([10, 10, 10, 9, 10, 10, 13, 13, 11]);

    expect(result[6]).toMatchObject({ type: "BUY", allowPositionFlip: true });
    expect(result[7]).toMatchObject({ type: "SELL_SHORT", allowPositionFlip: true });
    expect(result[8].type).toBe("HOLD");
  });

  it("maps negative histogram fill changes to their slope direction", () => {
    const result = signals([10, 10, 10, 8, 14, 12, 13, 10, 11]);

    expect(result[7].type).toBe("SELL_SHORT");
    expect(result[8].type).toBe("BUY");
  });

  it("preserves reverse exits when direction or entry filters block a trade", () => {
    const closes = [10, 10, 10, 9, 10, 10, 13, 13, 11];
    expect(signals(closes, { ...config, direction: "SHORT_ONLY" })[6].type).toBe("CLOSE_SHORT");
    expect(signals(closes, { ...config, zeroFilterEnabled: true, zeroProximityPct: 0 })[6].type).toBe("CLOSE_SHORT");
    expect(signals(closes, { ...config, direction: "SHORT_ONLY", exitTrigger: "NONE" })[6].type).toBe("HOLD");
  });
});

const trendConfig: MacdMomentumTrendStrategyConfig = {
  ...config, type: "MACD_MOMENTUM_TREND", trendEmaPeriod: 4, exitTrigger: "MACD_MOMENTUM_TREND"
};
const combinedCloses = [11, 12, 8, 10, 11, 15, 15, 14, 15, 12];

function trendSignals(closes: number[], options: MacdMomentumTrendStrategyConfig = trendConfig) {
  const bars = candles(closes);
  const strategy = new MacdMomentumTrendStrategy(bars, options);
  return bars.map((_, index) => strategy.generateSignal({ candles: bars, index, config: options }));
}

describe("MACD momentum with EMA trend confirmation", () => {
  it("trades aligned turns in both directions and ignores wrong-side turns and zero crossings", () => {
    const result = trendSignals(combinedCloses);
    expect(result[5]).toMatchObject({ type: "BUY", allowPositionFlip: true });
    expect(result[6].type).toBe("HOLD"); // Bearish turn with price still above EMA.
    expect(result[7].type).toBe("HOLD"); // Histogram crosses zero.
    expect(result[9]).toMatchObject({ type: "SELL_SHORT", allowPositionFlip: true });

    const zeroCross = [10, 10, 10, 9, 10, 10, 13, 13, 11];
    expect(trendSignals(zeroCross)[8].type).toBe("HOLD"); // Price and histogram both cross down.
  });

  it("waits for both indicators and treats a close on the EMA as neutral", () => {
    expect(trendSignals(combinedCloses)[4]).toMatchObject({ type: "HOLD", reason: "Waiting for MACD histogram warmup" });
    expect(trendSignals(combinedCloses, { ...trendConfig, trendEmaPeriod: 10 })[5])
      .toMatchObject({ type: "HOLD", reason: "Waiting for EMA trend warmup" });
    expect(trendSignals(combinedCloses, { ...trendConfig, trendEmaPeriod: 1 })[5].type).toBe("HOLD");
  });

  it("does not replay a wrong-side turn when the trend aligns on a later bar", () => {
    const closes = [15, 16, 9, 12, 8, 9, 16];
    expect(signals(closes)[5].type).toBe("BUY");
    expect(trendSignals(closes).slice(5).map(({ type }) => type)).toEqual(["HOLD", "HOLD"]);
  });

  it.each([
    { direction: "LONG_ONLY" },
    { zeroFilterEnabled: true, zeroProximityPct: 0 },
    { adxFilterEnabled: true, adxThreshold: 100 },
    { volumeFilterEnabled: true, volumeMultiplier: 2 },
    { levelFilterEnabled: true }
  ] satisfies Partial<MacdMomentumTrendStrategyConfig>[])("preserves combined exits with %o", (options) => {
    const strategy = { ...trendConfig, ...options };
    expect(trendSignals(combinedCloses, strategy)[9].type).toBe("CLOSE_LONG");
    expect(trendSignals(combinedCloses, { ...strategy, exitTrigger: "NONE" })[9].type).toBe("HOLD");
  });

  it("rechecks the EMA side and same-side histogram slope before resuming a pending entry", () => {
    const bars = candles(combinedCloses);
    const strategy = new MacdMomentumTrendStrategy(bars, { ...trendConfig, lossCooldownBars: 1, resumeEntryAfterCooldown: true });
    expect(strategy.revalidateEntry(5, "BUY")).toMatchObject({ type: "BUY" });
    expect(strategy.revalidateEntry(6, "BUY")).toBeNull(); // EMA agrees, slope disagrees.
    expect(strategy.revalidateEntry(6, "SELL_SHORT")).toBeNull(); // Slope agrees, EMA disagrees.
    expect(strategy.revalidateEntry(9, "SELL_SHORT")).toMatchObject({ type: "SELL_SHORT" });
  });
});
