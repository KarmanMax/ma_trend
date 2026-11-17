import { z } from "zod";

const cryptoSymbols = [
  "BTC",
  "ETH",
  "SOL",
  "BNB",
  "XRP",
  "ADA",
  "DOGE",
  "AVAX",
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
  "LDO"
] as const;

export const supportedSymbols = [
  ...cryptoSymbols,
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "GOOGL",
  "META",
  "BRK-B",
  "JPM",
  "V",
  "MA",
  "WMT",
  "COST",
  "UNH",
  "XOM",
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
  "ASML",
  "QCOM",
  "TXN",
  "AMAT",
  "LRCX",
  "KLAC",
  "ADI",
  "NXPI",
  "MCHP",
  "ON",
  "MPWR",
  "TER",
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
export const supportedTimeframes = ["1m", "2m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "1w"] as const;

export type SymbolCode = (typeof supportedSymbols)[number];
export type Timeframe = (typeof supportedTimeframes)[number];

export const dailyCandleStartHours = [0, 4, 8, 12, 16, 20] as const;
export type DailyCandleStartHour = (typeof dailyCandleStartHours)[number];
export const defaultDailyCandleStartHour: DailyCandleStartHour = 0;
export const legacyDailyCandleStartHour: DailyCandleStartHour = 8;
export const beijingUtcOffsetHours = 8;

const cryptoSymbolSet = new Set<SymbolCode>(cryptoSymbols);

export function supportsDailyCandleStart(symbol: SymbolCode, timeframe: Timeframe): boolean {
  return timeframe === "1d" && cryptoSymbolSet.has(symbol);
}

export const timeframeMilliseconds: Readonly<Record<Timeframe, number>> = {
  "1m": 60_000,
  "2m": 2 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "2h": 2 * 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "8h": 8 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000
};

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

export type EntrySignalType = "BUY" | "SELL_SHORT";
export type SignalType = EntrySignalType | "CLOSE_LONG" | "CLOSE_SHORT" | "HOLD";

export type Signal = {
  type: SignalType;
  reason?: string;
  stopPrice?: number;
  allowPositionFlip?: boolean;
  trigger?: { price: number; at: "OPEN" | "INTRABAR" };
  entryInvalidationLevel?: number;
};

export type TradeExitReason = "SIGNAL" | "STOP_LOSS" | "FAILED_BREAKOUT" | "END_OF_BACKTEST";

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
  macdLine?: number;
  macdSignal?: number;
  macdHistogram?: number;
};

export type EmaTrendStrategyConfig = {
  type: "EMA_TREND";
  trendEmaPeriod: number;
  trendMaType?: "MA" | "EMA";
  trendTriggerMode?: "INTRABAR_TOUCH" | "CLOSE_CROSS";
  exitOnFailedBreakout?: boolean;
  keepCooldownSignalsByDirection?: boolean;
  filterExtendedCooldownEntries?: boolean;
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
  levelFilterEnabled?: boolean;
  levelMinClearanceAtr?: number;
  lossCooldownBars?: number;
  resumeEntryAfterCooldown?: boolean;
  direction: StrategyDirection;
  exitTrigger: StrategyExitTrigger;
};

type MacdStrategyConfigBase = Omit<EmaTrendStrategyConfig,
  "type" | "trendEmaPeriod" | "trendMaType" | "trendTriggerMode" | "exitOnFailedBreakout" |
  "keepCooldownSignalsByDirection" | "filterExtendedCooldownEntries" | "emaFast" | "emaSlow" | "exitTrigger"
> & {
  macdFastPeriod: number;
  macdSlowPeriod: number;
  macdSignalPeriod: number;
  zeroFilterEnabled: boolean;
  zeroProximityPct: number;
};

export type MacdTrendStrategyConfig = MacdStrategyConfigBase & {
  type: "MACD_TREND";
  exitTrigger: "MACD" | "NONE";
};

export type MacdMomentumStrategyConfig = MacdStrategyConfigBase & {
  type: "MACD_MOMENTUM";
  exitTrigger: "MACD_MOMENTUM" | "NONE";
};

export type StrategyConfig = EmaTrendStrategyConfig | MacdTrendStrategyConfig | MacdMomentumStrategyConfig;

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
  /** Daily candle opening hour in Beijing time (UTC+8). */
  dailyCandleStartHour?: DailyCandleStartHour;
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

const lossCooldownBarsSchema = z.number().int().nonnegative().safe().optional();
export const defaultLevelMinClearanceAtr = 1;
const levelFilterFields = {
  levelFilterEnabled: z.boolean().optional(),
  levelMinClearanceAtr: z.number().finite().min(0.1).optional()
};

const emaTrendStrategyConfigSchema = z.object({
  ...levelFilterFields,
  type: z.literal("EMA_TREND"),
  trendEmaPeriod: z.number().int().positive().optional(),
  trendMaType: z.enum(["MA", "EMA"]).default("MA"),
  trendTriggerMode: z.enum(["INTRABAR_TOUCH", "CLOSE_CROSS"]).default("INTRABAR_TOUCH"),
  exitOnFailedBreakout: z.boolean().optional(),
  keepCooldownSignalsByDirection: z.boolean().optional(),
  filterExtendedCooldownEntries: z.boolean().optional(),
  emaFast: z.number().int().positive().optional(),
  emaSlow: z.number().int().positive().optional(),
  atrPeriod: z.number().int().positive(),
  atrMultiplier: z.number().positive(),
  atrStopEnabled: z.boolean().default(false),
  adxPeriod: z.number().int().positive(),
  adxThreshold: z.number().min(0).max(100),
  adxFilterEnabled: z.boolean().default(false),
  volumeMaPeriod: z.number().int().positive(),
  volumeMultiplier: z.number().positive(),
  volumeFilterEnabled: z.boolean().default(false),
  lossCooldownBars: lossCooldownBarsSchema,
  resumeEntryAfterCooldown: z.boolean().optional(),
  direction: z.enum(["LONG_ONLY", "SHORT_ONLY", "LONG_SHORT"]),
  exitTrigger: z.enum(["EMA", "NONE"]).default("EMA")
}).transform((value) => ({
  ...value,
  trendEmaPeriod: value.trendEmaPeriod ?? value.emaSlow ?? 200
}));

const macdTrendStrategyConfigSchema = z.object({
  ...levelFilterFields,
  type: z.literal("MACD_TREND"),
  macdFastPeriod: z.number().int().positive().default(12),
  macdSlowPeriod: z.number().int().positive().default(26),
  macdSignalPeriod: z.number().int().positive().default(9),
  zeroFilterEnabled: z.boolean().default(false),
  zeroProximityPct: z.number().min(0).max(100).default(0.5),
  atrPeriod: z.number().int().positive(),
  atrMultiplier: z.number().positive(),
  atrStopEnabled: z.boolean().default(false),
  adxPeriod: z.number().int().positive(),
  adxThreshold: z.number().min(0).max(100),
  adxFilterEnabled: z.boolean().default(false),
  volumeMaPeriod: z.number().int().positive(),
  volumeMultiplier: z.number().positive(),
  volumeFilterEnabled: z.boolean().default(false),
  lossCooldownBars: lossCooldownBarsSchema,
  resumeEntryAfterCooldown: z.boolean().optional(),
  direction: z.enum(["LONG_ONLY", "SHORT_ONLY", "LONG_SHORT"]),
  exitTrigger: z.enum(["MACD", "NONE"]).default("MACD")
}).refine((value) => value.macdFastPeriod < value.macdSlowPeriod, {
  message: "macdFastPeriod must be less than macdSlowPeriod",
  path: ["macdFastPeriod"]
});

const macdMomentumStrategyConfigSchema = z.object({
  ...levelFilterFields,
  type: z.literal("MACD_MOMENTUM"),
  macdFastPeriod: z.number().int().positive().default(12),
  macdSlowPeriod: z.number().int().positive().default(26),
  macdSignalPeriod: z.number().int().positive().default(9),
  zeroFilterEnabled: z.boolean().default(false),
  zeroProximityPct: z.number().min(0).max(100).default(0.5),
  atrPeriod: z.number().int().positive(),
  atrMultiplier: z.number().positive(),
  atrStopEnabled: z.boolean().default(false),
  adxPeriod: z.number().int().positive(),
  adxThreshold: z.number().min(0).max(100),
  adxFilterEnabled: z.boolean().default(false),
  volumeMaPeriod: z.number().int().positive(),
  volumeMultiplier: z.number().positive(),
  volumeFilterEnabled: z.boolean().default(false),
  lossCooldownBars: lossCooldownBarsSchema,
  resumeEntryAfterCooldown: z.boolean().optional(),
  direction: z.enum(["LONG_ONLY", "SHORT_ONLY", "LONG_SHORT"]),
  exitTrigger: z.enum(["MACD_MOMENTUM", "NONE"]).default("MACD_MOMENTUM")
}).refine((value) => value.macdFastPeriod < value.macdSlowPeriod, {
  message: "macdFastPeriod must be less than macdSlowPeriod",
  path: ["macdFastPeriod"]
});

export const backtestConfigSchema = z.object({
  symbol: z.enum(supportedSymbols),
  timeframe: z.enum(supportedTimeframes),
  dailyCandleStartHour: z.custom<DailyCandleStartHour>(
    (hour) => dailyCandleStartHours.some((allowed) => allowed === hour),
    "Daily candle start hour must be 0, 4, 8, 12, 16 or 20"
  ).optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  initialCapital: z.number().positive(),
  feeRate: z.number().min(0).max(0.1),
  slippageRate: z.number().min(0).max(0.1),
  strategy: z.union([emaTrendStrategyConfigSchema, macdTrendStrategyConfigSchema, macdMomentumStrategyConfigSchema])
}).refine((value) => Date.parse(value.startTime) < Date.parse(value.endTime), {
  message: "startTime must be before endTime",
  path: ["startTime"]
}).refine((value) => value.dailyCandleStartHour === undefined || supportsDailyCandleStart(value.symbol, value.timeframe), {
  message: "Daily candle start hour is available for crypto daily backtests",
  path: ["dailyCandleStartHour"]
});
