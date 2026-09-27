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
});
