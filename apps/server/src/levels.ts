import { findNearbyLevels, priceZoneLookbackBars, type LevelSide } from "@trend-trade/indicator";
import { BinanceMarketDataProvider, BinanceSpotDailyProvider, CoinGeckoTop300Provider, RoutedMarketDataProvider } from "@trend-trade/market-data";
import type { CryptoAsset } from "@trend-trade/market-data";
import type { Candle, SymbolCode, Timeframe } from "@trend-trade/shared";
import { Router } from "express";
import { z } from "zod";

export { findNearbyLevels };
export type { LevelSide };

export const levelTimeframes = ["1h", "4h", "1d", "1w"] as const;
export type LevelTimeframe = (typeof levelTimeframes)[number];
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
          const completed = candles.filter((candle) => candle.closeTime < now).sort((a, b) => a.openTime - b.openTime).slice(-priceZoneLookbackBars);
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
