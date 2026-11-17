import { describe, expect, it } from "vitest";
import { backtestConfigSchema } from "./index";

const input = {
  symbol: "ETH",
  timeframe: "1h",
  startTime: "2024-01-01T00:00:00.000Z",
  endTime: "2024-02-01T00:00:00.000Z",
  initialCapital: 10_000,
  feeRate: 0.001,
  slippageRate: 0.0005,
  strategy: {
    type: "MACD_TREND",
    atrPeriod: 14,
    atrMultiplier: 2,
    adxPeriod: 14,
    adxThreshold: 20,
    volumeMaPeriod: 20,
    volumeMultiplier: 1,
    direction: "LONG_SHORT"
  }
};

describe("MACD backtest config", () => {
  it.each(["EMA_TREND", "MACD_TREND", "MACD_MOMENTUM"])("parses the support and resistance filter for %s", (type) => {
    const strategy = { ...input.strategy, type, levelFilterEnabled: true, levelMinClearanceAtr: 1.5 };
    expect(backtestConfigSchema.parse({ ...input, strategy }).strategy).toMatchObject({
      levelFilterEnabled: true, levelMinClearanceAtr: 1.5
    });
    expect(backtestConfigSchema.safeParse({ ...input, strategy: { ...strategy, levelMinClearanceAtr: 0 } }).success).toBe(false);
  });

  it("accepts a Beijing candle start hour only for crypto daily backtests", () => {
    const daily = { ...input, timeframe: "1d" };
    expect(backtestConfigSchema.parse(daily).dailyCandleStartHour).toBeUndefined();
    expect(backtestConfigSchema.parse({ ...daily, dailyCandleStartHour: 0 }).dailyCandleStartHour).toBe(0);
    expect(backtestConfigSchema.safeParse({ ...daily, dailyCandleStartHour: 3 }).success).toBe(false);
    expect(backtestConfigSchema.safeParse({ ...daily, symbol: "AAPL", dailyCandleStartHour: 0 }).success).toBe(false);
    expect(backtestConfigSchema.safeParse({ ...input, dailyCandleStartHour: 0 }).success).toBe(false);
  });

  it("defaults MA/EMA to intrabar touch and accepts close crossover", () => {
    const strategy = { ...input.strategy, type: "EMA_TREND" };
    expect(backtestConfigSchema.parse({ ...input, strategy }).strategy)
      .toMatchObject({ trendTriggerMode: "INTRABAR_TOUCH" });
    expect(backtestConfigSchema.parse({
      ...input, strategy: { ...strategy, trendTriggerMode: "CLOSE_CROSS", filterExtendedCooldownEntries: true }
    }).strategy).toMatchObject({ trendTriggerMode: "CLOSE_CROSS", filterExtendedCooldownEntries: true });
    expect(backtestConfigSchema.safeParse({ ...input, strategy: { ...strategy, trendTriggerMode: "OPEN" } }).success)
      .toBe(false);
  });
  it.each(["EMA_TREND", "MACD_TREND", "MACD_MOMENTUM"])("accepts optional whole-bar cooldowns for %s", (type) => {
    const withCooldown = (lossCooldownBars?: number) => ({
      ...input, strategy: { ...input.strategy, type, lossCooldownBars }
    });
    expect(backtestConfigSchema.parse(withCooldown()).strategy.lossCooldownBars).toBeUndefined();
    expect(backtestConfigSchema.parse(withCooldown(0)).strategy.lossCooldownBars).toBe(0);
    expect(backtestConfigSchema.parse(withCooldown(3)).strategy.lossCooldownBars).toBe(3);
    const withResume = { ...withCooldown(3), strategy: { ...withCooldown(3).strategy, resumeEntryAfterCooldown: true } };
    expect(backtestConfigSchema.parse(withResume).strategy.resumeEntryAfterCooldown).toBe(true);
    expect(backtestConfigSchema.safeParse(withCooldown(-1)).success).toBe(false);
    expect(backtestConfigSchema.safeParse(withCooldown(1.5)).success).toBe(false);
  });

  it("fills period and zero-filter defaults and rejects an invalid period order", () => {
    expect(backtestConfigSchema.parse(input).strategy).toMatchObject({
      macdFastPeriod: 12, macdSlowPeriod: 26, macdSignalPeriod: 9,
      zeroFilterEnabled: false, zeroProximityPct: 0.5, exitTrigger: "MACD"
    });
    expect(backtestConfigSchema.safeParse({
      ...input,
      strategy: { ...input.strategy, macdFastPeriod: 30 }
    }).success).toBe(false);
  });

  it("parses the MACD histogram momentum strategy with its reverse-exit default", () => {
    expect(backtestConfigSchema.parse({
      ...input,
      strategy: { ...input.strategy, type: "MACD_MOMENTUM" }
    }).strategy).toMatchObject({
      type: "MACD_MOMENTUM",
      macdFastPeriod: 12,
      macdSlowPeriod: 26,
      macdSignalPeriod: 9,
      exitTrigger: "MACD_MOMENTUM"
    });
  });
});
