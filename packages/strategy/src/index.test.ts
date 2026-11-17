import { describe, expect, it } from "vitest";
import { atr } from "@trend-trade/indicator";
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
  it.each(["BUY", "SELL_SHORT"] as const)("rejects %s cooldown entries only when momentum aligns and distance is at least 2 ATR", (type) => {
    const options = {
      ...config, trendMaType: "MA" as const, trendEmaPeriod: 10, atrPeriod: 1, filterExtendedCooldownEntries: true
    };
    const createBars = (base: number, halfRange: number) =>
      [base, ...Array(10).fill(100), ...Array(8).fill(105), 130, 130].map((value, index): Candle => {
        const close = type === "BUY" ? value : 200 - value;
        return {
          symbol: "ETH", timeframe: "1h", openTime: index * 3_600_000, closeTime: (index + 1) * 3_600_000 - 1,
          open: close, close, high: close + halfRange, low: close - halfRange, volume: 100
        };
      });
    const bars = createBars(100, 5);
    const strategy = new EmaTrendStrategy(bars, options);
    const unfiltered = new EmaTrendStrategy(bars, { ...options, filterExtendedCooldownEntries: false });
    const index = bars.length - 1;

    expect(strategy.revalidateEntry(index, type)).toBeNull();
    expect(unfiltered.revalidateEntry(index, type)?.type).toBe(type);
    expect(new EmaTrendStrategy(createBars(100, 6), options).revalidateEntry(index, type)?.type).toBe(type);
    expect(new EmaTrendStrategy(createBars(135, 5), options).revalidateEntry(index, type)?.type).toBe(type);
    expect(new EmaTrendStrategy(createBars(130, 5), options).revalidateEntry(index, type)?.type).toBe(type);
    for (let i = 0; i < bars.length; i += 1) {
      expect(strategy.generateSignal({ candles: bars, index: i, config: options }))
        .toEqual(unfiltered.generateSignal({ candles: bars, index: i, config: options }));
    }
  });

  it("prices a deferred ATR stop from the confirmation bar", () => {
    const options = { ...config, trendMaType: "MA" as const, atrStopEnabled: true };
    const strategy = new EmaTrendStrategy(candles, options);
    const confirmed = strategy.revalidateEntry(4, "BUY");
    const currentAtr = atr(candles, options.atrPeriod)[4]!;
    expect(confirmed?.stopPrice).toBeCloseTo(candles[4].close - currentAtr * options.atrMultiplier);
    expect(confirmed?.stopPrice).not.toBe(strategy.generateSignal({ candles, index: 3, config: options }).stopPrice);
  });

  it.each(["MA", "EMA"] as const)("applies entry filters to %s even with two-sided reversals enabled", (trendMaType) => {
    const bars = candles.map((bar, index) => {
      if (index === 3) return { ...bar, volume: 1 };
      if (index === 4) return { ...bar, open: 5, high: 6, low: 4, close: 5 };
      return bar;
    });
    const lowVolumeConfig = { ...config, trendMaType, volumeFilterEnabled: true };
    const strategy = new EmaTrendStrategy(bars, lowVolumeConfig);
    expect(strategy.generateSignal({ candles: bars, index: 3, config: lowVolumeConfig }).type).toBe("BUY");
    expect(strategy.generateSignal({ candles: bars, index: 4, config: lowVolumeConfig })).toMatchObject({
      type: "CLOSE_LONG", reason: expect.stringContaining("Volume below"), trigger: { price: 5, at: "OPEN" }
    });
  });

  it.each([
    { adxFilterEnabled: true, adxThreshold: 100 },
    { atrStopEnabled: true, atrPeriod: 10 }
  ])("can exit despite an entry filter failure (%j)", (filter) => {
    for (const exitTrigger of ["EMA", "NONE"] as const) {
      const options = { ...config, ...filter, exitTrigger };
      const strategy = new EmaTrendStrategy(candles, options);
      expect(strategy.generateSignal({ candles, index: 3, config: options }).type).toBe(exitTrigger === "EMA" ? "CLOSE_SHORT" : "HOLD");
    }
  });

  it.each(["MA", "EMA"] as const)("detects gaps across %s without touching the average", (trendMaType) => {
    const gapCandles = [10, 10, 10, 20, 5].map((close, index) => ({
      ...candles[index], open: close, high: close + 0.1, low: close - 0.1, close
    }));
    const gapConfig = { ...config, trendMaType };
    const strategy = new EmaTrendStrategy(gapCandles, gapConfig);
    expect(strategy.generateSignal({ candles: gapCandles, index: 3, config: gapConfig })).toMatchObject({ type: "BUY", trigger: { price: 20, at: "OPEN" } });
    expect(strategy.generateSignal({ candles: gapCandles, index: 4, config: gapConfig })).toMatchObject({ type: "SELL_SHORT", trigger: { price: 5, at: "OPEN" } });
  });
  it("touches the previous EMA while staying above the previous MA", () => {
    const maConfig = { ...config, trendMaType: "MA" as const };
    const ma = new EmaTrendStrategy(candles, maConfig);
    expect(ma.generateSignal({ candles, index: 5, config: maConfig }).type).toBe("HOLD");
    const emaConfig = { ...config, trendMaType: "EMA" as const };
    const ema = new EmaTrendStrategy(candles, emaConfig);
    expect(ema.generateSignal({ candles, index: 5, config: emaConfig })).toMatchObject({
      type: "SELL_SHORT", allowPositionFlip: true, trigger: { price: 17.5, at: "INTRABAR" }
    });
  });

  it.each(["MA", "EMA"] as const)("triggers on the exact %s touch even if price closes back below", (trendMaType) => {
    const bars = [10, 10, 10, 8, 8].map((close, index) => ({
      ...candles[index], close, open: close, low: close - 1, high: close + 1
    }));
    const options = { ...config, trendMaType, atrStopEnabled: true };
    const level = trendMaType === "MA" ? 28 / 3 : 9;
    bars[4].high = level;
    const strategy = new EmaTrendStrategy(bars, options);
    const priorAtr = atr(bars, options.atrPeriod)[3]!;
    const signal = strategy.generateSignal({ candles: bars, index: 4, config: options });
    expect(signal).toMatchObject({ type: "BUY", trigger: { price: level, at: "INTRABAR" } });
    expect(signal.stopPrice).toBeCloseTo(level - priorAtr * options.atrMultiplier);
  });

  it("skips a bar that opens at the prior close on the average and trades on both sides", () => {
    const bars = [...candles.slice(0, 3), { ...candles[3], open: 10, high: 12, low: 8, close: 11 }];
    expect(new EmaTrendStrategy(bars, config).generateSignal({ candles: bars, index: 3, config }).type).toBe("HOLD");
  });

  it("uses the signal bar's volume filter and ATR in close crossover mode", () => {
    const options = {
      ...config, trendTriggerMode: "CLOSE_CROSS" as const, atrStopEnabled: true, volumeFilterEnabled: true
    };
    const bars = candles.map((bar, index) => index === 3 ? { ...bar, volume: 1 } : bar);
    const filtered = new EmaTrendStrategy(bars, options).generateSignal({ candles: bars, index: 3, config: options });
    expect(filtered).toMatchObject({ type: "CLOSE_SHORT", reason: expect.stringContaining("Volume below") });
    expect(filtered.trigger).toBeUndefined();
    const unfiltered = new EmaTrendStrategy(candles, options).generateSignal({ candles, index: 3, config: options });
    expect(unfiltered.type).toBe("BUY");
    expect(unfiltered.stopPrice).toBeCloseTo(candles[3].close - atr(candles, options.atrPeriod)[3]! * options.atrMultiplier);
  });

  it("defaults legacy configurations to EMA", () => {
    const legacy = new EmaTrendStrategy(candles, config);
    expect(legacy.generateSignal({ candles, index: 5, config }).type).toBe("SELL_SHORT");
    expect(legacy.generateSignal({ candles, index: 3, config })).toMatchObject({
      type: "BUY", reason: "Price reached EMA3 from below"
    });
  });
});
