import { BinanceUsdtPerpetualProvider, CoinGeckoTop300Provider, type CryptoAsset } from "@trend-trade/market-data";
import {
  detectPumpReversalSignals,
  evaluatePumpReversalSignals,
  pumpBreakdownRules,
  type PumpReversalSetup,
  type SignalOutcome
} from "@trend-trade/strategy";
import type { Candle } from "@trend-trade/shared";
import { isStablecoinAsset } from "./levels";

const intervalMs = 15 * 60_000;
const args = parseArgs(process.argv.slice(2));
const top = integerArg(args, "top", 100);
const lookbackDays = integerArg(args, "lookback-days", 10);
const recentBars = integerArg(args, "recent-bars", 4);
const concurrency = integerArg(args, "concurrency", 5);
const requestedSymbols = stringArg(args, "symbols", "PIEVERSE").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
const json = args.has("json");

const completedEndTime = Math.floor(Date.now() / intervalMs) * intervalMs - 1;
const startTime = completedEndTime - lookbackDays * 86_400_000;
const assetsProvider = new CoinGeckoTop300Provider();
const futuresProvider = new BinanceUsdtPerpetualProvider();

const [allAssets, pairs] = await Promise.all([assetsProvider.listTop300(), futuresProvider.listPairs()]);
const duplicates = duplicateSymbols(allAssets);
const rankedAssets = allAssets
  .slice(0, top)
  .filter((asset) => !duplicates.has(asset.symbol) && !isStablecoinAsset(asset) && pairs.has(asset.symbol));
const forcedAssets = requestedSymbols.flatMap((symbol) => {
  if (!pairs.has(symbol)) return [];
  return [allAssets.find((asset) => asset.symbol === symbol) ?? {
    id: symbol.toLowerCase(), symbol, name: symbol, marketCapRank: 999_999, marketCap: 0
  }];
});
const assets = [...new Map([...rankedAssets, ...forcedAssets].map((asset) => [asset.symbol, asset])).values()];

const scanned: AssetScan[] = [];
const errors: Array<{ symbol: string; error: string }> = [];
let cursor = 0;
const worker = async () => {
  while (cursor < assets.length) {
    const asset = assets[cursor++];
    const pair = pairs.get(asset.symbol)!;
    try {
      const candles = await futuresProvider.getCandles({
        symbol: asset.symbol,
        pair,
        startTime,
        endTime: completedEndTime
      });
      const signals = detectPumpReversalSignals(candles);
      scanned.push({ asset, pair, candles, signals, outcomes: evaluatePumpReversalSignals(candles, signals) });
    } catch (error) {
      errors.push({ symbol: asset.symbol, error: error instanceof Error ? error.message : "Unexpected error" });
    }
  }
};
await Promise.all(Array.from({ length: concurrency }, worker));

const outcomes = scanned.flatMap((item) => item.outcomes);
const latestCloseTime = Math.max(0, ...scanned.flatMap((item) => item.candles.slice(-1).map((candle) => candle.closeTime)));
const cutoff = completedEndTime - (recentBars - 1) * intervalMs;
const opportunities = scanned.flatMap((item) => item.signals
  .filter((signal) => signal.signalTime >= cutoff)
  .map((signal) => ({
    rank: item.asset.marketCapRank,
    symbol: item.asset.symbol,
    pair: item.pair,
    setup: signal.setup,
    signalTime: new Date(signal.signalTime).toISOString(),
    entryPrice: signal.entryPrice,
    invalidationPrice: signal.invalidationPrice,
    pumpReturn: signal.pumpReturn,
    drawdownFromPeak: signal.drawdownFromPeak,
    volumeRatio: signal.volumeRatio,
    slowdown: signal.slowdown && {
      ...signal.slowdown,
      slowdownTime: new Date(signal.slowdown.slowdownTime).toISOString()
    }
  })))
  .sort((left, right) => right.signalTime.localeCompare(left.signalTime) || left.rank - right.rank);

const validation = (["PUMP_BREAKDOWN_SHORT", "CAPITULATION_RECLAIM_LONG"] as const).map((setup) => summarize(setup, outcomes));
const report = {
  generatedAt: new Date().toISOString(),
  dataThrough: latestCloseTime ? new Date(latestCloseTime).toISOString() : null,
  universe: { requestedTop: top, requestedSymbols, scanned: scanned.length, errors: errors.length, lookbackDays, timeframe: "15m" },
  assumptions: { entry: "next candle open", horizonBars: 16, horizonHours: 4, roundTripCost: 0.002 },
  pumpBreakdownRules,
  validation,
  opportunities,
  errors
};
type ScanReport = typeof report;

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHumanReport(report);
}

type AssetScan = {
  asset: CryptoAsset;
  pair: string;
  candles: Candle[];
  signals: ReturnType<typeof detectPumpReversalSignals>;
  outcomes: SignalOutcome[];
};

function summarize(setup: PumpReversalSetup, all: SignalOutcome[]) {
  const rows = all.filter((outcome) => outcome.setup === setup);
  const returns = rows.map((row) => row.directionalReturn);
  const count = rows.length;
  const averageReturn = average(returns);
  const winRate = count === 0 ? 0 : returns.filter((value) => value > 0).length / count;
  const medianReturn = median(returns);
  const averageAdverseExcursion = average(rows.map((row) => row.adverseExcursion));
  const verdict = count < 20 ? "INSUFFICIENT_SAMPLE" : averageReturn > 0 && winRate >= 0.52 ? "SUPPORTED" : "NOT_SUPPORTED";
  return { setup, count, winRate, averageReturn, medianReturn, averageAdverseExcursion, verdict };
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function duplicateSymbols(assets: CryptoAsset[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const asset of assets) {
    if (seen.has(asset.symbol)) duplicates.add(asset.symbol);
    seen.add(asset.symbol);
  }
  return duplicates;
}

function parseArgs(values: string[]): Map<string, string | true> {
  const parsed = new Map<string, string | true>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      parsed.set(key, next);
      index += 1;
    } else {
      parsed.set(key, true);
    }
  }
  return parsed;
}

function integerArg(values: Map<string, string | true>, key: string, fallback: number): number {
  const raw = values.get(key);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`--${key} must be a positive integer`);
  return value;
}

function stringArg(values: Map<string, string | true>, key: string, fallback: string): string {
  const raw = values.get(key);
  if (raw === undefined) return fallback;
  if (raw === true || raw.length === 0) throw new Error(`--${key} requires a value`);
  return raw;
}

function printHumanReport(value: ScanReport): void {
  console.log(`15m 急拉反转扫描 | 数据截至 ${value.dataThrough ?? "无数据"}`);
  console.log(`范围: 市值 Top${value.universe.requestedTop}，成功扫描 ${value.universe.scanned}，回看 ${value.universe.lookbackDays} 天`);
  for (const row of value.validation) {
    console.log([
      row.setup,
      `样本 ${row.count}`,
      `胜率 ${(row.winRate * 100).toFixed(1)}%`,
      `4h均值 ${(row.averageReturn * 100).toFixed(2)}%`,
      `4h中位数 ${(row.medianReturn * 100).toFixed(2)}%`,
      `平均MAE ${(row.averageAdverseExcursion * 100).toFixed(2)}%`,
      `结论 ${row.verdict}`
    ].join(" | "));
  }
  console.log(`最近 ${recentBars} 根已完成K线机会: ${value.opportunities.length}`);
  for (const item of value.opportunities) {
    const momentum = item.slowdown
      ? `（${item.slowdown.pumpDurationMinutes} 分钟） | 45 分钟涨幅 ${(item.slowdown.momentumBeforePeak * 100).toFixed(1)}% → ${(item.slowdown.momentumAfterPeak * 100).toFixed(1)}%`
      : "";
    console.log(`${item.signalTime} ${item.pair} ${item.setup} | 急拉 ${(item.pumpReturn * 100).toFixed(1)}%${momentum} | 峰值回撤 ${(item.drawdownFromPeak * 100).toFixed(1)}% | 量比 ${item.volumeRatio.toFixed(1)} | 参考入场 ${item.entryPrice ?? "待下一根开盘数据"} | 失效 ${item.invalidationPrice}`);
  }
  if (value.errors.length > 0) console.log(`失败 ${value.errors.length}: ${value.errors.slice(0, 5).map((item) => item.symbol).join(", ")}`);
}
