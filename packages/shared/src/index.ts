import { z } from "zod";

export const supportedSymbols = ["ETHUSDT"] as const;
export const supportedTimeframes = ["1m", "2m", "5m", "15m", "30m", "1h", "2h", "4h", "1d"] as const;

export type SymbolCode = (typeof supportedSymbols)[number];
export type Timeframe = (typeof supportedTimeframes)[number];

export type Candle = {
  symbol: SymbolCode;
  timeframe: Timeframe;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type SignalType = "BUY" | "SELL_SHORT" | "CLOSE_LONG" | "CLOSE_SHORT" | "HOLD";

export type Signal = {
  type: SignalType;
  reason?: string;
  stopPrice?: number;
  allowPositionFlip?: boolean;
};

export type TradeExitReason = "SIGNAL" | "STOP_LOSS" | "END_OF_BACKTEST";

export type Trade = {
  id: string;
  symbol: SymbolCode;
  side: PositionSide;
  entryTime: number;
  exitTime?: number;
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  grossPnl?: number;
  netPnl?: number;
  fee: number;
  exitReason?: TradeExitReason;
};

export type Position = {
  symbol: SymbolCode;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  entryTime: number;
  stopPrice?: number;
  accumulatedFee: number;
};

export type PositionSide = "LONG" | "SHORT";
export type StrategyDirection = "LONG_ONLY" | "SHORT_ONLY" | "LONG_SHORT";
export type StrategyExitTrigger = "EMA" | "NONE";

export type EquityPoint = {
  time: number;
  equity: number;
};

export type DrawdownPoint = {
  time: number;
  drawdown: number;
};

export type BacktestMetrics = {
  totalReturn: number;
  cagr: number;
  maxDrawdown: number;
  sharpeRatio: number;
  winRate: number;
  profitFactor: number;
  tradeCount: number;
};

export type BacktestChartPoint = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  emaFast?: number;
  emaSlow?: number;
  atr?: number;
  adx?: number;
  volumeMa?: number;
};

export type EmaTrendStrategyConfig = {
  type: "EMA_TREND";
  emaFast: number;
  emaSlow: number;
  atrPeriod: number;
  atrMultiplier: number;
  atrStopEnabled: boolean;
  adxPeriod: number;
  adxThreshold: number;
  adxFilterEnabled: boolean;
  volumeMaPeriod: number;
  volumeMultiplier: number;
  volumeFilterEnabled: boolean;
  direction: StrategyDirection;
  exitTrigger: StrategyExitTrigger;
};

export type StrategyConfig = EmaTrendStrategyConfig;

export type BacktestConfig = {
  symbol: SymbolCode;
  timeframe: Timeframe;
  startTime: string;
  endTime: string;
  initialCapital: number;
  feeRate: number;
  slippageRate: number;
  strategy: StrategyConfig;
};

export type BacktestResult = {
  id?: string;
  config: BacktestConfig;
  status: "COMPLETED" | "FAILED";
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
  drawdownCurve: DrawdownPoint[];
  chartPoints: BacktestChartPoint[];
  trades: Trade[];
};

export const backtestConfigSchema = z.object({
  symbol: z.enum(supportedSymbols),
  timeframe: z.enum(supportedTimeframes),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  initialCapital: z.number().positive(),
  feeRate: z.number().min(0).max(0.1),
  slippageRate: z.number().min(0).max(0.1),
  strategy: z.object({
    type: z.literal("EMA_TREND"),
    emaFast: z.number().int().positive(),
    emaSlow: z.number().int().positive(),
    atrPeriod: z.number().int().positive(),
    atrMultiplier: z.number().positive(),
    atrStopEnabled: z.boolean().default(true),
    adxPeriod: z.number().int().positive(),
    adxThreshold: z.number().min(0).max(100),
    adxFilterEnabled: z.boolean().default(true),
    volumeMaPeriod: z.number().int().positive(),
    volumeMultiplier: z.number().positive(),
    volumeFilterEnabled: z.boolean().default(true),
    direction: z.enum(["LONG_ONLY", "SHORT_ONLY", "LONG_SHORT"]),
    exitTrigger: z.enum(["EMA", "NONE"]).default("EMA")
  })
}).refine((value) => value.strategy.emaFast < value.strategy.emaSlow, {
  message: "EMA fast period must be lower than EMA slow period",
  path: ["strategy", "emaFast"]
}).refine((value) => Date.parse(value.startTime) < Date.parse(value.endTime), {
  message: "startTime must be before endTime",
  path: ["startTime"]
});
