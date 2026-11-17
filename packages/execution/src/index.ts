import type { Portfolio } from "@trend-trade/portfolio";
import type { Candle, EntrySignalType, Signal, TradeExitReason } from "@trend-trade/shared";

export type ExecutionConfig = {
  feeRate: number;
  slippageRate: number;
  positionSizing: "ALL_IN";
  lossCooldownBars?: number;
  keepCooldownSignalsByDirection?: boolean;
};

export type ExecutionInput = {
  candle: Candle;
  signal: Signal;
  portfolio: Portfolio;
  revalidateEntry?: (type: EntrySignalType) => Signal | null;
};

export interface ExecutionEngine {
  execute(input: ExecutionInput): void;
  closeAtEnd(candle: Candle, portfolio: Portfolio): void;
}

export class SimulatedExecutionEngine implements ExecutionEngine {
  private remainingCooldownBars = 0;
  private pendingEntries: EntrySignalType[] = [];

  constructor(private readonly config: ExecutionConfig) {}

  execute(input: ExecutionInput): void {
    const { candle, portfolio, signal } = input;
    const coolingDown = this.remainingCooldownBars > 0;
    if (coolingDown) {
      this.remainingCooldownBars -= 1;
    }

    const position = portfolio.getOpenPosition();
    const stop = getStopFill(candle, position);
    const trigger = signal.trigger;
    if (!trigger) {
      if (stop) {
        this.closePosition(candle, portfolio, stop.price, "STOP_LOSS", stop.time);
      }
      this.executeSignal(input, coolingDown, candle.close, candle.closeTime);
      this.resumePendingEntry(input, coolingDown);
      return;
    }

    const opposesPosition = position?.side === "LONG"
      ? signal.type === "SELL_SHORT" || signal.type === "CLOSE_LONG"
      : signal.type === "BUY" || signal.type === "CLOSE_SHORT";
    // When both levels are on the same side of the open, the nearer level is reached first.
    const stopBeforeTouch = stop && trigger.at === "INTRABAR" && opposesPosition
      && (position?.side === "LONG" ? stop.price >= trigger.price : stop.price <= trigger.price);
    if (stop && (stop.time === candle.openTime || stopBeforeTouch)) {
      this.closePosition(candle, portfolio, stop.price, "STOP_LOSS", stop.time);
    }

    const beforeSignal = portfolio.getOpenPosition();
    const signalTime = trigger.at === "OPEN" ? candle.openTime : candle.closeTime;
    this.executeSignal(input, coolingDown, trigger.price, signalTime);
    const afterSignal = portfolio.getOpenPosition();
    const opened = afterSignal && (afterSignal.entryTime !== beforeSignal?.entryTime || afterSignal.side !== beforeSignal.side);
    // A new intrabar position can use the closing price to prove a later stop,
    // since the bar's high/low may have happened before entry.
    const laterStop = getStopFill(candle, afterSignal, opened && trigger.at === "INTRABAR" ? "CLOSE_ONLY" : "FULL_BAR");
    if (laterStop) {
      this.closePosition(candle, portfolio, laterStop.price, "STOP_LOSS", opened ? candle.closeTime : laterStop.time);
    } else if (opened && signal.entryInvalidationLevel !== undefined) {
      const level = signal.entryInvalidationLevel;
      const failed = afterSignal.side === "LONG" ? candle.close < level : candle.close > level;
      if (failed) {
        this.closePosition(candle, portfolio, candle.close, "FAILED_BREAKOUT");
      }
    }
    this.resumePendingEntry(input, coolingDown);
  }

  private executeSignal(input: ExecutionInput, coolingDown: boolean, price: number, time: number): void {
    const { candle, portfolio, signal } = input;
    const position = portfolio.getOpenPosition();
    if (signal.type === "BUY" || signal.type === "SELL_SHORT") {
      if (this.config.keepCooldownSignalsByDirection && !position && !coolingDown
        && this.remainingCooldownBars === 0 && this.pendingEntries.length > 0) {
        // Let the queued entries be checked at the close of the first eligible bar.
        return;
      }
      const side = signal.type === "BUY" ? "LONG" : "SHORT";
      if (!this.config.keepCooldownSignalsByDirection) {
        this.pendingEntries = [];
      }
      if (position?.side === side) {
        return;
      }
      if (position) {
        if (!signal.allowPositionFlip) {
          return;
        }
        this.closePosition(candle, portfolio, price, "SIGNAL", time);
      }
      if (coolingDown || this.remainingCooldownBars > 0) {
        if (input.revalidateEntry) {
          this.pendingEntries = [signal.type, ...this.pendingEntries.filter((type) => type !== signal.type)];
        }
        return;
      }
      this.pendingEntries = [];
      this.openPosition(portfolio, candle.symbol, signal.type, price, time, signal.stopPrice);
      return;
    }

    if (signal.type === "CLOSE_LONG" || signal.type === "CLOSE_SHORT") {
      const closingLong = signal.type === "CLOSE_LONG";
      if (!this.config.keepCooldownSignalsByDirection) {
        this.pendingEntries = this.pendingEntries.filter((type) => type !== (closingLong ? "BUY" : "SELL_SHORT"));
      }
      if (position?.side === (closingLong ? "LONG" : "SHORT")) {
        this.closePosition(candle, portfolio, price, "SIGNAL", time);
      }
    }
  }

  private resumePendingEntry({ candle, portfolio, revalidateEntry }: ExecutionInput, coolingDown: boolean): void {
    if (portfolio.getOpenPosition() || coolingDown || this.remainingCooldownBars > 0 || this.pendingEntries.length === 0) {
      return;
    }
    const entries = this.pendingEntries;
    this.pendingEntries = [];
    for (const type of entries) {
      const confirmed = revalidateEntry?.(type);
      if (confirmed?.type === type) {
        this.openPosition(portfolio, candle.symbol, type, candle.close, candle.closeTime, confirmed.stopPrice);
        break;
      }
    }
  }

  closeAtEnd(candle: Candle, portfolio: Portfolio): void {
    if (portfolio.getOpenPosition()) {
      this.closePosition(candle, portfolio, candle.close, "END_OF_BACKTEST");
    }
  }

  private openPosition(portfolio: Portfolio, symbol: string, type: EntrySignalType, price: number, time: number, stopPrice?: number): void {
    const isLong = type === "BUY";
    const executionPrice = price * (1 + (isLong ? 1 : -1) * this.config.slippageRate);
    const cash = portfolio.getCash();
    const quantity = cash / (executionPrice * (1 + this.config.feeRate));
    if (quantity <= 0) {
      return;
    }

    const fee = executionPrice * quantity * this.config.feeRate;
    portfolio.onFill({
      type: isLong ? "OPEN_LONG" : "OPEN_SHORT",
      symbol,
      time,
      price: executionPrice,
      quantity,
      fee,
      stopPrice
    });
  }

  private closePosition(candle: Candle, portfolio: Portfolio, referencePrice: number, reason: TradeExitReason, time = candle.closeTime): void {
    const position = portfolio.getOpenPosition();
    if (!position) {
      return;
    }

    const executionPrice =
      position.side === "SHORT"
        ? referencePrice * (1 + this.config.slippageRate)
        : referencePrice * (1 - this.config.slippageRate);
    const fee = executionPrice * position.quantity * this.config.feeRate;
    const closedTrade = portfolio.onFill({
      type: position.side === "SHORT" ? "CLOSE_SHORT" : "CLOSE_LONG",
      symbol: candle.symbol,
      time,
      price: executionPrice,
      quantity: position.quantity,
      fee,
      reason
    });
    const losingExit = (closedTrade?.netPnl ?? 0) < 0;
    if (reason === "STOP_LOSS" || (losingExit && (reason === "SIGNAL" || reason === "FAILED_BREAKOUT"))) {
      this.remainingCooldownBars = this.config.lossCooldownBars ?? 0;
    }
  }
}

function getStopFill(candle: Candle, position: ReturnType<Portfolio["getOpenPosition"]>, range: "FULL_BAR" | "CLOSE_ONLY" = "FULL_BAR") {
  const stopPrice = position?.stopPrice;
  if (!position || stopPrice === undefined) {
    return null;
  }
  const isLong = position.side === "LONG";
  const extreme = range === "CLOSE_ONLY" ? candle.close : isLong ? candle.low : candle.high;
  if (isLong ? extreme > stopPrice : extreme < stopPrice) {
    return null;
  }
  const gap = range === "FULL_BAR" && (isLong ? candle.open <= stopPrice : candle.open >= stopPrice);
  return gap ? { price: candle.open, time: candle.openTime } : { price: stopPrice, time: candle.closeTime };
}
