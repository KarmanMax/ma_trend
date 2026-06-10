import type { Portfolio } from "@trend-trade/portfolio";
import type { Candle, Signal, TradeExitReason } from "@trend-trade/shared";

export type ExecutionConfig = {
  feeRate: number;
  slippageRate: number;
  positionSizing: "ALL_IN";
};

export type ExecutionInput = {
  candle: Candle;
  signal: Signal;
  portfolio: Portfolio;
};

export interface ExecutionEngine {
  execute(input: ExecutionInput): void;
  closeAtEnd(candle: Candle, portfolio: Portfolio): void;
}

export class SimulatedExecutionEngine implements ExecutionEngine {
  constructor(private readonly config: ExecutionConfig) {}

  execute(input: ExecutionInput): void {
    const { candle, portfolio } = input;
    const position = portfolio.getOpenPosition();

    if (position?.side === "LONG" && position.stopPrice !== undefined && candle.low <= position.stopPrice) {
      this.closePosition(candle, portfolio, position.stopPrice, "STOP_LOSS");
      return;
    }

    if (position?.side === "SHORT" && position.stopPrice !== undefined && candle.high >= position.stopPrice) {
      this.closePosition(candle, portfolio, position.stopPrice, "STOP_LOSS");
      return;
    }

    if (input.signal.type === "BUY") {
      if (position?.side === "SHORT") {
        if (!input.signal.allowPositionFlip) {
          return;
        }
        this.closePosition(candle, portfolio, candle.close, "SIGNAL");
      }
      this.openLong(candle, portfolio, input.signal.stopPrice);
      return;
    }

    if (input.signal.type === "SELL_SHORT") {
      if (position?.side === "LONG") {
        if (!input.signal.allowPositionFlip) {
          return;
        }
        this.closePosition(candle, portfolio, candle.close, "SIGNAL");
      }
      this.openShort(candle, portfolio, input.signal.stopPrice);
      return;
    }

    if (input.signal.type === "CLOSE_LONG" && position?.side === "LONG") {
      this.closePosition(candle, portfolio, candle.close, "SIGNAL");
      return;
    }

    if (input.signal.type === "CLOSE_SHORT" && position?.side === "SHORT") {
      this.closePosition(candle, portfolio, candle.close, "SIGNAL");
    }
  }

  closeAtEnd(candle: Candle, portfolio: Portfolio): void {
    if (portfolio.getOpenPosition()) {
      this.closePosition(candle, portfolio, candle.close, "END_OF_BACKTEST");
    }
  }

  private openLong(candle: Candle, portfolio: Portfolio, stopPrice?: number): void {
    const executionPrice = candle.close * (1 + this.config.slippageRate);
    const cash = portfolio.getCash();
    const quantity = cash / (executionPrice * (1 + this.config.feeRate));
    if (quantity <= 0) {
      return;
    }

    const fee = executionPrice * quantity * this.config.feeRate;
    portfolio.onFill({
      type: "OPEN_LONG",
      symbol: candle.symbol,
      time: candle.closeTime,
      price: executionPrice,
      quantity,
      fee,
      stopPrice
    });
  }

  private openShort(candle: Candle, portfolio: Portfolio, stopPrice?: number): void {
    const executionPrice = candle.close * (1 - this.config.slippageRate);
    const cash = portfolio.getCash();
    const quantity = cash / (executionPrice * (1 + this.config.feeRate));
    if (quantity <= 0) {
      return;
    }

    const fee = executionPrice * quantity * this.config.feeRate;
    portfolio.onFill({
      type: "OPEN_SHORT",
      symbol: candle.symbol,
      time: candle.closeTime,
      price: executionPrice,
      quantity,
      fee,
      stopPrice
    });
  }

  private closePosition(candle: Candle, portfolio: Portfolio, referencePrice: number, reason: TradeExitReason): void {
    const position = portfolio.getOpenPosition();
    if (!position) {
      return;
    }

    const executionPrice =
      position.side === "SHORT"
        ? referencePrice * (1 + this.config.slippageRate)
        : referencePrice * (1 - this.config.slippageRate);
    const fee = executionPrice * position.quantity * this.config.feeRate;
    portfolio.onFill({
      type: position.side === "SHORT" ? "CLOSE_SHORT" : "CLOSE_LONG",
      symbol: candle.symbol,
      time: candle.closeTime,
      price: executionPrice,
      quantity: position.quantity,
      fee,
      reason
    });
  }
}
