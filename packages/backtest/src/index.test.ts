import { describe, expect, it } from "vitest";
import type { MarketDataProvider } from "@trend-trade/market-data";
import { defaultWyckoffStrategyConfig, wyckoffStrategyConfigSchema, type BacktestConfig, type Candle } from "@trend-trade/shared";
import { StrategyRegistry, WyckoffStrategy, type IncrementalStrategySession } from "@trend-trade/strategy";
import { BacktestEngine, runIncrementalBacktest } from "./index";

const config: BacktestConfig = {
  symbol: "ETH",
  timeframe: "1d",
  startTime: "2024-01-01T00:00:00.000Z",
  endTime: "2024-01-08T00:00:00.000Z",
  initialCapital: 10_000,
  feeRate: 0,
  slippageRate: 0,
  strategy: {
    type: "EMA_TREND",
    trendEmaPeriod: 3,
    trendMaType: "MA",
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
    exitTrigger: "EMA"
  }
};

function candle(index: number, close: number): Candle {
  const openTime = Date.parse(config.startTime) + index * 86_400_000;
  return {
    symbol: "ETH",
    timeframe: "1d",
    openTime,
    closeTime: openTime + 86_400_000 - 1,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100
  };
}

function provider(candles: Candle[]): MarketDataProvider {
  return { getCandles: async () => candles };
}

class TestIncrementalSession implements IncrementalStrategySession<{ seen: number }> {
  readonly id = "EMA_TREND";
  readonly name = "Test incremental session";
  readonly stateVersion = 1;
  private seen = 0;

  onClosedBar(_bar: Candle) {
    this.seen += 1;
    return { signal: { type: this.seen === 2 ? "BUY" as const : "HOLD" as const } };
  }

  snapshot() {
    return { seen: this.seen };
  }

  restore(state: { seen: number }) {
    this.seen = state.seen;
  }
}

describe("backtest strategy paths", () => {
  it("feeds an incremental strategy once per closed bar and produces base chart points", async () => {
    const bars = [candle(2, 12), candle(7, 20), candle(0, 10), candle(1, 11), candle(1, 11)];
    const registry = new StrategyRegistry();
    registry.register("EMA_TREND", () => new TestIncrementalSession());
    const engine = new BacktestEngine(provider(bars), undefined, undefined, () => registry);

    const result = await engine.run(config);

    expect(result.chartPoints.map((point) => point.time)).toEqual([candle(0, 10), candle(1, 11), candle(2, 12)].map((bar) => bar.closeTime));
    expect(result.chartPoints[0]).not.toHaveProperty("trendEma");
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ entryTime: candle(1, 11).closeTime, exitReason: "END_OF_BACKTEST" });
  });

  it("preserves the existing Trend signal and chart path", async () => {
    const bars = [10, 10, 10, 20, 20, 18].map((close, index) => candle(index, close));
    const result = await new BacktestEngine(provider(bars)).run(config);

    expect(result.trades).toHaveLength(2);
    expect(result.trades[0]).toMatchObject({ entryTime: bars[3].closeTime, exitTime: bars[5].closeTime, exitReason: "SIGNAL" });
    expect(result.trades[1]).toMatchObject({ entryTime: bars[5].closeTime, exitReason: "END_OF_BACKTEST" });
    expect(result.chartPoints[3].trendEma).toBeCloseTo(40 / 3);
  });

  it("executes a Wyckoff entry and invalidation using the independent incremental backtest path", () => {
    const strategy = wyckoffStrategyConfigSchema.parse(defaultWyckoffStrategyConfig);
    const bar = (index: number, values: Partial<Candle> = {}): Candle => ({
      ...candle(index, 100),
      high: 105,
      low: 95,
      ...values
    });
    const bars = [
      ...Array.from({ length: 20 }, (_, index) => bar(index)),
      bar(20, { open: 105, high: 112, low: 104, close: 110, volume: 200 }),
      bar(21, { open: 110, high: 111, low: 108, close: 109, volume: 130 }),
      bar(22, { open: 109, high: 110, low: 105, close: 107, volume: 120 }),
      bar(23, { open: 107, high: 108, low: 104, close: 106, volume: 110 }),
      bar(24, { open: 104, high: 105, low: 99, close: 100, volume: 100 })
    ].map((item) => ({ ...item, symbol: "bitcoin" }));

    const result = runIncrementalBacktest({
      candles: bars,
      symbol: "bitcoin",
      endTime: bars[bars.length - 1].closeTime,
      initialCapital: 10_000,
      feeRate: 0,
      slippageRate: 0,
      strategyConfig: strategy,
      session: new WyckoffStrategy(strategy)
    });

    expect(result.timeline[23]).toMatchObject({ phase: "ENTERED", signal: { type: "BUY" } });
    expect(result.timeline[19].status).toMatchObject({ levels: { rangeHigh: 105, rangeLow: 95 } });
    expect(result.timeline[20].status).toMatchObject({ setup: "SOS_LPS", levels: { breakoutLevel: 105, invalidationPrice: 105 * 0.96 } });
    expect(result.timeline[23].status).toMatchObject({ entrySide: "LONG", levels: { rangeHigh: 105, rangeLow: 95 } });
    expect(result.timeline[24]).toMatchObject({ phase: "INVALIDATED", signal: { type: "CLOSE_LONG" } });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ symbol: "bitcoin", entryTime: bars[23].closeTime, exitTime: bars[24].closeTime, exitReason: "SIGNAL" });
    expect(result.chartPoints[0]).not.toHaveProperty("trendEma");
  });

  it("executes a UTAD short and CLOSE_SHORT without altering the Trend execution path", () => {
    const strategy = wyckoffStrategyConfigSchema.parse(defaultWyckoffStrategyConfig);
    const rangeBars = Array.from({ length: 20 }, (_, index): Candle => ({
      ...candle(index, 100), symbol: "bitcoin", high: 105, low: 95
    }));
    const utad = { ...candle(20, 103), symbol: "bitcoin", open: 104, high: 109, low: 101 };
    const invalidation = { ...candle(21, 114), symbol: "bitcoin", open: 111, high: 115, low: 110 };
    const result = runIncrementalBacktest({
      candles: [...rangeBars, utad, invalidation],
      symbol: "bitcoin",
      endTime: invalidation.closeTime,
      initialCapital: 10_000,
      feeRate: 0,
      slippageRate: 0,
      strategyConfig: strategy,
      session: new WyckoffStrategy(strategy)
    });

    expect(result.timeline[20]).toMatchObject({ phase: "ENTERED", signal: { type: "SELL_SHORT" } });
    expect(result.timeline[20].status).toMatchObject({ setup: "UTAD", entrySide: "SHORT", levels: { trapExtreme: 109, invalidationPrice: 109 * 1.04 } });
    expect(result.timeline[21]).toMatchObject({ phase: "INVALIDATED", signal: { type: "CLOSE_SHORT" } });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ side: "SHORT", entryTime: utad.closeTime, exitTime: invalidation.closeTime, exitReason: "SIGNAL" });
  });
});
