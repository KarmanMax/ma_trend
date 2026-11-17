import { describe, expect, it } from "vitest";
import type { MarketDataProvider } from "@trend-trade/market-data";
import { defaultWyckoffStrategyConfig, wyckoffStrategyConfigSchema, type BacktestConfig, type Candle, type EmaTrendStrategyConfig } from "@trend-trade/shared";
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
  it.each([["8h", 8], ["12h", 12]] as const)("excludes unfinished %s candles at the end of a backtest", async (timeframe, hours) => {
    const start = Date.parse(config.startTime);
    const interval = hours * 3_600_000;
    const bars = [0, 1].map((index): Candle => ({
      ...candle(index, 100),
      timeframe,
      openTime: start + index * interval,
      closeTime: start + (index + 1) * interval - 1
    }));
    const result = await new BacktestEngine(provider(bars)).run({
      ...config,
      timeframe,
      endTime: new Date(start + interval).toISOString()
    });

    expect(result.chartPoints.map((point) => point.time)).toEqual([bars[0].closeTime]);
  });

  it.each(["MA", "EMA"] as const)("warms up %s with candles before the selected range", async (trendMaType) => {
    const history = Array.from({ length: 16 }, (_, offset) => candle(offset - 10, 100 + offset));
    let requestedStart = Date.parse(config.startTime);
    const marketData: MarketDataProvider = {
      getCandles: async (request) => {
        requestedStart = request.startTime;
        return history.filter((bar) => bar.openTime >= request.startTime && bar.openTime <= request.endTime);
      }
    };

    const result = await new BacktestEngine(marketData).run({
      ...config,
      strategy: { ...(config.strategy as EmaTrendStrategyConfig), trendMaType }
    });

    expect(requestedStart).toBeLessThan(Date.parse(config.startTime));
    expect(result.chartPoints).toHaveLength(6);
    expect(result.chartPoints[0].time).toBe(candle(0, 0).closeTime);
    expect(result.chartPoints[0].trendEma).toBeTypeOf("number");
    expect(result.equityCurve[0].time).toBe(candle(0, 0).closeTime);
  });

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

  it("fills MA gaps at the open and intrabar reversals at the prior average", async () => {
    const bars = [10, 10, 10, 20, 20, 18].map((close, index) => candle(index, close));
    bars[5].low = 16;
    const result = await new BacktestEngine(provider(bars)).run(config);

    expect(result.trades).toHaveLength(2);
    expect(result.trades[0]).toMatchObject({ entryTime: bars[3].openTime, entryPrice: 20, exitTime: bars[5].closeTime, exitReason: "SIGNAL" });
    expect(result.trades[0].exitPrice).toBeCloseTo(50 / 3);
    expect(result.trades[1]).toMatchObject({ entryTime: bars[5].closeTime, exitReason: "END_OF_BACKTEST" });
    expect(result.trades[1].entryPrice).toBeCloseTo(50 / 3);
    expect(result.chartPoints[3].trendEma).toBeCloseTo(40 / 3);
  });

  it.each(["MA", "EMA"] as const)("supports both intrabar touch and candle close crossover for %s", async (trendMaType) => {
    const bars = [10, 10, 10, 8, 8, 12].map((close, index) => candle(index, close));
    bars[4].high = 10;
    bars[5].open = 11;
    const strategy = { ...(config.strategy as EmaTrendStrategyConfig), trendMaType, direction: "LONG_ONLY" as const };
    const engine = new BacktestEngine(provider(bars));
    const intrabar = await engine.run({ ...config, strategy });
    const close = await engine.run({ ...config, strategy: { ...strategy, trendTriggerMode: "CLOSE_CROSS" } });

    expect(intrabar.trades).toHaveLength(1);
    expect(intrabar.trades[0].entryTime).toBe(bars[4].closeTime);
    expect(intrabar.trades[0].entryPrice).toBeCloseTo(trendMaType === "MA" ? 28 / 3 : 9);
    expect(close.trades).toHaveLength(1);
    expect(close.trades[0]).toMatchObject({ entryTime: bars[5].closeTime, entryPrice: 12 });
  });

  it("closes a new intrabar long at the close when the breakout fails", async () => {
    const bars = [10, 10, 10, 8, 8, 12].map((close, index) => candle(index, close));
    bars[4].high = 10;
    const result = await new BacktestEngine(provider(bars)).run({
      ...config,
      strategy: { ...(config.strategy as EmaTrendStrategyConfig), direction: "LONG_ONLY", exitOnFailedBreakout: true }
    });

    expect(result.trades).toHaveLength(2);
    expect(result.trades[0].entryPrice).toBeCloseTo(28 / 3);
    expect(result.trades[0]).toMatchObject({
      side: "LONG", entryTime: bars[4].closeTime, exitTime: bars[4].closeTime, exitPrice: 8, exitReason: "FAILED_BREAKOUT"
    });
    expect(result.trades[1]).toMatchObject({ entryTime: bars[5].openTime, exitReason: "END_OF_BACKTEST" });
  });

  it("checks a new gap short against the prior average rather than its opening fill", async () => {
    const bars = [10, 10, 10, 12, 11, 11].map((close, index) => candle(index, close));
    bars[4].open = 9;
    bars[4].low = 9;
    const result = await new BacktestEngine(provider(bars)).run({
      ...config,
      strategy: { ...(config.strategy as EmaTrendStrategyConfig), direction: "SHORT_ONLY", exitOnFailedBreakout: true }
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      side: "SHORT", entryTime: bars[4].openTime, entryPrice: 9,
      exitTime: bars[4].closeTime, exitPrice: 11, exitReason: "FAILED_BREAKOUT"
    });
  });

  it("wires the loss cooldown into trend runs and includes final liquidation costs in equity", async () => {
    const bars = [10, 10, 10, 20, 12, 12, 20, 20, 20, 10].map((close, index) => candle(index, close));
    const result = await new BacktestEngine(provider(bars)).run({
      ...config,
      endTime: "2024-01-11T00:00:00.000Z",
      feeRate: 0.001,
      slippageRate: 0.0005,
      strategy: { ...config.strategy, lossCooldownBars: 3 }
    });

    expect(result.trades).toHaveLength(2);
    expect(result.trades[0]).toMatchObject({ entryTime: bars[3].openTime, exitTime: bars[4].openTime, exitReason: "SIGNAL" });
    expect(result.trades[1]).toMatchObject({ entryTime: bars[9].openTime, exitReason: "END_OF_BACKTEST" });
    const realizedPnl = result.trades.reduce((sum, trade) => sum + trade.netPnl!, 0);
    expect(result.equityCurve.at(-1)?.equity).toBeCloseTo(config.initialCapital + realizedPnl);
    expect(result.metrics.totalReturn).toBeCloseTo(realizedPnl / config.initialCapital);
  });

  it("resumes a blocked MA entry after cooldown without another cross and applies current filters", async () => {
    const bars = [10, 10, 10, 20, 12, 11, 10, 9].map((close, index) => candle(index, close));
    const cooldownConfig = { ...config, strategy: { ...config.strategy, lossCooldownBars: 1 } };
    const engine = new BacktestEngine(provider(bars));
    const original = await engine.run(cooldownConfig);
    const resumed = await engine.run({
      ...cooldownConfig, strategy: { ...cooldownConfig.strategy, resumeEntryAfterCooldown: true }
    });
    const lowVolumeBars = bars.map((bar, index) => index === 6 ? { ...bar, volume: 1 } : bar);
    const blocked = await new BacktestEngine(provider(lowVolumeBars)).run({
      ...cooldownConfig,
      strategy: { ...cooldownConfig.strategy, volumeFilterEnabled: true, resumeEntryAfterCooldown: true }
    });

    expect(original.trades).toHaveLength(1);
    expect(resumed.trades).toHaveLength(2);
    expect(resumed.trades[1]).toMatchObject({ side: "SHORT", entryTime: bars[6].closeTime, entryPrice: 10 });
    expect(blocked.trades).toHaveLength(1);
  });

  it("executes MACD reversals and exposes MACD chart values", async () => {
    const bars = [10, 10, 10, 10, 12, 10].map((close, index) => candle(index, close));
    const macdConfig: BacktestConfig = {
      ...config,
      strategy: {
        ...config.strategy,
        type: "MACD_TREND",
        macdFastPeriod: 2,
        macdSlowPeriod: 3,
        macdSignalPeriod: 2,
        zeroFilterEnabled: false,
        zeroProximityPct: 0.5,
        exitTrigger: "MACD"
      }
    };
    const result = await new BacktestEngine(provider(bars)).run(macdConfig);

    expect(result.trades).toHaveLength(2);
    expect(result.trades[0]).toMatchObject({ side: "LONG", entryTime: bars[4].closeTime, exitTime: bars[5].closeTime });
    expect(result.trades[1]).toMatchObject({ side: "SHORT", entryTime: bars[5].closeTime });
    expect(result.chartPoints[4].macdLine).toBeCloseTo(1 / 3);
    expect(result.chartPoints[4].macdSignal).toBeCloseTo(2 / 9);
    expect(result.chartPoints[4].trendEma).toBeUndefined();
  });

  it("requests the selected daily candle boundary and excludes an unfinished MACD bar", async () => {
    const shift = 8 * 3_600_000;
    const bars = [100, 101].map((close, index) => {
      const bar = candle(index, close);
      return { ...bar, openTime: bar.openTime - shift, closeTime: bar.closeTime - shift };
    });
    const marketData: MarketDataProvider = {
      getCandles: async (request) => {
        expect(request.dailyCandleStartHour).toBe(0);
        expect(request.requiredStartTime).toBe(bars[0].openTime);
        return bars;
      }
    };
    const result = await new BacktestEngine(marketData).run({
      ...config,
      dailyCandleStartHour: 0,
      startTime: new Date(bars[0].openTime).toISOString(),
      endTime: new Date(bars[1].openTime).toISOString(),
      strategy: {
        ...config.strategy,
        type: "MACD_TREND",
        macdFastPeriod: 2,
        macdSlowPeriod: 3,
        macdSignalPeriod: 2,
        zeroFilterEnabled: false,
        zeroProximityPct: 0.5,
        exitTrigger: "MACD"
      }
    });

    expect(result.chartPoints.map(({ time }) => time)).toEqual([bars[0].closeTime]);
  });

  it("executes MACD histogram fill-state reversals", async () => {
    const bars = [10, 10, 10, 9, 10, 10, 13, 13, 11].map((close, index) => candle(index, close));
    const momentumConfig: BacktestConfig = {
      ...config,
      strategy: {
        ...config.strategy,
        type: "MACD_MOMENTUM",
        macdFastPeriod: 2,
        macdSlowPeriod: 3,
        macdSignalPeriod: 2,
        zeroFilterEnabled: false,
        zeroProximityPct: 0.5,
        exitTrigger: "MACD_MOMENTUM"
      }
    };
    const result = await new BacktestEngine(provider(bars)).run(momentumConfig);

    expect(result.trades).toHaveLength(2);
    expect(result.trades[0]).toMatchObject({ side: "LONG", entryTime: bars[6].closeTime, exitTime: bars[7].closeTime });
    expect(result.trades[1]).toMatchObject({ side: "SHORT", entryTime: bars[7].closeTime });
    expect(result.chartPoints[6].macdHistogram).toBeGreaterThan(result.chartPoints[5].macdHistogram!);
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
