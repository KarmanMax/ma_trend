import type { Candle, DrawdownPoint, EquityPoint, Trade, Timeframe } from "@trend-trade/shared";

export function ema(values: number[], period: number): Array<number | null> {
  if (period <= 0) {
    throw new Error("EMA period must be positive");
  }

  const output: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) {
    return output;
  }

  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const multiplier = 2 / (period + 1);
  output[period - 1] = seed;

  for (let index = period; index < values.length; index += 1) {
    const previous = output[index - 1];
    output[index] = previous === null ? null : (values[index] - previous) * multiplier + previous;
  }

  return output;
}

export function atr(candles: Candle[], period: number): Array<number | null> {
  if (period <= 0) {
    throw new Error("ATR period must be positive");
  }

  const trueRanges = candles.map((candle, index) => {
    if (index === 0) {
      return candle.high - candle.low;
    }

    const previousClose = candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );
  });

  return ema(trueRanges, period);
}

export function sma(values: number[], period: number): Array<number | null> {
  if (period <= 0) {
    throw new Error("SMA period must be positive");
  }

  const output: Array<number | null> = Array(values.length).fill(null);
  let rollingSum = 0;

  for (let index = 0; index < values.length; index += 1) {
    rollingSum += values[index];
    if (index >= period) {
      rollingSum -= values[index - period];
    }
    if (index >= period - 1) {
      output[index] = rollingSum / period;
    }
  }

  return output;
}

export function adx(candles: Candle[], period: number): Array<number | null> {
  if (period <= 0) {
    throw new Error("ADX period must be positive");
  }

  const plusDm: number[] = Array(candles.length).fill(0);
  const minusDm: number[] = Array(candles.length).fill(0);
  const trueRanges: number[] = candles.map((candle, index) => {
    if (index === 0) {
      return candle.high - candle.low;
    }

    const previous = candles[index - 1];
    const upMove = candle.high - previous.high;
    const downMove = previous.low - candle.low;
    plusDm[index] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[index] = downMove > upMove && downMove > 0 ? downMove : 0;

    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previous.close),
      Math.abs(candle.low - previous.close)
    );
  });

  const smoothedTr = ema(trueRanges, period);
  const smoothedPlusDm = ema(plusDm, period);
  const smoothedMinusDm = ema(minusDm, period);
  const dx = candles.map((_, index) => {
    const tr = smoothedTr[index];
    const plus = smoothedPlusDm[index];
    const minus = smoothedMinusDm[index];
    if (tr === null || plus === null || minus === null || tr === 0) {
      return 0;
    }

    const plusDi = 100 * plus / tr;
    const minusDi = 100 * minus / tr;
    const denominator = plusDi + minusDi;
    return denominator === 0 ? 0 : 100 * Math.abs(plusDi - minusDi) / denominator;
  });

  return ema(dx, period);
}

export function calculateDrawdownCurve(equityCurve: EquityPoint[]): DrawdownPoint[] {
  let peak = Number.NEGATIVE_INFINITY;

  return equityCurve.map((point) => {
    peak = Math.max(peak, point.equity);
    const drawdown = peak === 0 ? 0 : (point.equity - peak) / peak;
    return { time: point.time, drawdown };
  });
}

export function calculateMetrics(input: {
  initialCapital: number;
  equityCurve: EquityPoint[];
  drawdownCurve: DrawdownPoint[];
  trades: Trade[];
  timeframe: Timeframe;
}) {
  const { initialCapital, equityCurve, drawdownCurve, trades, timeframe } = input;
  const finalEquity = equityCurve.at(-1)?.equity ?? initialCapital;
  const totalReturn = initialCapital === 0 ? 0 : (finalEquity - initialCapital) / initialCapital;
  const firstTime = equityCurve[0]?.time;
  const lastTime = equityCurve.at(-1)?.time;
  const years = firstTime && lastTime ? Math.max((lastTime - firstTime) / (365.25 * 24 * 60 * 60 * 1000), 1 / 365.25) : 1;
  const cagr = Math.pow(finalEquity / initialCapital, 1 / years) - 1;
  const maxDrawdown = Math.min(0, ...drawdownCurve.map((point) => point.drawdown));
  const returns = equityCurve.slice(1).map((point, index) => {
    const previous = equityCurve[index].equity;
    return previous === 0 ? 0 : (point.equity - previous) / previous;
  });
  const averageReturn = average(returns);
  const returnStdDev = standardDeviation(returns);
  const periodsPerYear = 365.25 * 24 * 60 / timeframeMinutes(timeframe);
  const sharpeRatio = returnStdDev === 0 ? 0 : (averageReturn / returnStdDev) * Math.sqrt(periodsPerYear);
  const closedTrades = trades.filter((trade) => trade.exitTime !== undefined);
  const winningTrades = closedTrades.filter((trade) => (trade.netPnl ?? 0) > 0);
  const winRate = closedTrades.length === 0 ? 0 : winningTrades.length / closedTrades.length;
  const grossProfit = closedTrades.reduce((sum, trade) => sum + Math.max(trade.netPnl ?? 0, 0), 0);
  const grossLoss = Math.abs(closedTrades.reduce((sum, trade) => sum + Math.min(trade.netPnl ?? 0, 0), 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Number.POSITIVE_INFINITY : 0) : grossProfit / grossLoss;

  return {
    totalReturn,
    cagr,
    maxDrawdown,
    sharpeRatio,
    winRate,
    profitFactor,
    tradeCount: closedTrades.length
  };
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }

  const mean = average(values);
  const variance = average(values.map((value) => Math.pow(value - mean, 2)));
  return Math.sqrt(variance);
}

function timeframeMinutes(timeframe: Timeframe): number {
  const value = Number(timeframe.slice(0, -1));
  const unit = timeframe.at(-1);

  if (unit === "m") {
    return value;
  }

  if (unit === "h") {
    return value * 60;
  }

  if (unit === "d") {
    return value * 24 * 60;
  }

  throw new Error(`Unsupported timeframe: ${timeframe}`);
}
