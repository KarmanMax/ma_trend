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

export function macd(values: number[], fastPeriod: number, slowPeriod: number, signalPeriod: number): {
  line: Array<number | null>;
  signal: Array<number | null>;
  histogram: Array<number | null>;
} {
  if (!Number.isInteger(fastPeriod) || !Number.isInteger(slowPeriod) || !Number.isInteger(signalPeriod) ||
      fastPeriod <= 0 || fastPeriod >= slowPeriod || signalPeriod <= 0) {
    throw new Error("MACD requires positive integer periods and fastPeriod < slowPeriod");
  }

  const fast = ema(values, fastPeriod);
  const slow = ema(values, slowPeriod);
  const line = values.map((_, index) => fast[index] === null || slow[index] === null ? null : fast[index]! - slow[index]!);
  const firstReady = slowPeriod - 1;
  const signalValues = ema(line.slice(firstReady).map((value) => value!), signalPeriod);
  const signal = values.map((_, index) => index < firstReady ? null : signalValues[index - firstReady]);
  const histogram = values.map((_, index) => line[index] === null || signal[index] === null ? null : line[index]! - signal[index]!);
  return { line, signal, histogram };
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

  if (unit === "w") {
    return value * 7 * 24 * 60;
  }

  throw new Error(`Unsupported timeframe: ${timeframe}`);
}

export type LevelSide = "support" | "resistance";
type Pivot = { price: number; time: number; index: number };
type Touch = { price: number; time: number };
type PriceZone = { level: number; zoneLow: number; zoneHigh: number; touches: number; time: number };
type LevelMatch = Omit<PriceZone, "time"> & {
  side: LevelSide;
  price: number;
  distancePct: number;
  levelTime: number;
  priceTime: number;
};

const levelAtrPeriod = 14;
const levelAtrHalfWidth = 0.25;
export const priceZoneLookbackBars = 120;

/** Pass only completed bars available when the levels are used. */
export function detectPriceZones(candles: Candle[]) {
  const bars = candles.filter((bar) =>
    Number.isFinite(bar.high) && Number.isFinite(bar.low) && Number.isFinite(bar.close) &&
    bar.high > 0 && bar.low > 0 && bar.close > 0
  ).slice(-priceZoneLookbackBars);
  if (bars.length < levelAtrPeriod) return null;
  const latestAtr = atr(bars, levelAtrPeriod).at(-1);
  if (latestAtr == null || !Number.isFinite(latestAtr) || latestAtr <= 0) return null;
  const halfWidth = latestAtr * levelAtrHalfWidth;
  const zones: Array<PriceZone & { side: LevelSide }> = [];

  for (const side of ["support", "resistance"] as const) {
    const pivots: Pivot[] = [];
    for (let i = 2; i < bars.length - 2; i++) {
      const price = side === "support" ? bars[i].low : bars[i].high;
      const neighbors = [bars[i - 2], bars[i - 1], bars[i + 1], bars[i + 2]]
        .map((bar) => side === "support" ? bar.low : bar.high);
      const isPivot = side === "support"
        ? neighbors.every((value) => price <= value) && neighbors.some((value) => price < value)
        : neighbors.every((value) => price >= value) && neighbors.some((value) => price > value);
      if (isPivot && Number.isFinite(price) && price > 0) pivots.push({ price, time: bars[i].closeTime, index: i });
    }
    zones.push(...buildPriceZones(pivots, bars, side, halfWidth).map((zone) => ({ ...zone, side })));
  }

  return { atr: latestAtr, latest: bars[bars.length - 1], zones };
}

/** A zone needs two independent five-bar swing touches in the latest 120 completed bars. */
export function findNearbyLevels(candles: Candle[], proximityPct: number): LevelMatch[] {
  const snapshot = detectPriceZones(candles);
  if (!snapshot) return [];
  const { latest, zones } = snapshot;
  const matches: LevelMatch[] = [];

  for (const side of ["support", "resistance"] as const) {
    const nearest = zones.filter((zone) => zone.side === side)
      .filter((zone) => side === "support" ? latest.close >= zone.zoneLow : latest.close <= zone.zoneHigh)
      .sort((a, b) => Math.abs(latest.close - a.level) - Math.abs(latest.close - b.level))[0];
    if (!nearest) continue;
    const distancePct = Math.abs(latest.close - nearest.level) / latest.close * 100;
    if (distancePct <= proximityPct) {
      matches.push({
        side,
        price: latest.close,
        level: nearest.level,
        zoneLow: nearest.zoneLow,
        zoneHigh: nearest.zoneHigh,
        distancePct,
        touches: nearest.touches,
        levelTime: nearest.time,
        priceTime: latest.closeTime
      });
    }
  }

  return matches;
}

function buildPriceZones(pivots: Pivot[], bars: Candle[], side: LevelSide, halfWidth: number): PriceZone[] {
  if (pivots.length < 2) return [];
  const seeds = new Set<number>(pivots.map((pivot) => pivot.price));
  for (let left = 0; left < pivots.length; left++) {
    for (let right = left + 1; right < pivots.length; right++) {
      if (Math.abs(pivots[left].price - pivots[right].price) <= halfWidth * 2) {
        seeds.add((pivots[left].price + pivots[right].price) / 2);
      }
    }
  }

  const zones: PriceZone[] = [];
  for (const seed of seeds) {
    const zone = refinePriceZone(seed, pivots, bars, side, halfWidth);
    if (!zone) continue;
    const duplicateIndex = zones.findIndex((item) => Math.abs(item.level - zone.level) <= halfWidth * 1e-6);
    if (duplicateIndex === -1) {
      zones.push(zone);
    } else if (zone.touches > zones[duplicateIndex].touches ||
      (zone.touches === zones[duplicateIndex].touches && zone.time > zones[duplicateIndex].time)) {
      zones[duplicateIndex] = zone;
    }
  }
  return zones;
}

function refinePriceZone(seed: number, pivots: Pivot[], bars: Candle[], side: LevelSide, halfWidth: number): PriceZone | null {
  let level = seed;
  let touches: Touch[] = [];
  for (let iteration = 0; iteration < 6; iteration++) {
    const zoneLow = level - halfWidth;
    const zoneHigh = level + halfWidth;
    const members = pivots.filter((pivot) => pivot.price >= zoneLow && pivot.price <= zoneHigh);
    touches = collapseTouchEpisodes(members, bars, side, zoneLow, zoneHigh);
    if (touches.length < 2) return null;
    const nextLevel = median(touches.map((touch) => touch.price));
    if (Math.abs(nextLevel - level) <= Math.max(Number.EPSILON * Math.abs(level), 1e-12)) {
      level = nextLevel;
      break;
    }
    level = nextLevel;
  }

  const zoneLow = level - halfWidth;
  const zoneHigh = level + halfWidth;
  touches = collapseTouchEpisodes(
    pivots.filter((pivot) => pivot.price >= zoneLow && pivot.price <= zoneHigh),
    bars,
    side,
    zoneLow,
    zoneHigh
  );
  if (touches.length < 2) return null;
  const finalLevel = median(touches.map((touch) => touch.price));
  return {
    level: finalLevel,
    zoneLow: finalLevel - halfWidth,
    zoneHigh: finalLevel + halfWidth,
    touches: touches.length,
    time: Math.max(...touches.map((touch) => touch.time))
  };
}

function collapseTouchEpisodes(pivots: Pivot[], bars: Candle[], side: LevelSide, zoneLow: number, zoneHigh: number): Touch[] {
  const ordered = [...pivots].sort((a, b) => a.index - b.index);
  if (ordered.length === 0) return [];
  const groups: Pivot[][] = [[ordered[0]]];
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const leftZone = bars.slice(previous.index + 1, current.index).some((bar) =>
      side === "support" ? bar.low > zoneHigh : bar.high < zoneLow
    );
    if (leftZone) groups.push([current]);
    else groups[groups.length - 1].push(current);
  }

  return groups.map((group) => ({
    price: side === "support"
      ? Math.min(...group.map((pivot) => pivot.price))
      : Math.max(...group.map((pivot) => pivot.price)),
    time: Math.max(...group.map((pivot) => pivot.time))
  }));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
