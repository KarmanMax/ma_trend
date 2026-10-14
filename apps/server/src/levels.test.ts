import type { Candle } from "@trend-trade/shared";
import { describe, expect, it } from "vitest";
import { findNearbyLevels, isStablecoinAsset, selectCompletedCandlePage } from "./levels";

function bars(values: number[]): Candle[] {
  return values.map((close, index) => ({
    symbol: "BTC",
    timeframe: "1d",
    openTime: index * 86_400_000,
    closeTime: (index + 1) * 86_400_000 - 1,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100
  }));
}

describe("support and resistance scanner", () => {
  it("finds a nearby support cluster formed by repeated swing lows", () => {
    const candles = bars([105, 104, 100, 104, 108, 104, 100.4, 105, 108, 104, 100.2, 104, 103, 100.5]);
    const matches = findNearbyLevels(candles, 2);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ side: "support", price: 100.5, touches: 3 });
    expect(matches[0].level).toBeCloseTo(99.2, 1);
    expect(matches[0].distancePct).toBeLessThan(2);
  });

  it("finds resistance and applies the distance threshold", () => {
    const candles = bars([102, 106, 110, 106, 102, 106, 110.3, 106, 102, 106, 110.1, 106, 106, 109.5]);
    expect(findNearbyLevels(candles, 2)).toEqual([expect.objectContaining({ side: "resistance", touches: 3 })]);
    expect(findNearbyLevels(candles, 0.1)).toEqual([]);
  });

  it("ignores a level touched only once", () => {
    const candles = bars([104, 103, 100, 103, 106, 105, 104, 105, 106, 105, 104, 103, 102, 100.5]);
    expect(findNearbyLevels(candles, 3)).toEqual([]);
  });
});

describe("historical candle pages", () => {
  it("returns completed candles before an exclusive cursor in chronological order", () => {
    const candles = bars([100, 101, 102, 103, 104]);
    const cursor = candles[3].openTime;
    const page = selectCompletedCandlePage([candles[2], candles[3], candles[0], candles[2], candles[1], candles[4]], candles[4].closeTime, cursor);
    expect(page.map((candle) => candle.openTime)).toEqual(candles.slice(0, 3).map((candle) => candle.openTime));
  });
});

describe("crypto scan universe", () => {
  it("filters stablecoins by known identity, symbol, and name", () => {
    expect(isStablecoinAsset({ id: "usd-coin", symbol: "USDC", name: "USDC" })).toBe(true);
    expect(isStablecoinAsset({ id: "new-dollar-token", symbol: "NDT", name: "New Dollar Stablecoin" })).toBe(true);
    expect(isStablecoinAsset({ id: "united-stables", symbol: "U", name: "United Stables" })).toBe(true);
    expect(isStablecoinAsset({ id: "bfusd", symbol: "BFUSD", name: "BFUSD" })).toBe(true);
    expect(isStablecoinAsset({ id: "bitcoin", symbol: "BTC", name: "Bitcoin" })).toBe(false);
  });
});
