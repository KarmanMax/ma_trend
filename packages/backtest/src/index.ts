import { SimulatedExecutionEngine, type ExecutionEngine } from "@trend-trade/execution";
import { adx, atr, calculateDrawdownCurve, calculateMetrics, ema, macd, sma } from "@trend-trade/indicator";
import type { MarketDataProvider } from "@trend-trade/market-data";
import { SimulatedPortfolio, type Portfolio } from "@trend-trade/portfolio";
import type { BacktestChartPoint, BacktestConfig, BacktestResult, Candle, EmaTrendStrategyConfig, MacdTrendStrategyConfig, Signal } from "@trend-trade/shared";
import { createDefaultStrategyRegistry, createStrategyConfigKey, IncrementalStrategyRunner, type StrategyFactory } from "@trend-trade/strategy";

export * from "./incremental";

export type PortfolioFactory = (initialCapital: number) => Portfolio;
export type ExecutionEngineFactory = (config: BacktestConfig) => ExecutionEngine;
export type StrategyFactoryProvider = (candles: Candle[]) => StrategyFactory;

export class BacktestEngine {
  constructor(
    private readonly marketDataProvider: MarketDataProvider,
    private readonly portfolioFactory: PortfolioFactory = (initialCapital) => new SimulatedPortfolio(initialCapital),
    private readonly executionEngineFactory: ExecutionEngineFactory = (config) =>
      new SimulatedExecutionEngine({
        feeRate: config.feeRate,
        slippageRate: config.slippageRate,
        positionSizing: "ALL_IN"
      }),
    private readonly strategyFactoryProvider: StrategyFactoryProvider = (candles) => createDefaultStrategyRegistry(candles)
  ) {}

  async run(config: BacktestConfig): Promise<BacktestResult> {
    const candles = await this.marketDataProvider.getCandles({
      symbol: config.symbol,
      timeframe: config.timeframe,
      startTime: Date.parse(config.startTime),
      endTime: Date.parse(config.endTime)
    });

    if (candles.length === 0) {
      throw new Error("No candles returned for the requested range");
    }

    const portfolio = this.portfolioFactory(config.initialCapital);
    const executionEngine = this.executionEngineFactory(config);
    const strategy = this.strategyFactoryProvider(candles).create(config.strategy);
    const runner = "onClosedBar" in strategy
      ? new IncrementalStrategyRunner(strategy, {
          strategyType: config.strategy.type,
          configKey: createStrategyConfigKey(config.strategy),
          symbol: config.symbol,
          timeframe: config.timeframe
        })
      : null;
    const replayCandles = runner
      ? candles.filter((candle) => candle.closeTime <= Date.parse(config.endTime)).sort((left, right) => left.closeTime - right.closeTime)
      : candles;
    if (replayCandles.length === 0) {
      throw new Error("No closed candles returned for the requested range");
    }
    const processedCandles: Candle[] = [];

    for (let index = 0; index < replayCandles.length; index += 1) {
      const candle = replayCandles[index];
      let signal: Signal;
      if (runner) {
        const step = runner.onClosedBar(candle);
        if (!step) {
          continue;
        }
        signal = step.signal;
      } else if ("generateSignal" in strategy) {
        signal = strategy.generateSignal({ candles, index, config: config.strategy });
      } else {
        throw new Error("Strategy does not support historical or incremental execution");
      }
      executionEngine.execute({ candle, signal, portfolio });
      portfolio.markToMarket(candle);
      processedCandles.push(candle);
    }

    const lastCandle = processedCandles[processedCandles.length - 1];
    executionEngine.closeAtEnd(lastCandle, portfolio);
    portfolio.markToMarket(lastCandle);

    const equityCurve = portfolio.getEquityCurve();
    const drawdownCurve = calculateDrawdownCurve(equityCurve);
    const trades = portfolio.getTrades();
    const metrics = calculateMetrics({
      initialCapital: config.initialCapital,
      equityCurve,
      drawdownCurve,
      trades,
      timeframe: config.timeframe
    });
    const chartPoints = runner ? createBaseChartPoints(processedCandles)
      : config.strategy.type === "MACD_TREND" ? createMacdChartPoints(processedCandles, config.strategy)
      : createTrendChartPoints(processedCandles, config.strategy);

    return {
      config,
      status: "COMPLETED",
      metrics,
      equityCurve,
      drawdownCurve,
      chartPoints,
      trades
    };
  }
}

function createBaseChartPoints(candles: Candle[]): BacktestChartPoint[] {
  return candles.map((candle) => ({
    time: candle.closeTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume
  }));
}

function createTrendChartPoints(candles: Candle[], config: EmaTrendStrategyConfig): BacktestChartPoint[] {
  const basePoints = createBaseChartPoints(candles);
  const closes = candles.map((candle) => candle.close);
  const trendEma = (config.trendMaType === "MA" ? sma : ema)(closes, config.trendEmaPeriod);
  const atrSeries = atr(candles, config.atrPeriod);
  const adxSeries = adx(candles, config.adxPeriod);
  const volumeMa = sma(candles.map((candle) => candle.volume), config.volumeMaPeriod);

  return candles.map((_, index) => ({
    ...basePoints[index],
    trendEma: trendEma[index] ?? undefined,
    atr: atrSeries[index] ?? undefined,
    adx: adxSeries[index] ?? undefined,
    volumeMa: volumeMa[index] ?? undefined
  }));
}

function createMacdChartPoints(candles: Candle[], config: MacdTrendStrategyConfig): BacktestChartPoint[] {
  const basePoints = createBaseChartPoints(candles);
  const series = macd(candles.map((candle) => candle.close), config.macdFastPeriod, config.macdSlowPeriod, config.macdSignalPeriod);
  const atrSeries = atr(candles, config.atrPeriod);
  const adxSeries = adx(candles, config.adxPeriod);
  const volumeMa = sma(candles.map((candle) => candle.volume), config.volumeMaPeriod);

  return candles.map((_, index) => ({
    ...basePoints[index],
    macdLine: series.line[index] ?? undefined,
    macdSignal: series.signal[index] ?? undefined,
    macdHistogram: series.histogram[index] ?? undefined,
    atr: atrSeries[index] ?? undefined,
    adx: adxSeries[index] ?? undefined,
    volumeMa: volumeMa[index] ?? undefined
  }));
}
