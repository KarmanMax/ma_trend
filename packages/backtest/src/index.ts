import { SimulatedExecutionEngine, type ExecutionEngine } from "@trend-trade/execution";
import { adx, atr, calculateDrawdownCurve, calculateMetrics, ema, sma } from "@trend-trade/indicator";
import type { MarketDataProvider } from "@trend-trade/market-data";
import { SimulatedPortfolio, type Portfolio } from "@trend-trade/portfolio";
import type { BacktestConfig, BacktestResult, Candle } from "@trend-trade/shared";
import { createDefaultStrategyRegistry, type StrategyFactory } from "@trend-trade/strategy";

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

    for (let index = 0; index < candles.length; index += 1) {
      const candle = candles[index];
      const signal = strategy.generateSignal({
        candles,
        index,
        config: config.strategy
      });
      executionEngine.execute({ candle, signal, portfolio });
      portfolio.markToMarket(candle);
    }

    const lastCandle = candles[candles.length - 1];
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
    const chartPoints = createChartPoints(candles, config);

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

function createChartPoints(candles: Candle[], config: BacktestConfig) {
  const closes = candles.map((candle) => candle.close);
  const emaFast = ema(closes, config.strategy.emaFast);
  const emaSlow = ema(closes, config.strategy.emaSlow);
  const atrSeries = atr(candles, config.strategy.atrPeriod);
  const adxSeries = adx(candles, config.strategy.adxPeriod);
  const volumeMa = sma(candles.map((candle) => candle.volume), config.strategy.volumeMaPeriod);

  return candles.map((candle, index) => ({
    time: candle.closeTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    emaFast: emaFast[index] ?? undefined,
    emaSlow: emaSlow[index] ?? undefined,
    atr: atrSeries[index] ?? undefined,
    adx: adxSeries[index] ?? undefined,
    volumeMa: volumeMa[index] ?? undefined
  }));
}
