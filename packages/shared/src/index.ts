import { z } from "zod";

export const supportedSymbols = [
  "BTC",
  "ETH",
  "SOL",
  "BNB",
  "ENA",
  "SUI",
  "UNI",
  "AAVE",
  "LINK",
  "ONDO",
  "HYPE",
  "VVV",
  "NEAR",
  "MORPHO",
  "RAY",
  "JUP",
  "KMNO",
  "CAKE",
  "LDO",
  "SKHYNIX",
  "MU",
  "MRVL",
  "PLTR",
  "HOOD",
  "SOFI",
  "SNDK",
  "CRWV",
  "NBIS",
  "IREN",
  "AVGO",
  "INTC",
  "ARM",
  "AMD",
  "XIAOMI",
  "BABA",
  "BIDU",
  "00700",
  "03690",
  "JD",
  "BILI",
  "PDD",
  "TSM",
  "TCOM",
  "FUTU",
  "PONY",
  "QQQ",
  "SPY",
  "VGT",
  "SMH",
  "SOXX",
  "IGV",
  "XBI",
  "DRAM",
  "LYTE"
] as const;
export const supportedTimeframes = ["1m", "2m", "5m", "15m", "30m", "1h", "2h", "4h", "1d"] as const;

export type SymbolCode = (typeof supportedSymbols)[number];
export type Timeframe = (typeof supportedTimeframes)[number];

export type Candle = {
  symbol: string;
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
  symbol: string;
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
  symbol: string;
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
  trendEma?: number;
  atr?: number;
  adx?: number;
  volumeMa?: number;
};

export type EmaTrendStrategyConfig = {
  type: "EMA_TREND";
  trendEmaPeriod: number;
  trendMaType?: "MA" | "EMA";
  emaFast?: number;
  emaSlow?: number;
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

export const defaultWyckoffStrategyConfig = {
  type: "WYCKOFF_SOS_LPS",
  sosLpsEnabled: true,
  springEnabled: true,
  utadEnabled: true,
  rangeBars: 20,
  maxRangeWidthPct: 0.18,
  sosBreakoutPct: 0.01,
  sosVolumeMultiplier: 1.5,
  sosCloseLocationMin: 0.7,
  lpsMinBars: 3,
  lpsMaxBars: 15,
  lpsTolerancePct: 0.03,
  lpsMaxVolumeRatio: 0.85,
  springPenetrationPct: 0.01,
  utadPenetrationPct: 0.01,
  trapReentryMaxBars: 3,
  invalidationPct: 0.04
} as const;

export const wyckoffStrategyConfigSchema = z.object({
  type: z.literal("WYCKOFF_SOS_LPS"),
  sosLpsEnabled: z.boolean().default(defaultWyckoffStrategyConfig.sosLpsEnabled),
  springEnabled: z.boolean().default(defaultWyckoffStrategyConfig.springEnabled),
  utadEnabled: z.boolean().default(defaultWyckoffStrategyConfig.utadEnabled),
  rangeBars: z.number().int().min(5).max(200),
  maxRangeWidthPct: z.number().positive().max(1),
  sosBreakoutPct: z.number().min(0).max(1),
  sosVolumeMultiplier: z.number().positive(),
  sosCloseLocationMin: z.number().min(0).max(1),
  lpsMinBars: z.number().int().min(1),
  lpsMaxBars: z.number().int().min(1),
  lpsTolerancePct: z.number().min(0).max(1),
  lpsMaxVolumeRatio: z.number().positive(),
  springPenetrationPct: z.number().positive().max(1).default(defaultWyckoffStrategyConfig.springPenetrationPct),
  utadPenetrationPct: z.number().positive().max(1).default(defaultWyckoffStrategyConfig.utadPenetrationPct),
  trapReentryMaxBars: z.number().int().min(1).max(30).default(defaultWyckoffStrategyConfig.trapReentryMaxBars),
  invalidationPct: z.number().positive().max(1)
}).refine((value) => value.lpsMinBars <= value.lpsMaxBars, {
  message: "lpsMinBars must be at most lpsMaxBars",
  path: ["lpsMinBars"]
});

export type WyckoffStrategyConfig = z.infer<typeof wyckoffStrategyConfigSchema>;

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
    trendEmaPeriod: z.number().int().positive().optional(),
    trendMaType: z.enum(["MA", "EMA"]).default("MA"),
    emaFast: z.number().int().positive().optional(),
    emaSlow: z.number().int().positive().optional(),
    atrPeriod: z.number().int().positive(),
    atrMultiplier: z.number().positive(),
    atrStopEnabled: z.boolean().default(false),
    adxPeriod: z.number().int().positive(),
    adxThreshold: z.number().min(0).max(100),
    adxFilterEnabled: z.boolean().default(true),
    volumeMaPeriod: z.number().int().positive(),
    volumeMultiplier: z.number().positive(),
    volumeFilterEnabled: z.boolean().default(true),
    direction: z.enum(["LONG_ONLY", "SHORT_ONLY", "LONG_SHORT"]),
    exitTrigger: z.enum(["EMA", "NONE"]).default("EMA")
  }).transform((value) => ({
    ...value,
    trendEmaPeriod: value.trendEmaPeriod ?? value.emaSlow ?? 200
  }))
}).refine((value) => Date.parse(value.startTime) < Date.parse(value.endTime), {
  message: "startTime must be before endTime",
  path: ["startTime"]
});
