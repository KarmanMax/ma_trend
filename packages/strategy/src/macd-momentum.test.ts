import { describe, expect, it } from "vitest";
import type { Candle, MacdMomentumStrategyConfig } from "@trend-trade/shared";
import { MacdMomentumStrategy } from "./index";

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
