import { describe, expect, it } from "vitest";
import type { Candle, MacdTrendStrategyConfig } from "@trend-trade/shared";
import { MacdTrendStrategy } from "./index";

const candles: Candle[] = [10, 10, 10, 10, 12, 10].map((close, index) => ({
  symbol: "ETH", timeframe: "1h", openTime: index * 3_600_000,
  closeTime: (index + 1) * 3_600_000 - 1,
  open: close, high: close + 1, low: close - 1, close, volume: 100
}));

const config: MacdTrendStrategyConfig = {
  type: "MACD_TREND", macdFastPeriod: 2, macdSlowPeriod: 3, macdSignalPeriod: 2,
  zeroFilterEnabled: false, zeroProximityPct: 0.5,
  atrPeriod: 2, atrMultiplier: 2, atrStopEnabled: false,
  adxPeriod: 2, adxThreshold: 20, adxFilterEnabled: false,
  volumeMaPeriod: 2, volumeMultiplier: 1, volumeFilterEnabled: false,
  direction: "LONG_SHORT", exitTrigger: "MACD"
};

function signal(index: number, options: MacdTrendStrategyConfig = config) {
  return new MacdTrendStrategy(candles, options).generateSignal({ candles, index, config: options });
}

describe("MACD trend signals", () => {
  it("waits for the signal line, then trades golden and death crosses", () => {
    expect(signal(2).type).toBe("HOLD");
    expect(signal(4)).toMatchObject({ type: "BUY", allowPositionFlip: true });
    expect(signal(5)).toMatchObject({ type: "SELL_SHORT", allowPositionFlip: true });
  });

  it("limits entries to the configured distance from zero while preserving reverse exits", () => {
    const options = { ...config, zeroFilterEnabled: true, zeroProximityPct: 0.1 };
    expect(signal(4, options).type).toBe("CLOSE_SHORT");
    expect(signal(5, options).type).toBe("CLOSE_LONG");
    expect(signal(4, { ...options, zeroProximityPct: 3 }).type).toBe("BUY");
  });

  it("does not emit a reverse exit when it is disabled", () => {
    expect(signal(5, { ...config, direction: "LONG_ONLY", exitTrigger: "NONE" }).type).toBe("HOLD");
    expect(signal(5, { ...config, direction: "LONG_ONLY" }).type).toBe("CLOSE_LONG");
  });
});
