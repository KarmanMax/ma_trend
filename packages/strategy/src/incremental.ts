import type { Candle, Signal } from "@trend-trade/shared";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type StrategyStepResult = {
  signal: Signal;
  status?: {
    phase: string;
    setup?: string | null;
    entrySide?: "LONG" | "SHORT" | null;
    levels?: Record<string, number | null>;
  };
};

export interface IncrementalStrategySession<TState = unknown> {
  readonly id: string;
  readonly name: string;
  readonly stateVersion: number;
  onClosedBar(candle: Candle): StrategyStepResult;
  snapshot(): TState;
  restore(state: TState): void;
}

export type StrategySessionIdentity = {
  strategyType: string;
  configKey: string;
  symbol: Candle["symbol"];
  timeframe: Candle["timeframe"];
};

export type StrategyCheckpoint<TState = unknown> = StrategySessionIdentity & {
  checkpointVersion: 1;
  stateVersion: number;
  lastProcessedCloseTime: number | null;
  state: TState;
};

export class IncrementalStrategyRunner<TState = unknown> {
  private lastProcessedCloseTime: number | null = null;
  private failed = false;
  private readonly identity: StrategySessionIdentity;

  constructor(
    private readonly session: IncrementalStrategySession<TState>,
    identity: StrategySessionIdentity
  ) {
    if (session.id !== identity.strategyType) {
      throw new Error("Strategy session type does not match its identity");
    }
    this.identity = { ...identity };
  }

  onClosedBar(candle: Candle): StrategyStepResult | null {
    if (this.failed) {
      throw new Error("Strategy session must be restored after a failed bar update");
    }
    if (candle.symbol !== this.identity.symbol || candle.timeframe !== this.identity.timeframe) {
      throw new Error("Candle does not match strategy session symbol and timeframe");
    }
    if (!Number.isFinite(candle.openTime) || !Number.isFinite(candle.closeTime) || candle.closeTime < candle.openTime) {
      throw new Error("Candle has invalid timestamps");
    }
    if (this.lastProcessedCloseTime !== null && candle.closeTime <= this.lastProcessedCloseTime) {
      return null;
    }

    try {
      const result = this.session.onClosedBar(candle);
      this.lastProcessedCloseTime = candle.closeTime;
      return result;
    } catch (error) {
      this.failed = true;
      throw error;
    }
  }

  snapshot(): StrategyCheckpoint<TState> {
    if (this.failed) {
      throw new Error("Cannot snapshot a strategy session after a failed bar update");
    }
    return {
      ...this.identity,
      checkpointVersion: 1,
      stateVersion: this.session.stateVersion,
      lastProcessedCloseTime: this.lastProcessedCloseTime,
      state: cloneJson(this.session.snapshot())
    };
  }

  restore(checkpoint: StrategyCheckpoint<TState>): void {
    if (
      checkpoint.checkpointVersion !== 1 ||
      checkpoint.stateVersion !== this.session.stateVersion ||
      checkpoint.strategyType !== this.identity.strategyType ||
      checkpoint.configKey !== this.identity.configKey ||
      checkpoint.symbol !== this.identity.symbol ||
      checkpoint.timeframe !== this.identity.timeframe ||
      (checkpoint.lastProcessedCloseTime !== null && !Number.isFinite(checkpoint.lastProcessedCloseTime))
    ) {
      throw new Error("Strategy checkpoint is incompatible with this session");
    }

    const state = cloneJson(checkpoint.state);
    try {
      this.session.restore(state);
      this.lastProcessedCloseTime = checkpoint.lastProcessedCloseTime;
      this.failed = false;
    } catch (error) {
      this.failed = true;
      throw error;
    }
  }
}

export function createStrategyConfigKey(config: unknown): string {
  return JSON.stringify(config, (_key, value: unknown) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
    }
    return value;
  });
}

function cloneJson<T>(value: T): T {
  assertJsonValue(value, new WeakSet());
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertJsonValue(value: unknown, seen: WeakSet<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return;
  }
  if (typeof value !== "object") {
    throw new Error("Strategy state must contain only JSON values");
  }
  if (seen.has(value)) {
    throw new Error("Strategy state cannot contain circular references");
  }
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new Error("Strategy state must contain only plain objects");
  }

  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) {
        throw new Error("Strategy state cannot contain sparse arrays");
      }
      assertJsonValue(value[index], seen);
    }
  } else {
    for (const item of Object.values(value)) {
      assertJsonValue(item, seen);
    }
  }
  seen.delete(value);
}
