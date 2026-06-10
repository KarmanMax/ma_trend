import type { Candle, EquityPoint, Position, SymbolCode, Trade, TradeExitReason } from "@trend-trade/shared";

export type Fill =
  | {
      type: "OPEN_LONG" | "OPEN_SHORT";
      symbol: SymbolCode;
      time: number;
      price: number;
      quantity: number;
      fee: number;
      stopPrice?: number;
    }
  | {
      type: "CLOSE_LONG" | "CLOSE_SHORT";
      symbol: SymbolCode;
      time: number;
      price: number;
      quantity: number;
      fee: number;
      reason: TradeExitReason;
    };

type CloseFill = Extract<Fill, { type: "CLOSE_LONG" | "CLOSE_SHORT" }>;

export type PortfolioSnapshot = {
  time: number;
  cash: number;
  equity: number;
  position: Position | null;
};

export interface Portfolio {
  getCash(): number;
  getOpenPosition(): Position | null;
  getTrades(): Trade[];
  getEquityCurve(): EquityPoint[];
  onFill(fill: Fill): void;
  markToMarket(candle: Candle): PortfolioSnapshot;
}

export class SimulatedPortfolio implements Portfolio {
  private cash: number;
  private position: Position | null = null;
  private readonly trades: Trade[] = [];
  private readonly equityCurve: EquityPoint[] = [];

  constructor(initialCapital: number) {
    this.cash = initialCapital;
  }

  getCash(): number {
    return this.cash;
  }

  getOpenPosition(): Position | null {
    return this.position ? { ...this.position } : null;
  }

  getTrades(): Trade[] {
    return this.trades.map((trade) => ({ ...trade }));
  }

  getEquityCurve(): EquityPoint[] {
    return this.equityCurve.map((point) => ({ ...point }));
  }

  onFill(fill: Fill): void {
    if (fill.type === "OPEN_LONG" || fill.type === "OPEN_SHORT") {
      if (this.position) {
        return;
      }

      const notional = fill.price * fill.quantity;
      this.cash += fill.type === "OPEN_SHORT" ? notional - fill.fee : -notional - fill.fee;
      this.position = {
        symbol: fill.symbol,
        side: fill.type === "OPEN_SHORT" ? "SHORT" : "LONG",
        quantity: fill.quantity,
        entryPrice: fill.price,
        entryTime: fill.time,
        stopPrice: fill.stopPrice,
        accumulatedFee: fill.fee
      };
      this.trades.push({
        id: createId("trade"),
        symbol: fill.symbol,
        side: fill.type === "OPEN_SHORT" ? "SHORT" : "LONG",
        entryTime: fill.time,
        entryPrice: fill.price,
        quantity: fill.quantity,
        fee: fill.fee
      });
      return;
    }

    if (!this.position) {
      return;
    }

    const closeFill = fill as CloseFill;
    const quantity = Math.min(closeFill.quantity, this.position.quantity);
    const notional = closeFill.price * quantity;
    this.cash += this.position.side === "SHORT" ? -notional - closeFill.fee : notional - closeFill.fee;

    const grossPnl =
      this.position.side === "SHORT"
        ? (this.position.entryPrice - closeFill.price) * quantity
        : (closeFill.price - this.position.entryPrice) * quantity;
    const netPnl = grossPnl - this.position.accumulatedFee - closeFill.fee;
    const openTrade = [...this.trades].reverse().find((trade) => trade.exitTime === undefined);
    if (openTrade) {
      openTrade.exitTime = closeFill.time;
      openTrade.exitPrice = closeFill.price;
      openTrade.grossPnl = grossPnl;
      openTrade.netPnl = netPnl;
      openTrade.fee += closeFill.fee;
      openTrade.exitReason = closeFill.reason;
    }

    this.position = null;
  }

  markToMarket(candle: Candle): PortfolioSnapshot {
    const positionValue = this.position
      ? this.position.side === "SHORT"
        ? -this.position.quantity * candle.close
        : this.position.quantity * candle.close
      : 0;
    const equity = this.cash + positionValue;
    const point = { time: candle.closeTime, equity };

    if (this.equityCurve.at(-1)?.time !== point.time) {
      this.equityCurve.push(point);
    }

    return {
      time: candle.closeTime,
      cash: this.cash,
      equity,
      position: this.getOpenPosition()
    };
  }
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
