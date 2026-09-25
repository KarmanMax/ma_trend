import { SimulatedExecutionEngine } from "@trend-trade/execution";
import { calculateDrawdownCurve, calculateMetrics } from "@trend-trade/indicator";
import { SimulatedPortfolio } from "@trend-trade/portfolio";
import type { BacktestChartPoint, BacktestMetrics, Candle, DrawdownPoint, EquityPoint, Signal, Trade } from "@trend-trade/shared";
import { createStrategyConfigKey, IncrementalStrategyRunner, type IncrementalStrategySession, type StrategyStepResult } from "@trend-trade/strategy";

export type IncrementalBacktestInput = {
  candles: Candle[];
  symbol: string;
  endTime: number;
  initialCapital: number;
  feeRate: number;
  slippageRate: number;
  strategyConfig: unknown;
  session: IncrementalStrategySession;
};

export type IncrementalBacktestResult = {
  metrics: BacktestMetrics;
  trades: Trade[];
  equityCurve: EquityPoint[];
  drawdownCurve: DrawdownPoint[];
  chartPoints: BacktestChartPoint[];
  timeline: Array<{ time: number; phase: string | null; signal: Signal; status?: StrategyStepResult["status"] }>;
};

export function runIncrementalBacktest(input: IncrementalBacktestInput): IncrementalBacktestResult {
  const candles = input.candles
    .filter((candle) => candle.closeTime <= input.endTime)
    .sort((left, right) => left.closeTime - right.closeTime);
  if (candles.length === 0) {
    throw new Error("No closed candles returned for the requested range");
  }

  const runner = new IncrementalStrategyRunner(input.session, {
    strategyType: input.session.id,
    configKey: createStrategyConfigKey(input.strategyConfig),
    symbol: input.symbol,
    timeframe: "1d"
  });
  const portfolio = new SimulatedPortfolio(input.initialCapital);
  const execution = new SimulatedExecutionEngine({
    feeRate: input.feeRate,
    slippageRate: input.slippageRate,
    positionSizing: "ALL_IN"
  });
  const chartPoints: BacktestChartPoint[] = [];
  const timeline: IncrementalBacktestResult["timeline"] = [];
  let lastCandle: Candle | null = null;

  for (const candle of candles) {
    const step = runner.onClosedBar(candle);
    if (!step) continue;
    execution.execute({ candle, signal: step.signal, portfolio });
    portfolio.markToMarket(candle);
    chartPoints.push({
      time: candle.closeTime,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume
    });
    timeline.push({ time: candle.closeTime, phase: step.status?.phase ?? null, signal: step.signal, status: step.status });
    lastCandle = candle;
  }

  if (!lastCandle) {
    throw new Error("No valid closed candles for incremental backtest");
  }
  execution.closeAtEnd(lastCandle, portfolio);
  portfolio.markToMarket(lastCandle);
  const equityCurve = portfolio.getEquityCurve();
  const drawdownCurve = calculateDrawdownCurve(equityCurve);
  const trades = portfolio.getTrades();
  return {
    metrics: calculateMetrics({ initialCapital: input.initialCapital, equityCurve, drawdownCurve, trades, timeframe: "1d" }),
    trades,
    equityCurve,
    drawdownCurve,
    chartPoints,
    timeline
  };
}
