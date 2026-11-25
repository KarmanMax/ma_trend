import { adx, atr, detectPriceZones, ema, macd, priceZoneLookbackBars, sma } from "@trend-trade/indicator";
import { defaultLevelMinClearanceAtr, type Candle, type EmaTrendStrategyConfig, type EntrySignalType, type MacdMomentumStrategyConfig, type MacdMomentumTrendStrategyConfig, type MacdTrendStrategyConfig, type Signal, type StrategyConfig } from "@trend-trade/shared";
import type { IncrementalStrategySession } from "./incremental";

export * from "./incremental";
export * from "./pump-reversal";
export * from "./wyckoff";

export type StrategyContext<TConfig extends StrategyConfig = StrategyConfig> = {
  candles: Candle[];
  index: number;
  config: TConfig;
};

export interface Strategy<TConfig extends StrategyConfig = StrategyConfig> {
  id: string;
  name: string;
  generateSignal(context: StrategyContext<TConfig>): Signal;
  revalidateEntry?(index: number, type: EntrySignalType): Signal | null;
}

export type StrategyImplementation = Strategy<StrategyConfig> | IncrementalStrategySession;

export interface StrategyFactory {
  create(config: StrategyConfig): StrategyImplementation;
}

export class StrategyRegistry implements StrategyFactory {
  private readonly factories = new Map<StrategyConfig["type"], (config: StrategyConfig) => StrategyImplementation>();

  register<T extends StrategyConfig["type"]>(type: T, factory: (config: Extract<StrategyConfig, { type: T }>) => StrategyImplementation): void {
    this.factories.set(type, factory as (config: StrategyConfig) => StrategyImplementation);
  }

  create(config: StrategyConfig): StrategyImplementation {
    const factory = this.factories.get(config.type);
    if (!factory) {
      throw new Error(`Strategy is not registered: ${config.type}`);
    }

    return factory(config);
  }
}

export class EmaTrendStrategy implements Strategy<EmaTrendStrategyConfig> {
  readonly id = "EMA_TREND";
  readonly name = "EMA Trend Following";
  private readonly trendEmaSeries: Array<number | null>;
  private readonly atrSeries: Array<number | null>;
  private readonly adxSeries: Array<number | null>;
  private readonly volumeMaSeries: Array<number | null>;

  constructor(private readonly candles: Candle[], private readonly config: EmaTrendStrategyConfig) {
    const closes = candles.map((candle) => candle.close);
    this.trendEmaSeries = (config.trendMaType === "MA" ? sma : ema)(closes, config.trendEmaPeriod);
    this.atrSeries = atr(candles, config.atrPeriod);
    this.adxSeries = adx(candles, config.adxPeriod);
    this.volumeMaSeries = sma(candles.map((candle) => candle.volume), config.volumeMaPeriod);
  }

  generateSignal(context: StrategyContext<EmaTrendStrategyConfig>): Signal {
    const { index } = context;
    if (index === 0) {
      return { type: "HOLD", reason: "Waiting for indicator warmup" };
    }

    const previousCandle = this.candles[index - 1];
    const currentCandle = this.candles[index];
    const previousTrendEma = this.trendEmaSeries[index - 1];
    if (previousTrendEma == null) {
      return { type: "HOLD", reason: "Waiting for indicator warmup" };
    }

    const averageName = `${this.config.trendMaType ?? "EMA"}${this.config.trendEmaPeriod}`;
    if (this.config.trendTriggerMode === "CLOSE_CROSS") {
      const currentTrendEma = this.trendEmaSeries[index];
      if (currentTrendEma == null) {
        return { type: "HOLD", reason: "Waiting for indicator warmup" };
      }
      const crossedUp = previousCandle.close <= previousTrendEma && currentCandle.close > currentTrendEma;
      const crossedDown = previousCandle.close >= previousTrendEma && currentCandle.close < currentTrendEma;
      if (!crossedUp && !crossedDown) {
        return { type: "HOLD", reason: "No trend moving average cross" };
      }
      return this.signalForCross(
        crossedUp ? "BUY" : "SELL_SHORT", index, `Close crossed ${crossedUp ? "above" : "below"} ${averageName}`
      );
    }

    const touch = movingAverageTouch(previousCandle.close, currentCandle, previousTrendEma);
    if (!touch) {
      return { type: "HOLD", reason: "No directional moving average touch" };
    }
    return this.signalForCross(
      touch.type, index, `Price reached ${averageName} from ${touch.type === "BUY" ? "below" : "above"}`, touch.trigger
    );
  }

  private signalForCross(type: EntrySignalType, index: number, reason: string, trigger?: Signal["trigger"]): Signal {
    const crossedUp = type === "BUY";
    const exitEnabled = this.config.exitTrigger === "EMA";
    const closeType = crossedUp ? "CLOSE_SHORT" : "CLOSE_LONG";
    const triggerFields = trigger ? { trigger } : {};
    const directionExcluded = crossedUp ? this.config.direction === "SHORT_ONLY" : this.config.direction === "LONG_ONLY";
    if (directionExcluded) {
      return exitEnabled ? { type: closeType, reason, ...triggerFields } : { type: "HOLD", reason: "EMA exit trigger disabled" };
    }

    const indicatorIndex = trigger ? index - 1 : index;
    const candle = this.candles[indicatorIndex];
    const referencePrice = trigger?.price ?? candle.close;
    const currentAtr = this.atrSeries[indicatorIndex];
    const filterFailure = entryFilterFailure(
      this.config, currentAtr, this.adxSeries[indicatorIndex], this.volumeMaSeries[indicatorIndex], candle
    ) ?? levelEntryFilterFailure(this.config, this.candles, index, type, referencePrice);
    if (filterFailure) {
      return exitEnabled ? { type: closeType, reason: `${reason}; ${filterFailure}`, ...triggerFields } : { type: "HOLD", reason: filterFailure };
    }

    const signal = { ...entrySignal(this.config, referencePrice, currentAtr, type, reason), ...triggerFields };
    if (trigger && this.config.exitOnFailedBreakout) {
      signal.entryInvalidationLevel = this.trendEmaSeries[indicatorIndex]!;
    }
    return signal;
  }

  revalidateEntry(index: number, type: EntrySignalType): Signal | null {
    const candle = this.candles[index];
    const average = this.trendEmaSeries[index];
    if (average == null || !isEntryDirectionValid(type, candle.close - average, this.config)) {
      return null;
    }
    const currentAtr = this.atrSeries[index];
    if (entryFilterFailure(this.config, currentAtr, this.adxSeries[index], this.volumeMaSeries[index], candle)
      || levelEntryFilterFailure(this.config, this.candles, index, type, candle.close)) {
      return null;
    }
    if (this.config.filterExtendedCooldownEntries && currentAtr != null && currentAtr > 0) {
      const momentumBase = this.candles[index - 20]?.close;
      if (momentumBase !== undefined
        && isEntryDirectionValid(type, candle.close - momentumBase, this.config)
        && Math.abs(candle.close - average) >= 2 * currentAtr) {
        return null;
      }
    }
    return entrySignal(this.config, candle.close, currentAtr, type, "Moving average entry confirmed after cooldown");
  }
}

function movingAverageTouch(previousClose: number, candle: Candle, average: number): {
  type: EntrySignalType;
  trigger: NonNullable<Signal["trigger"]>;
} | null {
  // If the prior close and the open both equal the level, OHLC can establish
  // direction only when price moves to one side of the level.
  const startsOnLevel = previousClose === average && candle.open === average;
  const upward = startsOnLevel
    ? candle.high > average && candle.low === average
    : previousClose < average || (previousClose === average && candle.open > average);
  const downward = startsOnLevel
    ? candle.low < average && candle.high === average
    : previousClose > average || (previousClose === average && candle.open < average);
  if (upward && candle.high >= average) {
    return { type: "BUY", trigger: !startsOnLevel && candle.open >= average ? { price: candle.open, at: "OPEN" } : { price: average, at: "INTRABAR" } };
  }
  if (downward && candle.low <= average) {
    return { type: "SELL_SHORT", trigger: !startsOnLevel && candle.open <= average ? { price: candle.open, at: "OPEN" } : { price: average, at: "INTRABAR" } };
  }
  return null;
}

function isEntryDirectionValid(type: EntrySignalType, signedStrength: number, config: StrategyConfig): boolean {
  return type === "BUY"
    ? config.direction !== "SHORT_ONLY" && signedStrength > 0
    : config.direction !== "LONG_ONLY" && signedStrength < 0;
}

function entrySignal(config: StrategyConfig, referencePrice: number, currentAtr: number | null, type: EntrySignalType, reason: string): Signal {
  return {
    type,
    reason,
    stopPrice: config.atrStopEnabled && currentAtr !== null
      ? referencePrice + (type === "BUY" ? -1 : 1) * currentAtr * config.atrMultiplier
      : undefined,
    allowPositionFlip: config.exitTrigger !== "NONE"
  };
}

function entryFilterFailure(
  config: StrategyConfig,
  currentAtr: number | null,
  currentAdx: number | null,
  currentVolumeMa: number | null,
  candle: Candle
): string | null {
  if (config.atrStopEnabled && currentAtr === null) {
    return "Waiting for ATR warmup";
  }

  if (config.adxFilterEnabled) {
    if (currentAdx === null) {
      return "Waiting for ADX warmup";
    }
    if (currentAdx < config.adxThreshold) {
      return `ADX ${currentAdx.toFixed(2)} below ${config.adxThreshold}`;
    }
  }

  if (config.volumeFilterEnabled) {
    if (currentVolumeMa === null) {
      return "Waiting for volume MA warmup";
    }
    if (candle.volume < currentVolumeMa * config.volumeMultiplier) {
      return "Volume below filter threshold";
    }
  }

  return null;
}

function macdEntryFilterFailure(
  config: Exclude<StrategyConfig, EmaTrendStrategyConfig>,
  currentLine: number,
  currentAtr: number | null,
  currentAdx: number | null,
  currentVolumeMa: number | null,
  candle: Candle
): string | null {
  const nearZero = Math.abs(currentLine) / candle.close * 100 <= config.zeroProximityPct;
  if (config.zeroFilterEnabled && !nearZero) {
    return `MACD line is farther than ${config.zeroProximityPct}% of price from zero`;
  }
  return entryFilterFailure(config, currentAtr, currentAdx, currentVolumeMa, candle);
}

function levelEntryFilterFailure(
  config: StrategyConfig, candles: Candle[], index: number, type: EntrySignalType, referencePrice: number
): string | null {
  if (!config.levelFilterEnabled) return null;

  // Freeze the zones before the signal bar, including for fills triggered intrabar.
  const snapshot = detectPriceZones(candles.slice(Math.max(0, index - priceZoneLookbackBars), index));
  if (!snapshot) return "Waiting for support/resistance ATR warmup";
  const minimumAtr = config.levelMinClearanceAtr ?? defaultLevelMinClearanceAtr;
  const minimumDistance = snapshot.atr * minimumAtr;
  const obstacle = snapshot.zones.some((zone) => type === "BUY"
    ? zone.side === "resistance" && referencePrice <= zone.zoneHigh && zone.zoneLow - referencePrice < minimumDistance
    : zone.side === "support" && referencePrice >= zone.zoneLow && referencePrice - zone.zoneHigh < minimumDistance);
  return obstacle ? `${type === "BUY" ? "Resistance" : "Support"} zone within ${minimumAtr} ATR of entry` : null;
}

export class MacdTrendStrategy implements Strategy<MacdTrendStrategyConfig> {
  readonly id = "MACD_TREND";
  readonly name = "MACD Trend Following";
  private readonly macdSeries: ReturnType<typeof macd>;
  private readonly atrSeries: Array<number | null>;
  private readonly adxSeries: Array<number | null>;
  private readonly volumeMaSeries: Array<number | null>;

  constructor(private readonly candles: Candle[], private readonly config: MacdTrendStrategyConfig) {
    this.macdSeries = macd(candles.map((candle) => candle.close), config.macdFastPeriod, config.macdSlowPeriod, config.macdSignalPeriod);
    this.atrSeries = atr(candles, config.atrPeriod);
    this.adxSeries = adx(candles, config.adxPeriod);
    this.volumeMaSeries = sma(candles.map((candle) => candle.volume), config.volumeMaPeriod);
  }

  generateSignal({ index }: StrategyContext<MacdTrendStrategyConfig>): Signal {
    const previousLine = this.macdSeries.line[index - 1];
    const previousSignal = this.macdSeries.signal[index - 1];
    const currentLine = this.macdSeries.line[index];
    const currentSignal = this.macdSeries.signal[index];
    if (previousLine == null || previousSignal == null || currentLine == null || currentSignal == null) {
      return { type: "HOLD", reason: "Waiting for MACD warmup" };
    }

    const crossedUp = previousLine <= previousSignal && currentLine > currentSignal;
    const crossedDown = previousLine >= previousSignal && currentLine < currentSignal;
    if (!crossedUp && !crossedDown) {
      return { type: "HOLD", reason: "No MACD cross" };
    }

    const exitEnabled = this.config.exitTrigger === "MACD";
    const reason = crossedUp ? "MACD golden cross" : "MACD death cross";
    const closeType = crossedUp ? "CLOSE_SHORT" : "CLOSE_LONG";
    const directionExcluded = crossedUp ? this.config.direction === "SHORT_ONLY" : this.config.direction === "LONG_ONLY";
    if (directionExcluded) {
      return exitEnabled ? { type: closeType, reason } : { type: "HOLD", reason: "MACD exit trigger disabled" };
    }

    const candle = this.candles[index];
    const currentAtr = this.atrSeries[index];
    const type = crossedUp ? "BUY" : "SELL_SHORT";
    const filterFailure = macdEntryFilterFailure(this.config, currentLine, currentAtr, this.adxSeries[index], this.volumeMaSeries[index], candle)
      ?? levelEntryFilterFailure(this.config, this.candles, index, type, candle.close);
    if (filterFailure) {
      return exitEnabled ? { type: closeType, reason: `${reason}; ${filterFailure}` } : { type: "HOLD", reason: filterFailure };
    }

    return entrySignal(this.config, candle.close, currentAtr, type, reason);
  }

  revalidateEntry(index: number, type: EntrySignalType): Signal | null {
    const line = this.macdSeries.line[index];
    const histogram = this.macdSeries.histogram[index];
    if (line == null || histogram == null || !isEntryDirectionValid(type, histogram, this.config)) {
      return null;
    }
    const candle = this.candles[index];
    const currentAtr = this.atrSeries[index];
    if (macdEntryFilterFailure(this.config, line, currentAtr, this.adxSeries[index], this.volumeMaSeries[index], candle)
      || levelEntryFilterFailure(this.config, this.candles, index, type, candle.close)) {
      return null;
    }
    return entrySignal(this.config, candle.close, currentAtr, type, "MACD entry confirmed after cooldown");
  }
}

abstract class MacdHistogramStrategy<TConfig extends MacdMomentumStrategyConfig | MacdMomentumTrendStrategyConfig> implements Strategy<TConfig> {
  abstract readonly id: string;
  abstract readonly name: string;
  private readonly macdSeries: ReturnType<typeof macd>;
  private readonly trendEmaSeries: Array<number | null> | null;
  private readonly atrSeries: Array<number | null>;
  private readonly adxSeries: Array<number | null>;
  private readonly volumeMaSeries: Array<number | null>;

  constructor(private readonly candles: Candle[], private readonly config: TConfig) {
    const closes = candles.map((candle) => candle.close);
    this.macdSeries = macd(closes, config.macdFastPeriod, config.macdSlowPeriod, config.macdSignalPeriod);
    this.trendEmaSeries = config.type === "MACD_MOMENTUM_TREND" ? ema(closes, config.trendEmaPeriod) : null;
    this.atrSeries = atr(candles, config.atrPeriod);
    this.adxSeries = adx(candles, config.adxPeriod);
    this.volumeMaSeries = sma(candles.map((candle) => candle.volume), config.volumeMaPeriod);
  }

  generateSignal({ index }: StrategyContext<TConfig>): Signal {
    const twoBarsAgo = this.macdSeries.histogram[index - 2];
    const previous = this.macdSeries.histogram[index - 1];
    const current = this.macdSeries.histogram[index];
    const currentLine = this.macdSeries.line[index];
    if (twoBarsAgo == null || previous == null || current == null || currentLine == null) {
      return { type: "HOLD", reason: "Waiting for MACD histogram warmup" };
    }

    // A fill-state switch is meaningful only within bars on the same side of zero.
    // On either side, a slope reversal upward is bullish and downward is bearish.
    const sameColor = Math.sign(twoBarsAgo) === Math.sign(previous) && Math.sign(previous) === Math.sign(current) && current !== 0;
    const previousSlope = previous - twoBarsAgo;
    const currentSlope = current - previous;
    const turnedUp = sameColor && previousSlope <= 0 && currentSlope > 0;
    const turnedDown = sameColor && previousSlope >= 0 && currentSlope < 0;
    if (!turnedUp && !turnedDown) {
      return { type: "HOLD", reason: "No MACD histogram fill-state change" };
    }

    const type = turnedUp ? "BUY" : "SELL_SHORT";
    const trendFailure = this.trendFilterFailure(index, type);
    if (trendFailure) {
      return { type: "HOLD", reason: trendFailure };
    }

    const exitEnabled = this.config.exitTrigger === this.config.type;
    const momentumReason = turnedUp ? "MACD histogram turned upward" : "MACD histogram turned downward";
    const reason = this.config.type === "MACD_MOMENTUM_TREND"
      ? `${momentumReason} with close ${turnedUp ? "above" : "below"} EMA${this.config.trendEmaPeriod}`
      : momentumReason;
    const closeType = turnedUp ? "CLOSE_SHORT" : "CLOSE_LONG";
    const directionExcluded = turnedUp ? this.config.direction === "SHORT_ONLY" : this.config.direction === "LONG_ONLY";
    if (directionExcluded) {
      return exitEnabled ? { type: closeType, reason } : { type: "HOLD", reason: "MACD momentum exit trigger disabled" };
    }

    const candle = this.candles[index];
    const currentAtr = this.atrSeries[index];
    const filterFailure = macdEntryFilterFailure(this.config, currentLine, currentAtr, this.adxSeries[index], this.volumeMaSeries[index], candle)
      ?? levelEntryFilterFailure(this.config, this.candles, index, type, candle.close);
    if (filterFailure) {
      return exitEnabled ? { type: closeType, reason: `${reason}; ${filterFailure}` } : { type: "HOLD", reason: filterFailure };
    }

    return entrySignal(this.config, candle.close, currentAtr, type, reason);
  }

  revalidateEntry(index: number, type: EntrySignalType): Signal | null {
    const line = this.macdSeries.line[index];
    const previous = this.macdSeries.histogram[index - 1];
    const current = this.macdSeries.histogram[index];
    if (line == null || previous == null || current == null || Math.sign(previous) !== Math.sign(current)
      || !isEntryDirectionValid(type, current - previous, this.config) || this.trendFilterFailure(index, type)) {
      return null;
    }
    const candle = this.candles[index];
    const currentAtr = this.atrSeries[index];
    if (macdEntryFilterFailure(this.config, line, currentAtr, this.adxSeries[index], this.volumeMaSeries[index], candle)
      || levelEntryFilterFailure(this.config, this.candles, index, type, candle.close)) {
      return null;
    }
    return entrySignal(this.config, candle.close, currentAtr, type, "MACD momentum entry confirmed after cooldown");
  }

  private trendFilterFailure(index: number, type: EntrySignalType): string | null {
    if (!this.trendEmaSeries) return null;
    const average = this.trendEmaSeries[index];
    if (average == null) return "Waiting for EMA trend warmup";

    const close = this.candles[index].close;
    const aligned = type === "BUY" ? close > average : close < average;
    return aligned ? null : "Close is not on the required side of the trend EMA";
  }
}

export class MacdMomentumStrategy extends MacdHistogramStrategy<MacdMomentumStrategyConfig> {
  readonly id = "MACD_MOMENTUM";
  readonly name = "MACD Histogram Momentum Reversal";
}

export class MacdMomentumTrendStrategy extends MacdHistogramStrategy<MacdMomentumTrendStrategyConfig> {
  readonly id = "MACD_MOMENTUM_TREND";
  readonly name = "MACD Momentum + EMA Trend";
}

export function createDefaultStrategyRegistry(candles: Candle[]): StrategyRegistry {
  const registry = new StrategyRegistry();
  registry.register("EMA_TREND", (config) => new EmaTrendStrategy(candles, config));
  registry.register("MACD_TREND", (config) => new MacdTrendStrategy(candles, config));
  registry.register("MACD_MOMENTUM", (config) => new MacdMomentumStrategy(candles, config));
  registry.register("MACD_MOMENTUM_TREND", (config) => new MacdMomentumTrendStrategy(candles, config));
  return registry;
}
