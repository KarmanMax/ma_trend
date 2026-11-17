import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetch } from "undici";
import { BinanceSpotDailyProvider, CoinGeckoTop300Provider } from "./crypto";
import { BinanceMarketDataProvider } from "./index";

vi.mock("undici", () => ({ fetch: vi.fn(), ProxyAgent: class {} }));

const mockedFetch = vi.mocked(fetch);

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

beforeEach(() => mockedFetch.mockReset());

describe("dynamic crypto market data", () => {
  it.each([[0, "8"], [4, "4"], [8, "0"], [12, "-4"], [16, "-8"], [20, "-12"], [undefined, null]] as const)(
    "maps Beijing daily start %s to Binance offset %s without shifting query timestamps",
    async (dailyCandleStartHour, timeZone) => {
      mockedFetch.mockResolvedValueOnce(jsonResponse([]) as never);
      const provider = new BinanceMarketDataProvider("https://example.test");
      const startTime = Date.parse("2024-01-01T00:00:00Z");
      const endTime = Date.parse("2024-01-02T00:00:00Z");
      await provider.getCandles({ symbol: "BTC", timeframe: "1d", dailyCandleStartHour, startTime, endTime });

      const params = new URL(String(mockedFetch.mock.calls[0][0])).searchParams;
      expect(params.get("timeZone")).toBe(timeZone);
      expect(params.get("startTime")).toBe(String(startTime));
      expect(params.get("endTime")).toBe(String(endTime));
    }
  );

  it.each([["8h", 8], ["12h", 12]] as const)("requests native Binance %s candles", async (timeframe, hours) => {
    const openTime = Date.parse("2024-01-01T00:00:00Z");
    const closeTime = openTime + hours * 3_600_000 - 1;
    mockedFetch.mockResolvedValueOnce(jsonResponse([[openTime, "100", "105", "95", "101", "123", closeTime]]) as never);

    const provider = new BinanceMarketDataProvider("https://example.test");
    const candles = await provider.getCandles({ symbol: "BTC", timeframe, startTime: openTime, endTime: closeTime });

    expect(new URL(String(mockedFetch.mock.calls[0][0])).searchParams.get("interval")).toBe(timeframe);
    expect(candles).toEqual([{ symbol: "BTC", timeframe, openTime, closeTime, open: 100, high: 105, low: 95, close: 101, volume: 123 }]);
  });

  it("combines both market-cap pages into a Top300 list", async () => {
    const row = (rank: number) => ({ id: `coin-${rank}`, symbol: `c${rank}`, name: `Coin ${rank}`, market_cap_rank: rank, market_cap: 1_000 - rank });
    mockedFetch.mockResolvedValueOnce(jsonResponse(Array.from({ length: 250 }, (_, index) => row(index + 1))) as never);
    mockedFetch.mockResolvedValueOnce(jsonResponse(Array.from({ length: 250 }, (_, index) => row(index + 251))) as never);

    const assets = await new CoinGeckoTop300Provider("https://example.test").listTop300();

    expect(assets).toHaveLength(300);
    expect(assets[0]).toMatchObject({ id: "coin-1", symbol: "C1", marketCapRank: 1 });
    expect(assets[299]).toMatchObject({ id: "coin-300", marketCapRank: 300 });
    expect(String(mockedFetch.mock.calls[1][0])).toContain("page=2");
  });

  it("lists active USDT spot pairs and excludes an unfinished daily bar", async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse({ symbols: [
      { symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT", isSpotTradingAllowed: true },
      { symbol: "ETHUSDT", status: "BREAK", baseAsset: "ETH", quoteAsset: "USDT", isSpotTradingAllowed: true }
    ] }) as never);
    const provider = new BinanceSpotDailyProvider("https://example.test");
    expect(await provider.listUsdtSpotPairs()).toEqual(new Map([["BTC", "BTCUSDT"]]));

    const kline = (open: number, close: number) => [open, "100", "105", "95", "101", "123", close];
    mockedFetch.mockResolvedValueOnce(jsonResponse([kline(0, 86_399_999), kline(86_400_000, 172_799_999)]) as never);
    const candles = await provider.getDailyCandles({ coinId: "bitcoin", pair: "BTCUSDT", startTime: 0, endTime: 100_000_000 });

    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({ symbol: "bitcoin", timeframe: "1d", close: 101, volume: 123 });
    expect(String(mockedFetch.mock.calls[1][0])).toContain("symbol=BTCUSDT");
  });
});
