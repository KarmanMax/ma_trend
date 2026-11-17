import { detectPriceZones } from "@trend-trade/indicator";
import type { Candle, EmaTrendStrategyConfig, MacdMomentumStrategyConfig, MacdTrendStrategyConfig } from "@trend-trade/shared";
import { describe, expect, it } from "vitest";
import { createDefaultStrategyRegistry, EmaTrendStrategy } from "./index";

const range = [102, 106, 110, 106, 102, 106, 110.3, 106, 102, 106, 110.1, 106, 106, 105];
const config: EmaTrendStrategyConfig = {
  type: "EMA_TREND", trendMaType: "MA", trendEmaPeriod: 3, trendTriggerMode: "CLOSE_CROSS",
  atrPeriod: 14, atrMultiplier: 2, atrStopEnabled: false,
  adxPeriod: 14, adxThreshold: 19, adxFilterEnabled: false,
  volumeMaPeriod: 20, volumeMultiplier: 1, volumeFilterEnabled: false,
  direction: "LONG_SHORT", exitTrigger: "EMA", levelFilterEnabled: true
};
const macdOptions = { ...config, macdFastPeriod: 2, macdSlowPeriod: 4, macdSignalPeriod: 2, zeroFilterEnabled: false, zeroProximityPct: 0.5 };
const cross: MacdTrendStrategyConfig = { ...macdOptions, type: "MACD_TREND", exitTrigger: "MACD" };
const momentum: MacdMomentumStrategyConfig = { ...macdOptions, type: "MACD_MOMENTUM", exitTrigger: "MACD_MOMENTUM" };

function bars(prices: number[], finalOpen = prices[prices.length - 1]): Candle[] {
  return prices.map((close, index) => {
    const open = index === prices.length - 1 ? finalOpen : close;
    return {
      symbol: "ETH", timeframe: "1d", openTime: index * 86_400_000, closeTime: (index + 1) * 86_400_000 - 1,
      open, close, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, volume: 100
    };
  });
}

describe("support and resistance entry filter", () => {
  it.each([
    ["BUY", "CLOSE_SHORT", "Resistance", 1],
    ["SELL_SHORT", "CLOSE_LONG", "Support", -1]
  ] as const)("blocks %s near a zone while preserving the opposing exit", (entry, exit, obstacle, direction) => {
    const candles = bars([...range, 109.5].map((price) => 110 + direction * (price - 110)));
    const index = candles.length - 1;
    const check = (options: EmaTrendStrategyConfig) => new EmaTrendStrategy(candles, options).generateSignal({ candles, index, config: options });

    expect(check(config)).toMatchObject({ type: exit, reason: expect.stringContaining(obstacle) });
    expect(check({ ...config, exitTrigger: "NONE" }).type).toBe("HOLD");
    expect(check({ ...config, levelFilterEnabled: false }).type).toBe(entry);
    expect(check({ ...config, levelMinClearanceAtr: 0.1 }).type).toBe(entry);
    expect(new EmaTrendStrategy(candles, config).revalidateEntry(index, entry)).toBeNull();
  });

  it("checks the intrabar trigger price and allows a close beyond the zone", () => {
    const candles = bars([...range, 113.5], 109.5);
    const index = candles.length - 1;
    const intrabar: EmaTrendStrategyConfig = { ...config, trendTriggerMode: "INTRABAR_TOUCH" };

    expect(new EmaTrendStrategy(candles, intrabar).generateSignal({ candles, index, config: intrabar }))
      .toMatchObject({ type: "CLOSE_SHORT", trigger: { at: "OPEN", price: 109.5 } });
    const strategy = new EmaTrendStrategy(candles, config);
    expect(strategy.generateSignal({ candles, index, config }).type).toBe("BUY");
    expect(strategy.revalidateEntry(index, "BUY")?.type).toBe("BUY");
  });

  it("uses only zones that were confirmed before the signal bar", () => {
    const candles = bars([102, 106, 106, 110, 106, 103, 102, 105, 106, 107, 107, 108, 110.1, 104, 109.5]);
    const index = candles.length - 1;
    expect(detectPriceZones(candles)?.zones).toEqual([expect.objectContaining({ side: "resistance", touches: 2 })]);
    expect(detectPriceZones(candles.slice(0, index))?.zones).toEqual([]);
    expect(new EmaTrendStrategy(candles, config).generateSignal({ candles, index, config }).type).toBe("BUY");
  });

  it.each([
    { options: cross, candles: bars([...range, 109.5]) },
    { options: momentum, candles: bars([...range, 106, 106, 107]) }
  ])("applies the filter to $options.type signals and cooldown rechecks", ({ options, candles }) => {
    const index = candles.length - 1;
    const registry = createDefaultStrategyRegistry(candles);
    const disabled = { ...options, levelFilterEnabled: false };
    const allowed = registry.create(disabled);
    const blocked = registry.create(options);
    if (!("generateSignal" in allowed) || !("generateSignal" in blocked)) throw new Error("Expected MACD strategy");

    expect(allowed.generateSignal({ candles, index, config: disabled }).type).toBe("BUY");
    expect(blocked.generateSignal({ candles, index, config: options })).toMatchObject({ type: "CLOSE_SHORT", reason: expect.stringContaining("Resistance") });
    expect(allowed.revalidateEntry?.(index, "BUY")?.type).toBe("BUY");
    expect(blocked.revalidateEntry?.(index, "BUY")).toBeNull();
  });
});
