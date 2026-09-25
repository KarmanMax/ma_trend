import type { Candle } from "@trend-trade/shared";
import { fetch, ProxyAgent } from "undici";

export type CryptoAsset = {
  id: string;
  symbol: string;
  name: string;
  marketCapRank: number;
  marketCap: number;
};

type CoinGeckoMarketRow = {
  id: string;
  symbol: string;
  name: string;
  market_cap_rank: number | null;
  market_cap: number | null;
};

type ExchangeInfo = {
  symbols: Array<{
    symbol: string;
    status: string;
    baseAsset: string;
    quoteAsset: string;
    isSpotTradingAllowed: boolean;
  }>;
};

type BinanceKline = [number, string, string, string, string, string, number, ...unknown[]];

function proxyDispatcher(): ProxyAgent | undefined {
  const proxyUrl = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? process.env.https_proxy ?? process.env.http_proxy;
  return proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
}

export class CoinGeckoTop300Provider {
  private readonly dispatcher = proxyDispatcher();

  constructor(private readonly baseUrl = "https://api.coingecko.com") {}

  async listTop300(): Promise<CryptoAsset[]> {
    const rows: CoinGeckoMarketRow[] = [];
    for (const page of [1, 2]) {
      const url = new URL("/api/v3/coins/markets", this.baseUrl);
      url.searchParams.set("vs_currency", "usd");
      url.searchParams.set("order", "market_cap_desc");
      url.searchParams.set("per_page", "250");
      url.searchParams.set("page", String(page));
      url.searchParams.set("sparkline", "false");
      const apiKey = process.env.COINGECKO_DEMO_API_KEY;
      const response = await fetch(url, {
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
        ...(apiKey ? { headers: { "x-cg-demo-api-key": apiKey } } : {})
      });
      if (!response.ok) {
        throw new Error(`CoinGecko markets request failed: ${response.status} ${response.statusText}`);
      }
      const pageRows = (await response.json()) as CoinGeckoMarketRow[];
      rows.push(...pageRows);
    }

    if (rows.length < 300) {
      throw new Error(`CoinGecko returned only ${rows.length} assets for Top300`);
    }
    return rows.slice(0, 300).map((row, index) => ({
      id: row.id,
      symbol: row.symbol.toUpperCase(),
      name: row.name,
      marketCapRank: row.market_cap_rank ?? index + 1,
      marketCap: row.market_cap ?? 0
    }));
  }
}

export class BinanceSpotDailyProvider {
  private readonly dispatcher = proxyDispatcher();

  constructor(private readonly baseUrl = "https://api.binance.com") {}

  async listUsdtSpotPairs(): Promise<Map<string, string>> {
    const response = await fetch(new URL("/api/v3/exchangeInfo", this.baseUrl), this.dispatcher ? { dispatcher: this.dispatcher } : undefined);
    if (!response.ok) {
      throw new Error(`Binance exchange info request failed: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as ExchangeInfo;
    return new Map(data.symbols
      .filter((item) => item.status === "TRADING" && item.isSpotTradingAllowed && item.quoteAsset === "USDT")
      .map((item) => [item.baseAsset, item.symbol]));
  }

  async getDailyCandles(input: { coinId: string; pair: string; startTime: number; endTime: number }): Promise<Candle[]> {
    const candles: Candle[] = [];
    let cursor = input.startTime;
    while (cursor < input.endTime) {
      const url = new URL("/api/v3/klines", this.baseUrl);
      url.searchParams.set("symbol", input.pair);
      url.searchParams.set("interval", "1d");
      url.searchParams.set("startTime", String(cursor));
      url.searchParams.set("endTime", String(input.endTime));
      url.searchParams.set("limit", "1000");
      const response = await fetch(url, this.dispatcher ? { dispatcher: this.dispatcher } : undefined);
      if (!response.ok) {
        throw new Error(`Binance daily kline request failed for ${input.pair}: ${response.status} ${response.statusText}`);
      }
      const rows = (await response.json()) as BinanceKline[];
      if (rows.length === 0) break;
      candles.push(...rows.map((row) => ({
        symbol: input.coinId,
        timeframe: "1d" as const,
        openTime: row[0],
        closeTime: row[6],
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5])
      })));
      cursor = rows[rows.length - 1][6] + 1;
      if (rows.length < 1000) break;
    }
    return candles.filter((candle) => candle.openTime >= input.startTime && candle.closeTime <= input.endTime);
  }
}
