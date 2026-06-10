import type { Candle, SymbolCode, Timeframe } from "@trend-trade/shared";
import { fetch, ProxyAgent } from "undici";

export type GetCandlesRequest = {
  symbol: SymbolCode;
  timeframe: Timeframe;
  startTime: number;
  endTime: number;
};

export interface MarketDataProvider {
  getCandles(request: GetCandlesRequest): Promise<Candle[]>;
}

type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string
];

export class BinanceMarketDataProvider implements MarketDataProvider {
  private readonly dispatcher?: ProxyAgent;

  constructor(private readonly baseUrl = "https://api.binance.com") {
    const proxyUrl = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? process.env.https_proxy ?? process.env.http_proxy;
    this.dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  }

  async getCandles(request: GetCandlesRequest): Promise<Candle[]> {
    const candles: Candle[] = [];
    let cursor = request.startTime;

    while (cursor < request.endTime) {
      const url = new URL("/api/v3/klines", this.baseUrl);
      url.searchParams.set("symbol", request.symbol);
      url.searchParams.set("interval", request.timeframe);
      url.searchParams.set("startTime", String(cursor));
      url.searchParams.set("endTime", String(request.endTime));
      url.searchParams.set("limit", "1000");

      const response = await fetch(url, this.dispatcher ? { dispatcher: this.dispatcher } : undefined);
      if (!response.ok) {
        throw new Error(`Binance kline request failed: ${response.status} ${response.statusText}`);
      }

      const rows = (await response.json()) as BinanceKline[];
      if (rows.length === 0) {
        break;
      }

      const pageCandles = rows.map((row) => ({
        symbol: request.symbol,
        timeframe: request.timeframe,
        openTime: row[0],
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
        closeTime: row[6]
      }));

      candles.push(...pageCandles);
      cursor = rows[rows.length - 1][6] + 1;

      if (rows.length < 1000) {
        break;
      }
    }

    return candles.filter((candle) => candle.openTime >= request.startTime && candle.openTime <= request.endTime);
  }
}
