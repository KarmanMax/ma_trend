import { afterEach, expect, it, vi } from "vitest";
import { fetch } from "undici";
import { YahooFinanceMarketDataProvider } from "./index";

vi.mock("undici", () => ({ fetch: vi.fn(), ProxyAgent: class {} }));

const mockedFetch = vi.mocked(fetch);
const hour = 3_600_000;

afterEach(() => {
  vi.restoreAllMocks();
  mockedFetch.mockReset();
});

it.each([["8h", 8], ["12h", 12]] as const)("builds Yahoo %s candles from hourly data", async (timeframe, hours) => {
  const startTime = Date.parse("2024-01-01T00:00:00Z");
  const interval = hours * hour;
  mockedFetch.mockResolvedValueOnce(new Response(JSON.stringify({
    chart: {
      result: [{
        timestamp: [startTime, startTime + hour, startTime + interval].map((time) => time / 1000),
        indicators: { quote: [{
          open: [100, 101, 105],
          high: [103, 108, 109],
          low: [98, 99, 104],
          close: [101, 105, 107],
          volume: [20, 30, 40]
        }] }
      }]
    }
  })) as never);

  const provider = new YahooFinanceMarketDataProvider("https://example.test");
  const candles = await provider.getCandles({ symbol: "AAPL", timeframe, startTime, endTime: startTime + 2 * interval });

  expect(new URL(String(mockedFetch.mock.calls[0][0])).searchParams.get("interval")).toBe("60m");
  expect(candles).toEqual([
    { symbol: "AAPL", timeframe, openTime: startTime, closeTime: startTime + interval - 1, open: 100, high: 108, low: 98, close: 105, volume: 50 },
    { symbol: "AAPL", timeframe, openTime: startTime + interval, closeTime: startTime + 2 * interval - 1, open: 105, high: 109, low: 104, close: 107, volume: 40 }
  ]);
});

it("limits optional warmup to Yahoo's available hourly history", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-13T01:00:00Z"));
  mockedFetch.mockResolvedValueOnce(new Response(JSON.stringify({ chart: { result: [] } })) as never);
  const provider = new YahooFinanceMarketDataProvider("https://example.test");

  await provider.getCandles({
    symbol: "AAPL",
    timeframe: "12h",
    startTime: Date.parse("2024-01-01T00:00:00Z"),
    requiredStartTime: Date.parse("2025-11-13T00:00:00Z"),
    endTime: Date.parse("2026-11-13T00:00:00Z")
  });

  const params = new URL(String(mockedFetch.mock.calls[0][0])).searchParams;
  expect(Number(params.get("period1")) * 1000).toBe(Date.parse("2024-11-13T12:00:00Z"));
});
