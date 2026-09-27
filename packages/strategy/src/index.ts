import { adx, atr, ema, macd, sma } from "@trend-trade/indicator";
import type { Candle, EmaTrendStrategyConfig, MacdTrendStrategyConfig, Signal, StrategyConfig } from "@trend-trade/shared";
import type { IncrementalStrategySession } from "./incremental";

export * from "./incremental";
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
    const currentTrendEma = this.trendEmaSeries[index];
    const currentAtr = this.atrSeries[index];
    const currentAdx = this.adxSeries[index];
    const currentVolumeMa = this.volumeMaSeries[index];

    if ([previousTrendEma, currentTrendEma].some((value) => value === null)) {
      return { type: "HOLD", reason: "Waiting for indicator warmup" };
    }

    const crossedUp = previousCandle.close <= previousTrendEma! && currentCandle.close > currentTrendEma!;
    const crossedDown = previousCandle.close >= previousTrendEma! && currentCandle.close < currentTrendEma!;
    const candle = this.candles[index];

    if (crossedUp) {
      if (this.config.direction === "SHORT_ONLY") {
        return this.config.exitTrigger === "EMA"
          ? {
              type: "CLOSE_SHORT",
              reason: `Close crossed above ${this.config.trendMaType ?? "EMA"}${this.config.trendEmaPeriod}`
            }
          : { type: "HOLD", reason: "EMA exit trigger disabled" };
      }

      if (this.config.direction !== "LONG_SHORT" || this.config.exitTrigger !== "EMA") {
        const entryFilterFailure = this.getEntryFilterFailure(currentAtr, currentAdx, currentVolumeMa, candle);
        if (entryFilterFailure) {
          return { type: "HOLD", reason: entryFilterFailure };
        }
      }

      return {
        type: "BUY",
        reason: `Close crossed above ${this.config.trendMaType ?? "EMA"}${this.config.trendEmaPeriod}`,
        stopPrice: this.config.atrStopEnabled && currentAtr !== null ? candle.close - currentAtr * this.config.atrMultiplier : undefined,
        allowPositionFlip: this.config.exitTrigger === "EMA"
      };
    }

    if (crossedDown) {
      if (this.config.direction === "LONG_ONLY") {
        return this.config.exitTrigger === "EMA"
          ? {
              type: "CLOSE_LONG",
              reason: `Close crossed below ${this.config.trendMaType ?? "EMA"}${this.config.trendEmaPeriod}`
            }
          : { type: "HOLD", reason: "EMA exit trigger disabled" };
      }

      if (this.config.direction !== "LONG_SHORT" || this.config.exitTrigger !== "EMA") {
        const entryFilterFailure = this.getEntryFilterFailure(currentAtr, currentAdx, currentVolumeMa, candle);
        if (entryFilterFailure) {
          return { type: "HOLD", reason: entryFilterFailure };
        }
      }

      return {
        type: "SELL_SHORT",
        reason: `Close crossed below ${this.config.trendMaType ?? "EMA"}${this.config.trendEmaPeriod}`,
        stopPrice: this.config.atrStopEnabled && currentAtr !== null ? candle.close + currentAtr * this.config.atrMultiplier : undefined,
        allowPositionFlip: this.config.exitTrigger === "EMA"
      };
    }

    return { type: "HOLD", reason: "No trend moving average cross" };
  }

  private getEntryFilterFailure(
    currentAtr: number | null,
    currentAdx: number | null,
    currentVolumeMa: number | null,
    candle: Candle
  ): string | null {
    return entryFilterFailure(this.config, currentAtr, currentAdx, currentVolumeMa, candle);
  }
}

function entryFilterFailure(
  config: EmaTrendStrategyConfig | MacdTrendStrategyConfig,
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
    const nearZero = Math.abs(currentLine) / candle.close * 100 <= this.config.zeroProximityPct;
    const filterFailure = this.config.zeroFilterEnabled && !nearZero
      ? `MACD line is farther than ${this.config.zeroProximityPct}% of price from zero`
      : entryFilterFailure(this.config, this.atrSeries[index], this.adxSeries[index], this.volumeMaSeries[index], candle);
    if (filterFailure) {
      return exitEnabled ? { type: closeType, reason: `${reason}; ${filterFailure}` } : { type: "HOLD", reason: filterFailure };
    }

    const currentAtr = this.atrSeries[index];
    return {
      type: crossedUp ? "BUY" : "SELL_SHORT",
      reason,
      stopPrice: this.config.atrStopEnabled && currentAtr !== null
        ? candle.close + (crossedUp ? -1 : 1) * currentAtr * this.config.atrMultiplier
        : undefined,
      allowPositionFlip: exitEnabled
    };
  }
}

export function createDefaultStrategyRegistry(candles: Candle[]): StrategyRegistry {
  const registry = new StrategyRegistry();
  registry.register("EMA_TREND", (config) => new EmaTrendStrategy(candles, config));
  registry.register("MACD_TREND", (config) => new MacdTrendStrategy(candles, config));
  return registry;
}
