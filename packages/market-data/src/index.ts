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

const binanceSymbolMap: Partial<Record<SymbolCode, string>> = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  BNB: "BNBUSDT",
  ENA: "ENAUSDT",
  SUI: "SUIUSDT",
  UNI: "UNIUSDT",
  AAVE: "AAVEUSDT",
  LINK: "LINKUSDT",
  ONDO: "ONDOUSDT",
  HYPE: "HYPEUSDT",
  VVV: "VVVUSDT",
  NEAR: "NEARUSDT",
  MORPHO: "MORPHOUSDT",
  RAY: "RAYUSDT",
  JUP: "JUPUSDT",
  KMNO: "KMNOUSDT",
  CAKE: "CAKEUSDT",
  LDO: "LDOUSDT"
};

const yahooSymbolMap: Partial<Record<SymbolCode, string>> = {
  SKHYNIX: "000660.KS",
  MU: "MU",
  MRVL: "MRVL",
  PLTR: "PLTR",
  HOOD: "HOOD",
  SOFI: "SOFI",
  SNDK: "SNDK",
  CRWV: "CRWV",
  NBIS: "NBIS",
  IREN: "IREN",
  AVGO: "AVGO",
  INTC: "INTC",
  ARM: "ARM",
  AMD: "AMD",
  XIAOMI: "1810.HK",
  BABA: "BABA",
  BIDU: "BIDU",
  "00700": "0700.HK",
  "03690": "3690.HK",
  JD: "JD",
  BILI: "BILI",
  PDD: "PDD",
  TSM: "TSM",
  TCOM: "TCOM",
  FUTU: "FUTU",
  PONY: "PONY"
};

const timeframeMs: Record<Timeframe, number> = {
  "1m": 60_000,
  "2m": 2 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "2h": 2 * 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000
};

export class BinanceMarketDataProvider implements MarketDataProvider {
  private readonly dispatcher?: ProxyAgent;

  constructor(private readonly baseUrl = "https://api.binance.com") {
    const proxyUrl = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? process.env.https_proxy ?? process.env.http_proxy;
    this.dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  }

  async getCandles(request: GetCandlesRequest): Promise<Candle[]> {
    const exchangeSymbol = binanceSymbolMap[request.symbol];
    if (!exchangeSymbol) {
      throw new Error(`Symbol ${request.symbol} is not supported by BinanceMarketDataProvider`);
    }

    const candles: Candle[] = [];
    let cursor = request.startTime;

    while (cursor < request.endTime) {
      const url = new URL("/api/v3/klines", this.baseUrl);
      url.searchParams.set("symbol", exchangeSymbol);
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

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: {
      code?: string;
      description?: string;
    } | null;
  };
};

export class YahooFinanceMarketDataProvider implements MarketDataProvider {
  private readonly dispatcher?: ProxyAgent;

  constructor(private readonly baseUrl = "https://query1.finance.yahoo.com") {
    const proxyUrl = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? process.env.https_proxy ?? process.env.http_proxy;
    this.dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  }

  async getCandles(request: GetCandlesRequest): Promise<Candle[]> {
    const yahooSymbol = yahooSymbolMap[request.symbol];
    if (!yahooSymbol) {
      throw new Error(`Symbol ${request.symbol} is not supported by YahooFinanceMarketDataProvider`);
    }

    const sourceTimeframe = request.timeframe === "2h" || request.timeframe === "4h" ? "1h" : request.timeframe;
    const url = new URL(`/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`, this.baseUrl);
    url.searchParams.set("period1", String(Math.floor(request.startTime / 1000)));
    url.searchParams.set("period2", String(Math.floor(request.endTime / 1000)));
    url.searchParams.set("interval", toYahooInterval(sourceTimeframe));
    url.searchParams.set("includePrePost", "false");
    url.searchParams.set("events", "history");

    const response = await fetch(url, this.dispatcher ? { dispatcher: this.dispatcher } : undefined);
    if (!response.ok) {
      throw new Error(`Yahoo chart request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as YahooChartResponse;
    const error = data.chart?.error;
    if (error) {
      throw new Error(`Yahoo chart request failed: ${error.description ?? error.code ?? "unknown error"}`);
    }

    const result = data.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    if (!result?.timestamp?.length || !quote) {
      return [];
    }

    const sourceCandles = result.timestamp.flatMap((timestamp, index): Candle[] => {
      const open = quote.open?.[index];
      const high = quote.high?.[index];
      const low = quote.low?.[index];
      const close = quote.close?.[index];
      if (open === null || open === undefined || high === null || high === undefined || low === null || low === undefined || close === null || close === undefined) {
        return [];
      }

      const openTime = timestamp * 1000;
      return [{
        symbol: request.symbol,
        timeframe: sourceTimeframe,
        openTime,
        closeTime: openTime + timeframeMs[sourceTimeframe] - 1,
        open,
        high,
        low,
        close,
        volume: quote.volume?.[index] ?? 0
      }];
    });

    const candles = sourceTimeframe === request.timeframe ? sourceCandles : aggregateCandles(sourceCandles, request.timeframe);
    return candles.filter((candle) => candle.openTime >= request.startTime && candle.openTime <= request.endTime);
  }
}

export class RoutedMarketDataProvider implements MarketDataProvider {
  constructor(
    private readonly cryptoProvider: MarketDataProvider = new BinanceMarketDataProvider(),
    private readonly stockProvider: MarketDataProvider = new YahooFinanceMarketDataProvider()
  ) {}

  getCandles(request: GetCandlesRequest): Promise<Candle[]> {
    if (binanceSymbolMap[request.symbol]) {
      return this.cryptoProvider.getCandles(request);
    }

    if (yahooSymbolMap[request.symbol]) {
      return this.stockProvider.getCandles(request);
    }

    throw new Error(`Unsupported symbol: ${request.symbol}`);
  }
}

function toYahooInterval(timeframe: Timeframe): string {
  if (timeframe === "1h") {
    return "60m";
  }

  return timeframe;
}

function aggregateCandles(candles: Candle[], timeframe: Timeframe): Candle[] {
  const interval = timeframeMs[timeframe];
  const groups = new Map<number, Candle[]>();

  for (const candle of candles) {
    const bucket = Math.floor(candle.openTime / interval) * interval;
    const group = groups.get(bucket) ?? [];
    group.push(candle);
    groups.set(bucket, group);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([openTime, group]) => ({
      symbol: group[0].symbol,
      timeframe,
      openTime,
      closeTime: openTime + interval - 1,
      open: group[0].open,
      high: Math.max(...group.map((candle) => candle.high)),
      low: Math.min(...group.map((candle) => candle.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, candle) => sum + candle.volume, 0)
    }));
}
