import { randomUUID } from "node:crypto";
import { runIncrementalBacktest } from "@trend-trade/backtest";
import { BinanceSpotDailyProvider, CoinGeckoTop300Provider, type CryptoAsset } from "@trend-trade/market-data";
import { defaultWyckoffStrategyConfig, wyckoffStrategyConfigSchema, type Signal, type WyckoffStrategyConfig } from "@trend-trade/shared";
import { createStrategyConfigKey, IncrementalStrategyRunner, WyckoffStrategy, type StrategyCheckpoint, type WyckoffState } from "@trend-trade/strategy";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "./db";

export const wyckoffRouter = Router();

const top300Provider = new CoinGeckoTop300Provider();
const dailyProvider = new BinanceSpotDailyProvider();
const scans = new Map<string, ScanJob>();

const backtestRequestSchema = z.object({
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,20}$/),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  initialCapital: z.number().positive(),
  feeRate: z.number().min(0).max(0.1),
  slippageRate: z.number().min(0).max(0.1),
  strategy: wyckoffStrategyConfigSchema.default(defaultWyckoffStrategyConfig)
}).refine((value) => Date.parse(value.startTime) < Date.parse(value.endTime), {
  message: "startTime must be before endTime",
  path: ["startTime"]
});

const scanRequestSchema = z.object({
  strategy: wyckoffStrategyConfigSchema.default(defaultWyckoffStrategyConfig)
});

type ScanResult = {
  asset: CryptoAsset;
  pair: string | null;
  status: "SCANNED" | "SKIPPED" | "ERROR";
  reason?: string;
  phase?: WyckoffState["phase"];
  setup?: WyckoffState["setup"];
  entrySide?: WyckoffState["entrySide"];
  signal?: Signal;
  lastCloseTime?: number;
  state?: Omit<WyckoffState, "recentCandles">;
};

type ScanJob = {
  id: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  createdAt: string;
  completed: number;
  total: number;
  strategy: WyckoffStrategyConfig;
  results: ScanResult[];
  error?: string;
};

wyckoffRouter.post("/backtests", async (request, response, next) => {
  try {
    const input = backtestRequestSchema.parse(request.body);
    const pairs = await dailyProvider.listUsdtSpotPairs();
    const pair = pairs.get(input.symbol);
    if (!pair) {
      response.status(400).json({ error: `${input.symbol} has no active Binance USDT spot pair` });
      return;
    }
    const candles = await dailyProvider.getDailyCandles({
      coinId: input.symbol,
      pair,
      startTime: Date.parse(input.startTime),
      endTime: Date.parse(input.endTime)
    });
    const result = runIncrementalBacktest({
      candles,
      symbol: input.symbol,
      endTime: Date.parse(input.endTime),
      initialCapital: input.initialCapital,
      feeRate: input.feeRate,
      slippageRate: input.slippageRate,
      strategyConfig: input.strategy,
      session: new WyckoffStrategy(input.strategy)
    });
    const saved = {
      id: randomUUID(),
      config: input,
      pair,
      ...result,
      metrics: {
        ...result.metrics,
        profitFactor: Number.isFinite(result.metrics.profitFactor) ? result.metrics.profitFactor : 999999
      }
    };
    await prisma.wyckoffBacktestRun.create({ data: { id: saved.id, resultJson: JSON.stringify(saved) } });
    response.status(201).json(saved);
  } catch (error) {
    next(error);
  }
});

wyckoffRouter.get("/backtests/:id", async (request, response, next) => {
  try {
    const run = await prisma.wyckoffBacktestRun.findUnique({ where: { id: request.params.id } });
    if (!run) {
      response.status(404).json({ error: "Wyckoff backtest not found" });
      return;
    }
    response.json(JSON.parse(run.resultJson));
  } catch (error) {
    next(error);
  }
});

wyckoffRouter.post("/scans", async (request, response, next) => {
  try {
    const input = scanRequestSchema.parse(request.body);
    if ([...scans.values()].some((job) => job.status === "RUNNING")) {
      response.status(409).json({ error: "A Top300 scan is already running" });
      return;
    }
    const job: ScanJob = {
      id: randomUUID(),
      status: "RUNNING",
      createdAt: new Date().toISOString(),
      completed: 0,
      total: 300,
      strategy: input.strategy,
      results: []
    };
    await persistScanJob(job);
    scans.set(job.id, job);
    trimOldest(scans, 10);
    response.status(202).json({ id: job.id, status: job.status });
    void runScan(job);
  } catch (error) {
    next(error);
  }
});

wyckoffRouter.get("/scans/:id", async (request, response, next) => {
  try {
    const liveJob = scans.get(request.params.id);
    const job = liveJob ?? await loadScanJob(request.params.id);
    if (!job) {
      response.status(404).json({ error: "Wyckoff scan not found" });
      return;
    }
    response.json({ ...job, results: [...job.results].sort((left, right) => left.asset.marketCapRank - right.asset.marketCapRank) });
  } catch (error) {
    next(error);
  }
});

async function runScan(job: ScanJob): Promise<void> {
  try {
    const [assets, pairs] = await Promise.all([top300Provider.listTop300(), dailyProvider.listUsdtSpotPairs()]);
    const duplicates = new Set<string>();
    const seen = new Set<string>();
    for (const asset of assets) {
      if (seen.has(asset.symbol)) duplicates.add(asset.symbol);
      seen.add(asset.symbol);
    }
    let cursor = 0;
    const endTime = Date.now();
    const lookbackDays = Math.max(180, job.strategy.rangeBars + job.strategy.lpsMaxBars + 30);
    const startTime = endTime - lookbackDays * 86_400_000;
    const worker = async () => {
      while (cursor < assets.length) {
        const asset = assets[cursor++];
        try {
          job.results.push(await scanAsset(asset, pairs, duplicates, job.strategy, startTime, endTime));
        } catch (error) {
          job.results.push({
            asset,
            pair: pairs.get(asset.symbol) ?? null,
            status: "ERROR",
            reason: error instanceof Error ? error.message : "Unexpected scan error"
          });
        }
        job.completed += 1;
      }
    };
    await Promise.all(Array.from({ length: 5 }, worker));
    job.status = "COMPLETED";
  } catch (error) {
    job.status = "FAILED";
    job.error = error instanceof Error ? error.message : "Unexpected scan error";
  } finally {
    try {
      await persistScanJob(job);
    } catch (error) {
      job.status = "FAILED";
      job.error = error instanceof Error ? `Could not save scan: ${error.message}` : "Could not save scan";
    }
  }
}

async function scanAsset(
  asset: CryptoAsset,
  pairs: Map<string, string>,
  duplicates: Set<string>,
  strategy: WyckoffStrategyConfig,
  startTime: number,
  endTime: number
): Promise<ScanResult> {
  if (duplicates.has(asset.symbol)) {
    return { asset, pair: null, status: "SKIPPED", reason: "Ticker is ambiguous among Top300 assets" };
  }
  const pair = pairs.get(asset.symbol);
  if (!pair) {
    return { asset, pair: null, status: "SKIPPED", reason: "No active Binance USDT spot pair" };
  }
  const candles = await dailyProvider.getDailyCandles({ coinId: asset.id, pair, startTime, endTime });
  if (candles.length < strategy.rangeBars) {
    return { asset, pair, status: "SKIPPED", reason: `Only ${candles.length} completed daily bars` };
  }

  const configKey = createStrategyConfigKey(strategy);
  const checkpointKey = `${asset.id}:${configKey}`;
  const runner = new IncrementalStrategyRunner(new WyckoffStrategy(strategy), {
    strategyType: strategy.type,
    configKey,
    symbol: asset.id,
    timeframe: "1d"
  });
  const stored = await prisma.wyckoffCheckpoint.findUnique({ where: { key: checkpointKey } });
  if (stored) {
    const checkpoint = JSON.parse(stored.snapshotJson) as StrategyCheckpoint<WyckoffState>;
    if (checkpoint.lastProcessedCloseTime !== null && checkpoint.lastProcessedCloseTime >= startTime - 86_400_000) {
      runner.restore(checkpoint);
    }
  }
  let lastSignal: Signal | undefined;
  for (const candle of candles) {
    const step = runner.onClosedBar(candle);
    if (step) lastSignal = step.signal;
  }
  const nextCheckpoint = runner.snapshot();
  await prisma.wyckoffCheckpoint.upsert({
    where: { key: checkpointKey },
    create: { key: checkpointKey, snapshotJson: JSON.stringify(nextCheckpoint) },
    update: { snapshotJson: JSON.stringify(nextCheckpoint) }
  });
  const { recentCandles: _recentCandles, ...state } = nextCheckpoint.state;
  return {
    asset,
    pair,
    status: "SCANNED",
    phase: state.phase,
    setup: state.setup,
    entrySide: state.entrySide,
    signal: lastSignal,
    lastCloseTime: nextCheckpoint.lastProcessedCloseTime ?? undefined,
    state
  };
}

async function persistScanJob(job: ScanJob): Promise<void> {
  await prisma.wyckoffScanJob.upsert({
    where: { id: job.id },
    create: {
      id: job.id,
      status: job.status,
      completed: job.completed,
      total: job.total,
      strategyJson: JSON.stringify(job.strategy),
      resultsJson: JSON.stringify(job.results),
      error: job.error
    },
    update: {
      status: job.status,
      completed: job.completed,
      total: job.total,
      resultsJson: JSON.stringify(job.results),
      error: job.error
    }
  });
}

async function loadScanJob(id: string): Promise<ScanJob | null> {
  const row = await prisma.wyckoffScanJob.findUnique({ where: { id } });
  if (!row) return null;
  return {
    id: row.id,
    status: row.status as ScanJob["status"],
    createdAt: row.createdAt.toISOString(),
    completed: row.completed,
    total: row.total,
    strategy: JSON.parse(row.strategyJson) as WyckoffStrategyConfig,
    results: JSON.parse(row.resultsJson) as ScanResult[],
    ...(row.error ? { error: row.error } : {})
  };
}

export async function markInterruptedWyckoffScans(): Promise<void> {
  await prisma.wyckoffScanJob.updateMany({
    where: { status: "RUNNING" },
    data: { status: "FAILED", error: "Scan interrupted by server restart; start a new scan" }
  });
}

function trimOldest<T>(items: Map<string, T>, limit: number): void {
  while (items.size > limit) {
    const oldest = items.keys().next().value;
    if (oldest === undefined) break;
    items.delete(oldest);
  }
}
