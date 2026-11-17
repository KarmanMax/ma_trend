import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BacktestEngine } from "../packages/backtest/src/index";
import {
  backtestConfigSchema,
  timeframeMilliseconds,
  type BacktestResult,
  type Candle
} from "../packages/shared/src/index";

const database = process.argv[2] ?? fileURLToPath(new URL("../prisma/dev.db", import.meta.url));
const warmupBars = 300;
const windowBars = 120;
const variants = [
  { name: "Baseline", adx: false, cooldown: 0 },
  { name: "ADX", adx: true, cooldown: 0 },
  { name: "Cooldown", adx: false, cooldown: 3 },
  { name: "Both", adx: true, cooldown: 3 }
];

function query<T>(sql: string): T[] {
  const output = execFileSync("sqlite3", ["-readonly", "-json", database, sql], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
  return output.trim() ? JSON.parse(output) as T[] : [];
}

type SavedRun = {
  id: string;
  symbol: string;
  timeframe: string;
  strategyType: string;
  startTime: number;
  endTime: number;
  createdAt: number;
  initialCapital: number;
  feeRate: number;
  slippageRate: number;
  configJson: string;
};

function classifyWindows(candles: Candle[]) {
  const windows: Array<{ start: number; end: number; efficiency: number }> = [];
  for (let start = warmupBars; start + windowBars <= candles.length; start += windowBars) {
    const end = start + windowBars - 1;
    let distance = 0;
    for (let index = start + 1; index <= end; index += 1) {
      distance += Math.abs(candles[index].close - candles[index - 1].close);
    }
    const displacement = Math.abs(candles[end].close - candles[start].close);
    windows.push({ start, end, efficiency: distance === 0 ? 0 : displacement / distance });
  }
  windows.sort((a, b) => a.efficiency - b.efficiency || a.start - b.start);
  const groupSize = Math.floor(windows.length / 3);
  if (groupSize === 0) {
    throw new Error("Sample must contain at least three complete evaluation windows");
  }
  return { chop: windows.slice(0, groupSize), trend: windows.slice(-groupSize), windows: windows.length };
}

function summarize(result: BacktestResult, candles: Candle[], groups: ReturnType<typeof classifyWindows>) {
  const { initialCapital } = result.config;
  if (result.equityCurve.length !== candles.length - warmupBars) {
    throw new Error("Backtest equity must contain one point per evaluated candle");
  }
  function meanReturn(windows: typeof groups.chop) {
    return windows.reduce((sum, { start, end }) => {
      const before = result.equityCurve[start - warmupBars - 1]?.equity ?? initialCapital;
      const after = result.equityCurve[end - warmupBars].equity;
      return sum + (after - before) / before;
    }, 0) / windows.length;
  }
  const openTimeAtClose = new Map(candles.map((candle) => [candle.closeTime, candle.openTime]));
  const sameBarReversals = result.trades.filter((trade, index) => {
    const previous = result.trades[index - 1];
    const open = openTimeAtClose.get(trade.entryTime);
    return previous?.exitTime !== undefined && open !== undefined && previous.side !== trade.side
      && previous.exitTime >= open && previous.exitTime <= trade.entryTime;
  }).length;
  return {
    chopReturn: meanReturn(groups.chop),
    trendReturn: meanReturn(groups.trend),
    totalReturn: result.metrics.totalReturn,
    maxDrawdown: Math.abs(result.metrics.maxDrawdown),
    losingExits: result.trades.filter((trade) => (trade.netPnl ?? 0) < 0).length,
    sameBarReversals,
    fees: result.trades.reduce((sum, trade) => sum + trade.fee, 0)
  };
}

const runs = query<SavedRun>(`
  WITH ranked AS (
    SELECT r.*, c.configJson, ROW_NUMBER() OVER (
      PARTITION BY r.symbol, r.timeframe, r.strategyType ORDER BY r.createdAt DESC, r.id DESC
    ) AS recency
    FROM BacktestRun r JOIN StrategyConfig c ON c.backtestRunId = r.id
    WHERE r.status = 'COMPLETED' AND (
      (r.symbol = 'BTC' AND r.timeframe = '1d' AND r.strategyType = 'EMA_TREND'
        AND json_extract(c.configJson, '$.trendMaType') = 'MA')
      OR (r.symbol, r.timeframe, r.strategyType) IN (
        ('ETH', '4h', 'MACD_TREND'), ('ETH', '5m', 'MACD_MOMENTUM')
      )
    )
  )
  SELECT * FROM ranked WHERE recency = 1 ORDER BY symbol, timeframe;
`);
if (runs.length !== 3) {
  throw new Error("Expected saved BTC 1d MA, ETH 4h MACD and ETH 5m MACD momentum samples");
}

const comparisons = [];
for (const run of runs) {
  const savedConfig = backtestConfigSchema.parse({
    ...run,
    startTime: new Date(run.startTime).toISOString(),
    endTime: new Date(run.endTime).toISOString(),
    strategy: JSON.parse(run.configJson)
  });
  if (!/^[a-z0-9]+$/i.test(run.id)) {
    throw new Error("Unexpected saved backtest ID");
  }
  const interval = timeframeMilliseconds[savedConfig.timeframe];
  const candles: Candle[] = query<Pick<Candle, "closeTime" | "open" | "high" | "low" | "close" | "volume">>(`
    SELECT time AS closeTime, open, high, low, close, volume FROM ChartPoint
    WHERE backtestRunId = '${run.id}' AND time <= ${Math.min(run.endTime, run.createdAt)}
    ORDER BY time;
  `).map((point) => ({
    ...point,
    symbol: savedConfig.symbol,
    timeframe: savedConfig.timeframe,
    openTime: point.closeTime - interval + 1
  }));
  const groups = classifyWindows(candles);
  const startTime = new Date(candles[warmupBars].openTime).toISOString();
  const endTime = new Date(candles[candles.length - 1].closeTime).toISOString();
  const engine = new BacktestEngine({ getCandles: async () => candles });
  const rows = [];
  for (const variant of variants) {
    const result = await engine.run({
      ...savedConfig,
      startTime,
      endTime,
      strategy: {
        ...savedConfig.strategy,
        adxFilterEnabled: variant.adx,
        adxPeriod: 14,
        adxThreshold: 25,
        lossCooldownBars: variant.cooldown
      }
    });
    rows.push({ variant: variant.name, ...summarize(result, candles, groups) });
  }
  const [baseline, , , both] = rows;
  comparisons.push({
    sample: `${run.symbol} ${run.timeframe}`,
    chopChange: both.chopReturn - baseline.chopReturn,
    trendChange: both.trendReturn - baseline.trendReturn,
    drawdownChange: both.maxDrawdown - baseline.maxDrawdown
  });
  console.log(`${run.symbol} ${run.timeframe} ${run.strategyType} (${run.id})`);
  console.log(`${startTime} – ${endTime} | ${candles.length - warmupBars} evaluated bars | ${groups.windows} full windows, ${groups.chop.length} per regime`);
  console.table(rows.map(({ variant, chopReturn, trendReturn, totalReturn, maxDrawdown, fees, ...counts }) => ({
    variant,
    chop: percent(chopReturn),
    trend: percent(trendReturn),
    total: percent(totalReturn),
    drawdown: percent(maxDrawdown),
    ...counts,
    fees: fees.toFixed(2)
  })));
}

function percent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

console.table(comparisons.map(({ sample, chopChange, trendChange, drawdownChange }) => ({
  sample,
  chopChangePp: (chopChange * 100).toFixed(2),
  trendChangePp: (trendChange * 100).toFixed(2),
  drawdownChangePp: (drawdownChange * 100).toFixed(2)
})));
const meetsCriteria = comparisons.filter(({ chopChange }) => chopChange > 0).length >= 2
  && comparisons.every(({ trendChange, drawdownChange }) => trendChange >= -0.02 && drawdownChange <= 0.02);
console.log(meetsCriteria ? "Combined settings meet adoption criteria." : "Combined settings do not meet adoption criteria.");
