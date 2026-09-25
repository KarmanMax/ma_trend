import type { Candle, Signal, WyckoffStrategyConfig } from "@trend-trade/shared";
import type { IncrementalStrategySession, StrategyStepResult } from "./incremental";

export type WyckoffPhase =
  | "SEARCHING_RANGE"
  | "RANGE_FOUND"
  | "SOS_DETECTED"
  | "WAITING_FOR_LPS"
  | "SPRING_DETECTED"
  | "WAITING_FOR_SPRING_RECLAIM"
  | "UTAD_DETECTED"
  | "WAITING_FOR_UTAD_REJECTION"
  | "INVALIDATED"
  | "ENTERED";

export type WyckoffSetup = "SOS_LPS" | "SPRING" | "UTAD";

export type WyckoffTradingRange = {
  low: number;
  high: number;
  averageVolume: number;
  startTime: number;
  endTime: number;
};

export type WyckoffState = {
  phase: WyckoffPhase;
  recentCandles: Candle[];
  tradingRange: WyckoffTradingRange | null;
  setup: WyckoffSetup | null;
  entrySide: "LONG" | "SHORT" | null;
  breakoutLevel: number | null;
  sosTime: number | null;
  sosVolume: number | null;
  barsSinceSos: number;
  trapExtreme: number | null;
  barsSinceTrap: number;
  invalidationPrice: number | null;
};

function initialState(): WyckoffState {
  return {
    phase: "SEARCHING_RANGE",
    recentCandles: [],
    tradingRange: null,
    setup: null,
    entrySide: null,
    breakoutLevel: null,
    sosTime: null,
    sosVolume: null,
    barsSinceSos: 0,
    trapExtreme: null,
    barsSinceTrap: 0,
    invalidationPrice: null
  };
}

export class WyckoffStrategy implements IncrementalStrategySession<WyckoffState> {
  readonly id = "WYCKOFF_SOS_LPS";
  readonly name = "Wyckoff SOS/LPS, Spring and UTAD heuristic";
  readonly stateVersion = 2;
  private state = initialState();

  constructor(private readonly config: WyckoffStrategyConfig) {}

  onClosedBar(candle: Candle): StrategyStepResult {
    const phase = this.state.phase;
    if (phase === "INVALIDATED") {
      this.state = initialState();
    }

    if (phase === "ENTERED") {
      const stop = this.state.invalidationPrice;
      if (stop !== null && this.state.entrySide === "LONG" && candle.close < stop) {
        return this.invalidate(`${this.state.setup} long invalidated below ${stop}`, "CLOSE_LONG");
      }
      if (stop !== null && this.state.entrySide === "SHORT" && candle.close > stop) {
        return this.invalidate(`${this.state.setup} short invalidated above ${stop}`, "CLOSE_SHORT");
      }
      return this.hold(`Maintaining ${this.state.setup} ${this.state.entrySide} signal`);
    }

    if (phase === "SPRING_DETECTED" || phase === "WAITING_FOR_SPRING_RECLAIM") {
      return this.processTrap(candle, "SPRING");
    }
    if (phase === "UTAD_DETECTED" || phase === "WAITING_FOR_UTAD_REJECTION") {
      return this.processTrap(candle, "UTAD");
    }

    if (phase === "SOS_DETECTED" || phase === "WAITING_FOR_LPS") {
      this.state.phase = "WAITING_FOR_LPS";
      this.state.barsSinceSos += 1;
      const range = this.state.tradingRange;
      if (
        this.config.utadEnabled && range &&
        this.state.barsSinceSos <= this.config.trapReentryMaxBars &&
        this.state.trapExtreme !== null
      ) {
        this.state.trapExtreme = Math.max(this.state.trapExtreme, candle.high);
        if (
          this.state.trapExtreme >= range.high * (1 + this.config.utadPenetrationPct) &&
          candle.close <= range.high
        ) {
          return this.enterTrap("UTAD", "UTAD confirmed after failed SOS breakout");
        }
      }
      if (this.state.invalidationPrice !== null && candle.close < this.state.invalidationPrice) {
        return this.invalidate("Breakout invalidated before LPS");
      }
      if (this.state.barsSinceSos > this.config.lpsMaxBars) {
        return this.invalidate("LPS waiting window expired");
      }
      if (this.state.barsSinceSos >= this.config.lpsMinBars && this.isLps(candle)) {
        this.state.phase = "ENTERED";
        this.state.setup = "SOS_LPS";
        this.state.entrySide = "LONG";
        return this.result({ type: "BUY", reason: "LPS confirmed after SOS" });
      }
      return this.hold("Waiting for LPS after SOS");
    }

    if (phase === "RANGE_FOUND" && this.state.tradingRange) {
      const range = this.state.tradingRange;
      const springBreak = this.config.springEnabled && candle.low <= range.low * (1 - this.config.springPenetrationPct);
      const utadBreak = this.config.utadEnabled && candle.high >= range.high * (1 + this.config.utadPenetrationPct);
      if (springBreak && utadBreak) {
        return this.invalidate("Bar crossed both range boundaries; trap direction is ambiguous");
      }
      if (this.config.sosLpsEnabled && this.isSos(candle, range)) {
        this.state.phase = "SOS_DETECTED";
        this.state.setup = "SOS_LPS";
        this.state.breakoutLevel = range.high;
        this.state.sosTime = candle.closeTime;
        this.state.sosVolume = candle.volume;
        this.state.barsSinceSos = 0;
        this.state.trapExtreme = candle.high;
        this.state.invalidationPrice = this.state.breakoutLevel * (1 - this.config.invalidationPct);
        return this.hold("SOS detected above the trading range");
      }
      if (springBreak) {
        this.state.phase = "SPRING_DETECTED";
        this.state.setup = "SPRING";
        this.state.trapExtreme = candle.low;
        this.state.barsSinceTrap = 0;
        return candle.close >= range.low
          ? this.enterTrap("SPRING", "Spring reclaimed trading-range support")
          : this.hold("Spring pierced support; waiting for reclaim");
      }
      if (utadBreak) {
        this.state.phase = "UTAD_DETECTED";
        this.state.setup = "UTAD";
        this.state.trapExtreme = candle.high;
        this.state.barsSinceTrap = 0;
        return candle.close <= range.high
          ? this.enterTrap("UTAD", "UTAD rejected trading-range resistance")
          : this.hold("UTAD pierced resistance; waiting for rejection");
      }
      if (candle.close < range.low) {
        return this.invalidate("Close fell below the trading range");
      }
    }

    this.pushRecent(candle);
    const range = this.findRange();
    this.state.tradingRange = range;
    this.state.phase = range ? "RANGE_FOUND" : "SEARCHING_RANGE";
    return this.hold(range ? "Trading range found" : "Searching for trading range");
  }

  snapshot(): WyckoffState {
    return structuredClone(this.state);
  }

  restore(state: WyckoffState): void {
    if (!state || !Array.isArray(state.recentCandles) || typeof state.phase !== "string") {
      throw new Error("Invalid Wyckoff strategy state");
    }
    this.state = structuredClone(state);
  }

  private processTrap(candle: Candle, setup: "SPRING" | "UTAD"): StrategyStepResult {
    const range = this.state.tradingRange;
    const extreme = this.state.trapExtreme;
    if (!range || extreme === null) {
      return this.invalidate(`${setup} state has no trading range or extreme`);
    }
    this.state.barsSinceTrap += 1;
    this.state.trapExtreme = setup === "SPRING"
      ? Math.min(extreme, candle.low)
      : Math.max(extreme, candle.high);
    const reentered = setup === "SPRING" ? candle.close >= range.low : candle.close <= range.high;
    if (reentered && this.state.barsSinceTrap <= this.config.trapReentryMaxBars) {
      return this.enterTrap(setup, setup === "SPRING" ? "Spring reclaimed trading-range support" : "UTAD rejected trading-range resistance");
    }
    if (this.state.barsSinceTrap >= this.config.trapReentryMaxBars) {
      return this.invalidate(`${setup} reentry window expired`);
    }
    this.state.phase = setup === "SPRING" ? "WAITING_FOR_SPRING_RECLAIM" : "WAITING_FOR_UTAD_REJECTION";
    return this.hold(`Waiting for ${setup} reentry`);
  }

  private enterTrap(setup: "SPRING" | "UTAD", reason: string): StrategyStepResult {
    const extreme = this.state.trapExtreme;
    if (extreme === null) {
      return this.invalidate(`${setup} has no price extreme`);
    }
    this.state.phase = "ENTERED";
    this.state.setup = setup;
    this.state.entrySide = setup === "SPRING" ? "LONG" : "SHORT";
    this.state.invalidationPrice = setup === "SPRING"
      ? extreme * (1 - this.config.invalidationPct)
      : extreme * (1 + this.config.invalidationPct);
    if (setup === "UTAD") {
      this.state.breakoutLevel = null;
      this.state.sosTime = null;
      this.state.sosVolume = null;
      this.state.barsSinceSos = 0;
    }
    return this.result({ type: setup === "SPRING" ? "BUY" : "SELL_SHORT", reason });
  }

  private pushRecent(candle: Candle): void {
    this.state.recentCandles.push({ ...candle });
    if (this.state.recentCandles.length > this.config.rangeBars) {
      this.state.recentCandles.shift();
    }
  }

  private findRange(): WyckoffTradingRange | null {
    const bars = this.state.recentCandles;
    if (bars.length < this.config.rangeBars) {
      return null;
    }
    const high = Math.max(...bars.map((bar) => bar.high));
    const low = Math.min(...bars.map((bar) => bar.low));
    const averageClose = bars.reduce((sum, bar) => sum + bar.close, 0) / bars.length;
    const averageVolume = bars.reduce((sum, bar) => sum + bar.volume, 0) / bars.length;
    if (averageClose <= 0 || averageVolume <= 0 || (high - low) / averageClose > this.config.maxRangeWidthPct) {
      return null;
    }
    return {
      low,
      high,
      averageVolume,
      startTime: bars[0].openTime,
      endTime: bars[bars.length - 1].closeTime
    };
  }

  private isSos(candle: Candle, range: WyckoffTradingRange): boolean {
    const spread = candle.high - candle.low;
    const closeLocation = spread > 0 ? (candle.close - candle.low) / spread : 0;
    return candle.close > candle.open &&
      candle.close >= range.high * (1 + this.config.sosBreakoutPct) &&
      candle.volume >= range.averageVolume * this.config.sosVolumeMultiplier &&
      closeLocation >= this.config.sosCloseLocationMin;
  }

  private isLps(candle: Candle): boolean {
    const level = this.state.breakoutLevel;
    const sosVolume = this.state.sosVolume;
    const invalidationPrice = this.state.invalidationPrice;
    if (level === null || sosVolume === null || invalidationPrice === null) {
      return false;
    }
    return candle.low >= invalidationPrice &&
      candle.low <= level * (1 + this.config.lpsTolerancePct) &&
      candle.close >= level * (1 - this.config.lpsTolerancePct) &&
      candle.volume <= sosVolume * this.config.lpsMaxVolumeRatio;
  }

  private invalidate(reason: string, signalType: Signal["type"] = "HOLD"): StrategyStepResult {
    this.state.phase = "INVALIDATED";
    return this.result({ type: signalType, reason });
  }

  private hold(reason: string): StrategyStepResult {
    return this.result({ type: "HOLD", reason });
  }

  private result(signal: Signal): StrategyStepResult {
    return {
      signal,
      status: {
        phase: this.state.phase,
        setup: this.state.setup,
        entrySide: this.state.entrySide,
        levels: {
          rangeHigh: this.state.tradingRange?.high ?? null,
          rangeLow: this.state.tradingRange?.low ?? null,
          breakoutLevel: this.state.breakoutLevel,
          invalidationPrice: this.state.invalidationPrice,
          trapExtreme: this.state.trapExtreme
        }
      }
    };
  }
}

export { WyckoffStrategy as WyckoffSosLpsStrategy };
