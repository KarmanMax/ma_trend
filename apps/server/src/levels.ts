import { atr } from "@trend-trade/indicator";
import { BinanceMarketDataProvider, BinanceSpotDailyProvider, CoinGeckoTop300Provider, RoutedMarketDataProvider } from "@trend-trade/market-data";
import type { CryptoAsset } from "@trend-trade/market-data";
import type { Candle, SymbolCode, Timeframe } from "@trend-trade/shared";
import { Router } from "express";
import { z } from "zod";

export const levelTimeframes = ["1h", "4h", "1d", "1w"] as const;
export type LevelTimeframe = (typeof levelTimeframes)[number];
export type LevelSide = "support" | "resistance";
export type Market = "crypto" | "us";

type ScanAsset = { symbol: string; name: string; market: Market; pair?: string; marketCapRank?: number };
const stockAssets: ScanAsset[] = [
  { symbol: "AAPL", name: "Apple", market: "us" },
  { symbol: "MSFT", name: "Microsoft", market: "us" },
  { symbol: "NVDA", name: "NVIDIA", market: "us" },
  { symbol: "AMZN", name: "Amazon", market: "us" },
  { symbol: "GOOGL", name: "Alphabet", market: "us" },
  { symbol: "META", name: "Meta", market: "us" },
  { symbol: "BRK-B", name: "Berkshire Hathaway", market: "us" },
  { symbol: "JPM", name: "JPMorgan Chase", market: "us" },
  { symbol: "V", name: "Visa", market: "us" },
  { symbol: "MA", name: "Mastercard", market: "us" },
  { symbol: "WMT", name: "Walmart", market: "us" },
  { symbol: "COST", name: "Costco", market: "us" },
  { symbol: "UNH", name: "UnitedHealth", market: "us" },
  { symbol: "XOM", name: "Exxon Mobil", market: "us" },
  { symbol: "AMD", name: "AMD", market: "us" },
  { symbol: "AVGO", name: "Broadcom", market: "us" },
  { symbol: "TSM", name: "TSMC", market: "us" },
  { symbol: "ASML", name: "ASML", market: "us" },
  { symbol: "QCOM", name: "Qualcomm", market: "us" },
  { symbol: "TXN", name: "Texas Instruments", market: "us" },
  { symbol: "AMAT", name: "Applied Materials", market: "us" },
  { symbol: "LRCX", name: "Lam Research", market: "us" },
  { symbol: "KLAC", name: "KLA", market: "us" },
  { symbol: "MU", name: "Micron", market: "us" },
  { symbol: "INTC", name: "Intel", market: "us" },
  { symbol: "ARM", name: "Arm", market: "us" },
  { symbol: "MRVL", name: "Marvell", market: "us" },
  { symbol: "ADI", name: "Analog Devices", market: "us" },
  { symbol: "NXPI", name: "NXP Semiconductors", market: "us" },
  { symbol: "MCHP", name: "Microchip Technology", market: "us" },
  { symbol: "ON", name: "ON Semiconductor", market: "us" },
  { symbol: "MPWR", name: "Monolithic Power Systems", market: "us" },
  { symbol: "TER", name: "Teradyne", market: "us" }
];

const fallbackCryptoAssets: ScanAsset[] = [
  ["BTC", "Bitcoin"], ["ETH", "Ethereum"], ["SOL", "Solana"], ["BNB", "BNB"], ["XRP", "XRP"],
  ["ADA", "Cardano"], ["DOGE", "Dogecoin"], ["AVAX", "Avalanche"], ["LINK", "Chainlink"], ["UNI", "Uniswap"]
].map(([symbol, name]) => ({ symbol, name, market: "crypto" }));

const querySchema = z.object({
  timeframe: z.enum(levelTimeframes).default("1d"),
  market: z.enum(["all", "crypto", "us"]).default("all"),
  side: z.enum(["all", "support", "resistance"]).default("all"),
  proximityPct: z.coerce.number().min(0.1).max(10).default(2)
});

const candleQuerySchema = z.object({
  symbol: z.string().trim().min(2).max(30),
  timeframe: z.enum(levelTimeframes),
  before: z.coerce.number().int().positive().optional()
});

const lookbackDays: Record<LevelTimeframe, number> = { "1h": 30, "4h": 59, "1d": 250, "1w": 3 * 365 };

type ScanMatch = {
  symbol: string;
  name: string;
  market: Market;
  timeframe: LevelTimeframe;
  side: LevelSide;
  price: number;
  level: number;
  zoneLow: number;
  zoneHigh: number;
  distancePct: number;
  touches: number;
  levelTime: number;
  priceTime: number;
};

const marketData = new RoutedMarketDataProvider();
const cryptoMarketData = new BinanceMarketDataProvider();
const coinGecko = new CoinGeckoTop300Provider();
const binancePairs = new BinanceSpotDailyProvider();
let cryptoUniverseCache: { expiresAt: number; assets: ScanAsset[] } | null = null;
export const levelsRouter = Router();

const stablecoinIds = new Set([
  "tether", "usd-coin", "dai", "ethena-usde", "usds", "first-digital-usd", "paypal-usd",
  "true-usd", "frax", "usdd", "ripple-usd", "gho", "crvusd", "liquity-usd", "usual-usd",
  "usual-stablecoin", "world-liberty-financial-usd", "binance-usd", "gemini-dollar", "paxos-standard",
  "united-stables", "bfusd"
]);
const stablecoinSymbols = new Set([
  "USDT", "USDC", "DAI", "USDE", "USDS", "USD1", "PYUSD", "FDUSD", "TUSD", "FRAX",
  "USDD", "RLUSD", "GHO", "CRVUSD", "LUSD", "USDA", "USDY", "USUAL", "USR", "USDTB",
  "AUSD", "USDF", "CUSD", "EURC", "EURS", "EURI", "U", "BFUSD"
]);

export function isStablecoinAsset(asset: Pick<CryptoAsset, "id" | "symbol" | "name">): boolean {
  if (stablecoinIds.has(asset.id) || stablecoinSymbols.has(asset.symbol.toUpperCase())) return true;
  return /(?:stablecoin|\bstables?\b|\busd\b|\bdollar\b|\beuro coin\b)/i.test(asset.name);
}

async function loadCryptoAssets(): Promise<ScanAsset[]> {
  if (cryptoUniverseCache && cryptoUniverseCache.expiresAt > Date.now()) return cryptoUniverseCache.assets;
  try {
    const [topAssets, pairs] = await Promise.all([coinGecko.listTop300(), binancePairs.listUsdtSpotPairs()]);
    const assets = topAssets.slice(0, 200).filter((asset) => !isStablecoinAsset(asset)).flatMap((asset) => {
      const pair = pairs.get(asset.symbol);
      return pair ? [{ symbol: asset.symbol, name: asset.name, market: "crypto" as const, pair, marketCapRank: asset.marketCapRank }] : [];
    });
    if (assets.length < 10) throw new Error(`Only ${assets.length} non-stablecoin Top200 crypto assets have active Binance USDT pairs`);
    cryptoUniverseCache = { expiresAt: Date.now() + 5 * 60_000, assets };
    return assets;
  } catch {
    return fallbackCryptoAssets;
  }
}

async function loadAssets(): Promise<ScanAsset[]> {
  return [...await loadCryptoAssets(), ...stockAssets];
}

async function getAssetCandles(asset: ScanAsset, timeframe: LevelTimeframe, startTime: number, endTime: number): Promise<Candle[]> {
  if (asset.market === "crypto" && asset.pair) {
    return cryptoMarketData.getCandlesByPair(asset.pair, { symbol: asset.symbol, timeframe, startTime, endTime });
  }
  return marketData.getCandles({ symbol: asset.symbol as SymbolCode, timeframe, startTime, endTime });
}

levelsRouter.get("/candles", async (request, response, next) => {
  try {
    const { symbol, timeframe, before } = candleQuerySchema.parse(request.query);
    const assets = await loadAssets();
    const asset = assets.find((item) => item.symbol === symbol);
    if (!asset) { response.status(404).json({ error: `${symbol} is not in the current scan universe` }); return; }
    const now = Date.now();
    if (before !== undefined && before > now) {
      response.status(400).json({ error: "before must not be in the future" });
      return;
    }
    const endTime = before ?? now;
    const interval = timeframe === "4h" ? 4 * 60 * 60_000 : 1;
    const startTime = Math.floor((endTime - lookbackDays[timeframe] * 86_400_000) / interval) * interval;
    const candles = await getAssetCandles(asset, timeframe, startTime, endTime);
    const page = selectCompletedCandlePage(candles, now, endTime);
    response.json({
      symbol,
      timeframe,
      candles: page,
      nextBefore: page[0]?.openTime ?? null
    });
  } catch (error) {
    next(error);
  }
});

export function selectCompletedCandlePage(candles: Candle[], now: number, before: number): Candle[] {
  const unique = new Map<number, Candle>();
  for (const candle of candles) {
    if (candle.openTime < before && candle.closeTime < now) unique.set(candle.openTime, candle);
  }
  return [...unique.values()].sort((a, b) => a.openTime - b.openTime).slice(-160);
}

levelsRouter.get("/scan", async (request, response, next) => {
  try {
    const query = querySchema.parse(request.query);
    const assets = await loadAssets();
    const universe = assets.filter((asset) => query.market === "all" || asset.market === query.market);
    const now = Date.now();
    const matches: ScanMatch[] = [];
    const unavailable: Array<{ symbol: string; reason: string }> = [];
    let scanned = 0;
    let nextIndex = 0;

    await Promise.all(Array.from({ length: Math.min(4, universe.length) }, async () => {
      while (nextIndex < universe.length) {
        const asset = universe[nextIndex++];
        try {
          const candles = await getAssetCandles(asset, query.timeframe, now - lookbackDays[query.timeframe] * 86_400_000, now);
          const completed = candles.filter((candle) => candle.closeTime < now).sort((a, b) => a.openTime - b.openTime).slice(-120);
          if (completed.length < 30) {
            unavailable.push({ symbol: asset.symbol, reason: `Only ${completed.length} completed bars (30 required)` });
            continue;
          }
          scanned++;
          matches.push(...findNearbyLevels(completed, query.proximityPct)
            .filter((match) => query.side === "all" || match.side === query.side)
            .map((match) => ({ ...match, ...asset, timeframe: query.timeframe })));
        } catch (error) {
          unavailable.push({ symbol: asset.symbol, reason: error instanceof Error ? error.message : "Market data unavailable" });
        }
      }
    }));

    matches.sort((a, b) => a.distancePct - b.distancePct || a.symbol.localeCompare(b.symbol));
    unavailable.sort((a, b) => a.symbol.localeCompare(b.symbol));
    response.json({ ...query, asOf: new Date(now).toISOString(), total: universe.length, scanned, matches, unavailable });
  } catch (error) {
    next(error);
  }
});

type LevelMatch = Pick<ScanMatch, "side" | "price" | "level" | "zoneLow" | "zoneHigh" | "distancePct" | "touches" | "levelTime" | "priceTime">;
type Pivot = { price: number; time: number; index: number };
type Touch = { price: number; time: number };
type PriceZone = { level: number; zoneLow: number; zoneHigh: number; touches: number; time: number };

const levelAtrPeriod = 14;
const levelAtrHalfWidth = 0.25;

/** A zone needs two independent five-bar swing touches in the latest 120 completed bars. */
export function findNearbyLevels(candles: Candle[], proximityPct: number): LevelMatch[] {
  const bars = candles.filter((bar) =>
    Number.isFinite(bar.high) && Number.isFinite(bar.low) && Number.isFinite(bar.close) &&
    bar.high > 0 && bar.low > 0 && bar.close > 0
  ).slice(-120);
  if (bars.length < levelAtrPeriod) return [];
  const latest = bars[bars.length - 1];
  const latestAtr = atr(bars, levelAtrPeriod).at(-1);
  if (latestAtr === null || latestAtr === undefined || !Number.isFinite(latestAtr) || latestAtr <= 0) return [];
  const halfWidth = latestAtr * levelAtrHalfWidth;
  const matches: LevelMatch[] = [];

  for (const side of ["support", "resistance"] as const) {
    const pivots: Pivot[] = [];
    for (let i = 2; i < bars.length - 2; i++) {
      const price = side === "support" ? bars[i].low : bars[i].high;
      const neighbors = [bars[i - 2], bars[i - 1], bars[i + 1], bars[i + 2]]
        .map((bar) => side === "support" ? bar.low : bar.high);
      const isPivot = side === "support"
        ? neighbors.every((value) => price <= value) && neighbors.some((value) => price < value)
        : neighbors.every((value) => price >= value) && neighbors.some((value) => price > value);
      if (isPivot && Number.isFinite(price) && price > 0) pivots.push({ price, time: bars[i].closeTime, index: i });
    }

    const nearest = buildPriceZones(pivots, bars, side, halfWidth)
      .filter((zone) => side === "support" ? latest.close >= zone.zoneLow : latest.close <= zone.zoneHigh)
      .sort((a, b) => Math.abs(latest.close - a.level) - Math.abs(latest.close - b.level))[0];
    if (!nearest) continue;
    const distancePct = Math.abs(latest.close - nearest.level) / latest.close * 100;
    if (distancePct <= proximityPct) {
      matches.push({
        side,
        price: latest.close,
        level: nearest.level,
        zoneLow: nearest.zoneLow,
        zoneHigh: nearest.zoneHigh,
        distancePct,
        touches: nearest.touches,
        levelTime: nearest.time,
        priceTime: latest.closeTime
      });
    }
  }

  return matches;
}

function buildPriceZones(pivots: Pivot[], bars: Candle[], side: LevelSide, halfWidth: number): PriceZone[] {
  if (pivots.length < 2) return [];
  const seeds = new Set<number>(pivots.map((pivot) => pivot.price));
  for (let left = 0; left < pivots.length; left++) {
    for (let right = left + 1; right < pivots.length; right++) {
      if (Math.abs(pivots[left].price - pivots[right].price) <= halfWidth * 2) {
        seeds.add((pivots[left].price + pivots[right].price) / 2);
      }
    }
  }

  const zones: PriceZone[] = [];
  for (const seed of seeds) {
    const zone = refinePriceZone(seed, pivots, bars, side, halfWidth);
    if (!zone) continue;
    const duplicateIndex = zones.findIndex((item) => Math.abs(item.level - zone.level) <= halfWidth * 1e-6);
    if (duplicateIndex === -1) {
      zones.push(zone);
    } else if (zone.touches > zones[duplicateIndex].touches ||
      (zone.touches === zones[duplicateIndex].touches && zone.time > zones[duplicateIndex].time)) {
      zones[duplicateIndex] = zone;
    }
  }
  return zones;
}

function refinePriceZone(seed: number, pivots: Pivot[], bars: Candle[], side: LevelSide, halfWidth: number): PriceZone | null {
  let level = seed;
  let touches: Touch[] = [];
  for (let iteration = 0; iteration < 6; iteration++) {
    const zoneLow = level - halfWidth;
    const zoneHigh = level + halfWidth;
    const members = pivots.filter((pivot) => pivot.price >= zoneLow && pivot.price <= zoneHigh);
    touches = collapseTouchEpisodes(members, bars, side, zoneLow, zoneHigh);
    if (touches.length < 2) return null;
    const nextLevel = median(touches.map((touch) => touch.price));
    if (Math.abs(nextLevel - level) <= Math.max(Number.EPSILON * Math.abs(level), 1e-12)) {
      level = nextLevel;
      break;
    }
    level = nextLevel;
  }

  const zoneLow = level - halfWidth;
  const zoneHigh = level + halfWidth;
  touches = collapseTouchEpisodes(
    pivots.filter((pivot) => pivot.price >= zoneLow && pivot.price <= zoneHigh),
    bars,
    side,
    zoneLow,
    zoneHigh
  );
  if (touches.length < 2) return null;
  const finalLevel = median(touches.map((touch) => touch.price));
  return {
    level: finalLevel,
    zoneLow: finalLevel - halfWidth,
    zoneHigh: finalLevel + halfWidth,
    touches: touches.length,
    time: Math.max(...touches.map((touch) => touch.time))
  };
}

function collapseTouchEpisodes(pivots: Pivot[], bars: Candle[], side: LevelSide, zoneLow: number, zoneHigh: number): Touch[] {
  const ordered = [...pivots].sort((a, b) => a.index - b.index);
  if (ordered.length === 0) return [];
  const groups: Pivot[][] = [[ordered[0]]];
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const leftZone = bars.slice(previous.index + 1, current.index).some((bar) =>
      side === "support" ? bar.low > zoneHigh : bar.high < zoneLow
    );
    if (leftZone) groups.push([current]);
    else groups[groups.length - 1].push(current);
  }

  return groups.map((group) => ({
    price: side === "support"
      ? Math.min(...group.map((pivot) => pivot.price))
      : Math.max(...group.map((pivot) => pivot.price)),
    time: Math.max(...group.map((pivot) => pivot.time))
  }));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
