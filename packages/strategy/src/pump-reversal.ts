import { ema, sma } from "@trend-trade/indicator";
import { timeframeMilliseconds, type Candle } from "@trend-trade/shared";

export type PumpReversalSetup = "PUMP_BREAKDOWN_SHORT" | "CAPITULATION_RECLAIM_LONG";

export type PumpReversalConfig = {
  pumpLookbackBars: number;
  pumpMinimumReturn: number;
  breakdownMaxBars: number;
  breakdownMinimumDrawdown: number;
  breakdownVolumeRatio: number;
  capitulationMinimumDrawdown: number;
  capitulationVolumeRatio: number;
  capitulationMinimumLowerWick: number;
  reclaimMaxBars: number;
};

export const defaultPumpReversalConfig: PumpReversalConfig = {
  pumpLookbackBars: 96,
  pumpMinimumReturn: 0.3,
  breakdownMaxBars: 32,
  breakdownMinimumDrawdown: 0.18,
  breakdownVolumeRatio: 2,
  capitulationMinimumDrawdown: 0.3,
  capitulationVolumeRatio: 2.5,
  capitulationMinimumLowerWick: 0.3,
  reclaimMaxBars: 8
};

export const pumpBreakdownRules = {
  pumpLookbackBars: 24,
  pumpMinimumReturn: 0.5,
  momentumBars: 3,
  maximumMomentumRatio: 0.5
} as const;

type PumpSlowdown = {
  pumpDurationMinutes: number;
  momentumBeforePeak: number;
  momentumAfterPeak: number;
  slowdownTime: number;
};

export type PumpReversalSignal = {
  setup: PumpReversalSetup;
  symbol: string;
  peakIndex: number;
  signalIndex: number;
  entryIndex: number;
  peakTime: number;
  signalTime: number;
  entryTime: number | null;
  entryPrice: number | null;
  pumpReturn: number;
  drawdownFromPeak: number;
  volumeRatio: number;
  invalidationPrice: number;
  slowdown?: PumpSlowdown;
};

/**
 * Detects setups at the confirming close. The next open is attached when it is
 * present in the input, and is required only to evaluate historical outcomes.
 */
export function detectPumpReversalSignals(
  candles: Candle[],
  config: PumpReversalConfig = defaultPumpReversalConfig
): PumpReversalSignal[] {
  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume);
  const ema20 = ema(closes, 20);
  const ema200 = ema(closes, 200);
  const volumeMa20 = sma(volumes, 20);
  const signals = detectPumpBreakdowns(candles, ema20, volumeMa20, config);
  if (candles.length < Math.max(config.pumpLookbackBars + 1, 200)) return signals;

  const emitted = new Set<string>();
  let lastProcessedPeak = -1;

  for (let peakIndex = config.pumpLookbackBars; peakIndex < candles.length - 1; peakIndex += 1) {
    const peak = candles[peakIndex];
    const prior = candles.slice(peakIndex - config.pumpLookbackBars, peakIndex);
    const baseline = Math.min(...prior.map((candle) => candle.close));
    const pumpReturn = peak.high / baseline - 1;
    if (pumpReturn < config.pumpMinimumReturn) continue;

    // Causal peak candidate: only compare with candles already closed at the
    // candidate time. The later breakdown supplies confirmation.
    const localStart = Math.max(0, peakIndex - 4);
    if (peak.high < Math.max(...candles.slice(localStart, peakIndex + 1).map((candle) => candle.high))) continue;
    if (peakIndex <= lastProcessedPeak) continue;

    const breakdownEnd = Math.min(candles.length - 1, peakIndex + config.breakdownMaxBars);
    let breakdownIndex = -1;
    for (let index = peakIndex + 1; index <= breakdownEnd; index += 1) {
      const candle = candles[index];
      // A new high supersedes this candidate; the later peak will be evaluated
      // independently with all information available at its own breakdown.
      if (candle.high > peak.high) {
        break;
      }
      if (isVolumeBreakdown(candle, peak.high, ema20[index], volumeMa20[index - 1], config)) {
        breakdownIndex = index;
        break;
      }
    }

    if (breakdownIndex < 0) continue;

    const capitulationEnd = Math.min(candles.length - 1, breakdownIndex + config.breakdownMaxBars);
    let capitulationIndex = -1;
    for (let index = breakdownIndex; index <= capitulationEnd; index += 1) {
      const candle = candles[index];
      const averageVolume = volumeMa20[index - 1];
      if (averageVolume == null || averageVolume <= 0) continue;
      const range = candle.high - candle.low;
      const lowerWick = Math.min(candle.open, candle.close) - candle.low;
      const wickRatio = range <= 0 ? 0 : lowerWick / range;
      const drawdown = 1 - candle.low / peak.high;
      const volumeRatio = candle.volume / averageVolume;
      if (drawdown >= config.capitulationMinimumDrawdown && volumeRatio >= config.capitulationVolumeRatio &&
          wickRatio >= config.capitulationMinimumLowerWick) {
        capitulationIndex = index;
        break;
      }
    }

    if (capitulationIndex >= 0) {
      const capitulation = candles[capitulationIndex];
      const midpoint = (capitulation.high + capitulation.low) / 2;
      const reclaimEnd = Math.min(candles.length - 1, capitulationIndex + config.reclaimMaxBars);
      for (let index = capitulationIndex + 1; index <= reclaimEnd; index += 1) {
        const candle = candles[index];
        const longTermAverage = ema200[index];
        if (longTermAverage != null && candle.close > midpoint && candle.close >= longTermAverage) {
          const averageVolume = volumeMa20[capitulationIndex - 1]!;
          pushUniqueSignal(signals, emitted, buildSignal(
            "CAPITULATION_RECLAIM_LONG", candles, peakIndex, index, pumpReturn,
            capitulation.volume / averageVolume, capitulation.low
          ));
          break;
        }
      }
    }

    // Treat nearby highs as one pump episode rather than inflating the sample
    // with several entries from the same liquidation sequence.
    lastProcessedPeak = peakIndex + config.breakdownMaxBars;
  }

  return signals.sort((left, right) => left.signalIndex - right.signalIndex);
}

function detectPumpBreakdowns(
  candles: Candle[], ema20: Array<number | null>, volumeMa20: Array<number | null>, config: PumpReversalConfig
): PumpReversalSignal[] {
  const signals: PumpReversalSignal[] = [];
  const { pumpLookbackBars, pumpMinimumReturn, momentumBars, maximumMomentumRatio } = pumpBreakdownRules;
  const barMs = timeframeMilliseconds["15m"];
  let cooldownEnd = -1;

  for (let peakIndex = pumpLookbackBars; peakIndex < candles.length - momentumBars; peakIndex += 1) {
    if (peakIndex <= cooldownEnd) continue;
    const peak = candles[peakIndex];
    const lookback = candles.slice(peakIndex - pumpLookbackBars, peakIndex);
    if (peak.openTime - lookback[0].openTime !== pumpLookbackBars * barMs) continue;
    if (lookback.slice(-4).some((bar) => bar.high > peak.high)) continue;
    const baseline = lookback.reduce((lowest, bar) => bar.close <= lowest.close ? bar : lowest);
    if (baseline.close <= 0 || peak.high <= baseline.close * (1 + pumpMinimumReturn)) continue;

    const momentumBeforePeak = peak.close / candles[peakIndex - momentumBars].close - 1;
    if (momentumBeforePeak <= 0) continue;
    let slowdown: PumpSlowdown | undefined;
    const end = Math.min(candles.length - 1, peakIndex + config.breakdownMaxBars);
    for (let index = peakIndex + 1; index <= end; index += 1) {
      const bar = candles[index];
      const previous = candles[index - 1];
      if (bar.high > peak.high || bar.openTime - previous.openTime !== barMs) break;

      if (slowdown) {
        const beforePrevious = candles[index - 2];
        const lowerHighs = bar.high < previous.high && previous.high < beforePrevious.high;
        const lowerCloses = bar.close < previous.close && previous.close < beforePrevious.close;
        if (lowerHighs && lowerCloses && isVolumeBreakdown(bar, peak.high, ema20[index], volumeMa20[index - 1], config)) {
          const signal = buildSignal(
            "PUMP_BREAKDOWN_SHORT", candles, peakIndex, index, peak.high / baseline.close - 1,
            bar.volume / volumeMa20[index - 1]!, peak.high
          );
          signals.push({ ...signal, slowdown });
          cooldownEnd = index + config.breakdownMaxBars;
          break;
        }
      } else if (index >= peakIndex + momentumBars) {
        const momentumAfterPeak = bar.close / candles[index - momentumBars].close - 1;
        if (momentumAfterPeak <= momentumBeforePeak * maximumMomentumRatio) {
          slowdown = {
            pumpDurationMinutes: (peak.closeTime - baseline.closeTime) / 60_000,
            momentumBeforePeak,
            momentumAfterPeak,
            slowdownTime: bar.closeTime
          };
        }
      }
    }
  }
  return signals;
}

function isVolumeBreakdown(
  candle: Candle, peakHigh: number, average: number | null, averageVolume: number | null, config: PumpReversalConfig
): boolean {
  return average != null && averageVolume != null && averageVolume > 0
    && candle.close < average && 1 - candle.close / peakHigh >= config.breakdownMinimumDrawdown
    && candle.volume / averageVolume >= config.breakdownVolumeRatio;
}

function pushUniqueSignal(signals: PumpReversalSignal[], emitted: Set<string>, signal: PumpReversalSignal): void {
  const key = `${signal.setup}:${signal.signalIndex}`;
  if (emitted.has(key)) return;
  emitted.add(key);
  signals.push(signal);
}

function buildSignal(
  setup: PumpReversalSetup,
  candles: Candle[],
  peakIndex: number,
  signalIndex: number,
  pumpReturn: number,
  volumeRatio: number,
  invalidationPrice: number
): PumpReversalSignal {
  const peak = candles[peakIndex];
  const signal = candles[signalIndex];
  const entryIndex = signalIndex + 1;
  return {
    setup,
    symbol: signal.symbol,
    peakIndex,
    signalIndex,
    entryIndex,
    peakTime: peak.closeTime,
    signalTime: signal.closeTime,
    entryTime: candles[entryIndex]?.openTime ?? null,
    entryPrice: candles[entryIndex]?.open ?? null,
    pumpReturn,
    drawdownFromPeak: 1 - signal.close / peak.high,
    volumeRatio,
    invalidationPrice
  };
}

export type SignalOutcome = PumpReversalSignal & {
  horizonBars: number;
  directionalReturn: number;
  favorableExcursion: number;
  adverseExcursion: number;
};

export function evaluatePumpReversalSignals(
  candles: Candle[], signals: PumpReversalSignal[], horizonBars = 16, roundTripCost = 0.002
): SignalOutcome[] {
  return signals.flatMap((signal) => {
    const endIndex = signal.entryIndex + horizonBars - 1;
    const { entryPrice } = signal;
    if (entryPrice === null || endIndex >= candles.length) return [];
    const window = candles.slice(signal.entryIndex, endIndex + 1);
    const exit = window.at(-1)!.close;
    const isLong = signal.setup === "CAPITULATION_RECLAIM_LONG";
    const rawReturn = isLong ? exit / entryPrice - 1 : entryPrice / exit - 1;
    const favorableExcursion = isLong
      ? Math.max(...window.map((candle) => candle.high / entryPrice - 1))
      : Math.max(...window.map((candle) => entryPrice / candle.low - 1));
    const adverseExcursion = isLong
      ? Math.min(...window.map((candle) => candle.low / entryPrice - 1))
      : Math.min(...window.map((candle) => entryPrice / candle.high - 1));
    return [{ ...signal, horizonBars, directionalReturn: rawReturn - roundTripCost, favorableExcursion, adverseExcursion }];
  });
}
