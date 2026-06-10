import { adx, atr, ema, sma } from "@trend-trade/indicator";
import type { Candle, EmaTrendStrategyConfig, Signal, StrategyConfig } from "@trend-trade/shared";

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

export interface StrategyFactory {
  create(config: StrategyConfig): Strategy;
}

export class StrategyRegistry implements StrategyFactory {
  private readonly factories = new Map<StrategyConfig["type"], (config: StrategyConfig) => Strategy>();

  register<T extends StrategyConfig["type"]>(type: T, factory: (config: Extract<StrategyConfig, { type: T }>) => Strategy): void {
    this.factories.set(type, factory as (config: StrategyConfig) => Strategy);
  }

  create(config: StrategyConfig): Strategy {
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
  private readonly emaFastSeries: Array<number | null>;
  private readonly emaSlowSeries: Array<number | null>;
  private readonly atrSeries: Array<number | null>;
  private readonly adxSeries: Array<number | null>;
  private readonly volumeMaSeries: Array<number | null>;

  constructor(private readonly candles: Candle[], private readonly config: EmaTrendStrategyConfig) {
    const closes = candles.map((candle) => candle.close);
    this.emaFastSeries = ema(closes, config.emaFast);
    this.emaSlowSeries = ema(closes, config.emaSlow);
    this.atrSeries = atr(candles, config.atrPeriod);
    this.adxSeries = adx(candles, config.adxPeriod);
    this.volumeMaSeries = sma(candles.map((candle) => candle.volume), config.volumeMaPeriod);
  }

  generateSignal(context: StrategyContext<EmaTrendStrategyConfig>): Signal {
    const { index } = context;
    if (index === 0) {
      return { type: "HOLD", reason: "Waiting for indicator warmup" };
    }

    const previousFast = this.emaFastSeries[index - 1];
    const previousSlow = this.emaSlowSeries[index - 1];
    const currentFast = this.emaFastSeries[index];
    const currentSlow = this.emaSlowSeries[index];
    const currentAtr = this.atrSeries[index];
    const currentAdx = this.adxSeries[index];
    const currentVolumeMa = this.volumeMaSeries[index];

    if ([previousFast, previousSlow, currentFast, currentSlow].some((value) => value === null)) {
      return { type: "HOLD", reason: "Waiting for indicator warmup" };
    }

    const crossedUp = previousFast! <= previousSlow! && currentFast! > currentSlow!;
    const crossedDown = previousFast! >= previousSlow! && currentFast! < currentSlow!;
    const candle = this.candles[index];

    if (crossedUp) {
      if (this.config.direction === "SHORT_ONLY") {
        return this.config.exitTrigger === "EMA"
          ? {
              type: "CLOSE_SHORT",
              reason: `EMA${this.config.emaFast} crossed above EMA${this.config.emaSlow}`
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
        reason: `EMA${this.config.emaFast} crossed above EMA${this.config.emaSlow}`,
        stopPrice: this.config.atrStopEnabled && currentAtr !== null ? candle.close - currentAtr * this.config.atrMultiplier : undefined,
        allowPositionFlip: this.config.exitTrigger === "EMA"
      };
    }

    if (crossedDown) {
      if (this.config.direction === "LONG_ONLY") {
        return this.config.exitTrigger === "EMA"
          ? {
              type: "CLOSE_LONG",
              reason: `EMA${this.config.emaFast} crossed below EMA${this.config.emaSlow}`
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
        reason: `EMA${this.config.emaFast} crossed below EMA${this.config.emaSlow}`,
        stopPrice: this.config.atrStopEnabled && currentAtr !== null ? candle.close + currentAtr * this.config.atrMultiplier : undefined,
        allowPositionFlip: this.config.exitTrigger === "EMA"
      };
    }

    return { type: "HOLD", reason: "No crossover" };
  }

  private getEntryFilterFailure(
    currentAtr: number | null,
    currentAdx: number | null,
    currentVolumeMa: number | null,
    candle: Candle
  ): string | null {
    if (this.config.atrStopEnabled && currentAtr === null) {
      return "Waiting for ATR warmup";
    }

    if (this.config.adxFilterEnabled) {
      if (currentAdx === null) {
        return "Waiting for ADX warmup";
      }
      if (currentAdx < this.config.adxThreshold) {
        return `ADX ${currentAdx.toFixed(2)} below ${this.config.adxThreshold}`;
      }
    }

    if (this.config.volumeFilterEnabled) {
      if (currentVolumeMa === null) {
        return "Waiting for volume MA warmup";
      }
      if (candle.volume < currentVolumeMa * this.config.volumeMultiplier) {
        return "Volume below filter threshold";
      }
    }

    return null;
  }
}

export function createDefaultStrategyRegistry(candles: Candle[]): StrategyRegistry {
  const registry = new StrategyRegistry();
  registry.register("EMA_TREND", (config) => new EmaTrendStrategy(candles, config));
  return registry;
}
