import { describe, expect, it } from "vitest";
import type { Candle, EmaTrendStrategyConfig } from "@trend-trade/shared";
import { EmaTrendStrategy } from "./index";

const candles: Candle[] = [10, 10, 10, 20, 20, 18].map((close, index) => ({
  symbol: "ETH", timeframe: "1h", openTime: index * 3600000,
  closeTime: (index + 1) * 3600000 - 1,
  open: close, high: close + 1, low: close - 1, close, volume: 100
}));
const config: EmaTrendStrategyConfig = {
  type: "EMA_TREND", trendEmaPeriod: 3,
  atrPeriod: 2, atrMultiplier: 2, atrStopEnabled: false,
  adxPeriod: 2, adxThreshold: 20, adxFilterEnabled: false,
  volumeMaPeriod: 2, volumeMultiplier: 1, volumeFilterEnabled: false,
  direction: "LONG_SHORT", exitTrigger: "EMA"
};

describe("trend moving average selection", () => {
  it.each(["MA", "EMA"] as const)("detects gaps across %s without touching the average", (trendMaType) => {
    const gapCandles = [10, 10, 10, 20, 5].map((close, index) => ({
      ...candles[index], open: close, high: close + 0.1, low: close - 0.1, close
    }));
    const gapConfig = { ...config, trendMaType };
    const strategy = new EmaTrendStrategy(gapCandles, gapConfig);
    expect(strategy.generateSignal({ candles: gapCandles, index: 3, config: gapConfig })).toMatchObject({ type: "BUY", allowPositionFlip: true });
    expect(strategy.generateSignal({ candles: gapCandles, index: 4, config: gapConfig })).toMatchObject({ type: "SELL_SHORT", allowPositionFlip: true });
  });
  it("crosses below MA while remaining above EMA", () => {
    const maConfig = { ...config, trendMaType: "MA" as const };
    const ma = new EmaTrendStrategy(candles, maConfig);
    expect(ma.generateSignal({ candles, index: 5, config: maConfig })).toMatchObject({
      type: "SELL_SHORT", allowPositionFlip: true, reason: "Close crossed below MA3"
    });
    const emaConfig = { ...config, trendMaType: "EMA" as const };
    const ema = new EmaTrendStrategy(candles, emaConfig);
    expect(ema.generateSignal({ candles, index: 5, config: emaConfig }).type).toBe("HOLD");
  });

  it("defaults legacy configurations to EMA", () => {
    const legacy = new EmaTrendStrategy(candles, config);
    expect(legacy.generateSignal({ candles, index: 5, config }).type).toBe("HOLD");
    expect(legacy.generateSignal({ candles, index: 3, config })).toMatchObject({
      type: "BUY", reason: "Close crossed above EMA3"
    });
  });
});
