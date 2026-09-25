import { describe, expect, it } from "vitest";
import { defaultWyckoffStrategyConfig, wyckoffStrategyConfigSchema, type Candle } from "@trend-trade/shared";
import { createStrategyConfigKey, IncrementalStrategyRunner } from "./incremental";
import { WyckoffStrategy } from "./wyckoff";

const config = wyckoffStrategyConfigSchema.parse(defaultWyckoffStrategyConfig);
const identity = {
  strategyType: config.type,
  configKey: createStrategyConfigKey(config),
  symbol: "BTC",
  timeframe: "1d" as const
};

function bar(index: number, values: Partial<Pick<Candle, "open" | "high" | "low" | "close" | "volume">> = {}): Candle {
  const openTime = index * 86_400_000;
  return {
    symbol: "BTC",
    timeframe: "1d",
    openTime,
    closeTime: openTime + 86_400_000 - 1,
    open: values.open ?? 100,
    high: values.high ?? 105,
    low: values.low ?? 95,
    close: values.close ?? 100,
    volume: values.volume ?? 100
  };
}

function runner() {
  return new IncrementalStrategyRunner(new WyckoffStrategy(config), identity);
}

describe("Wyckoff SOS to LPS heuristic", () => {
  it("fills new Spring and UTAD settings for older API configurations", () => {
    const { springEnabled: _springEnabled, utadEnabled: _utadEnabled, sosLpsEnabled: _sosLpsEnabled,
      springPenetrationPct: _springPenetrationPct, utadPenetrationPct: _utadPenetrationPct,
      trapReentryMaxBars: _trapReentryMaxBars, ...oldConfig } = defaultWyckoffStrategyConfig;
    expect(wyckoffStrategyConfigSchema.parse(oldConfig)).toEqual(config);
  });

  it("finds a range, confirms SOS and LPS, then exits on invalidation", () => {
    const session = runner();
    for (let index = 0; index < 19; index += 1) {
      expect(session.onClosedBar(bar(index))?.status?.phase).toBe("SEARCHING_RANGE");
    }
    expect(session.onClosedBar(bar(19))?.status?.phase).toBe("RANGE_FOUND");
    expect(session.onClosedBar(bar(20, { open: 105, high: 112, low: 104, close: 110, volume: 200 }))?.status?.phase).toBe("SOS_DETECTED");
    expect(session.onClosedBar(bar(21, { open: 110, high: 111, low: 108, close: 109, volume: 130 }))?.signal.type).toBe("HOLD");
    expect(session.onClosedBar(bar(22, { open: 109, high: 110, low: 105, close: 107, volume: 120 }))?.signal.type).toBe("HOLD");
    expect(session.onClosedBar(bar(23, { open: 107, high: 108, low: 104, close: 106, volume: 110 }))).toMatchObject({
      signal: { type: "BUY" }, status: { phase: "ENTERED" }
    });
    expect(session.snapshot().state).toMatchObject({ breakoutLevel: 105, sosTime: bar(20).closeTime, sosVolume: 200, barsSinceSos: 3 });
    expect(session.onClosedBar(bar(24, { open: 104, high: 105, low: 99, close: 100 }))?.signal.type).toBe("CLOSE_LONG");
    expect(session.snapshot().state.phase).toBe("INVALIDATED");
  });

  it("replays identically after restoring while waiting for LPS", () => {
    const bars = [
      ...Array.from({ length: 20 }, (_, index) => bar(index)),
      bar(20, { open: 105, high: 112, low: 104, close: 110, volume: 200 }),
      bar(21, { open: 110, high: 111, low: 108, close: 109, volume: 130 }),
      bar(22, { open: 109, high: 110, low: 105, close: 107, volume: 120 }),
      bar(23, { open: 107, high: 108, low: 104, close: 106, volume: 110 })
    ];
    const full = runner();
    const expected = bars.map((candle) => full.onClosedBar(candle));
    const first = runner();
    const before = bars.slice(0, 22).map((candle) => first.onClosedBar(candle));
    const resumed = runner();
    resumed.restore(JSON.parse(JSON.stringify(first.snapshot())));
    const after = bars.slice(22).map((candle) => resumed.onClosedBar(candle));

    expect([...before, ...after]).toEqual(expected);
    expect(resumed.snapshot()).toEqual(full.snapshot());
  });

  it("expires the LPS window without inventing an entry", () => {
    const session = runner();
    for (let index = 0; index < 20; index += 1) session.onClosedBar(bar(index));
    session.onClosedBar(bar(20, { open: 105, high: 112, low: 104, close: 110, volume: 200 }));
    for (let index = 21; index <= 36; index += 1) {
      const result = session.onClosedBar(bar(index, { open: 112, high: 114, low: 110, close: 112, volume: 190 }));
      expect(result?.signal.type).not.toBe("BUY");
    }
    expect(session.snapshot().state.phase).toBe("INVALIDATED");
  });

  it("buys a same-bar Spring reclaim and closes the long below its low", () => {
    const session = runner();
    for (let index = 0; index < 20; index += 1) session.onClosedBar(bar(index));

    expect(session.onClosedBar(bar(20, { open: 96, high: 101, low: 92, close: 98 }))).toMatchObject({
      signal: { type: "BUY", reason: expect.stringContaining("Spring") },
      status: { phase: "ENTERED" }
    });
    expect(session.snapshot().state).toMatchObject({ setup: "SPRING", entrySide: "LONG", invalidationPrice: 92 * 0.96 });
    expect(session.onClosedBar(bar(21, { open: 91, high: 92, low: 87, close: 88 }))?.signal.type).toBe("CLOSE_LONG");
  });

  it("restores a pending Spring and enters only when support is reclaimed", () => {
    const first = runner();
    for (let index = 0; index < 20; index += 1) first.onClosedBar(bar(index));
    expect(first.onClosedBar(bar(20, { open: 96, high: 98, low: 92, close: 94 }))?.status?.phase).toBe("SPRING_DETECTED");

    const resumed = runner();
    resumed.restore(JSON.parse(JSON.stringify(first.snapshot())));
    expect(resumed.onClosedBar(bar(20, { open: 96, high: 98, low: 92, close: 94 }))).toBeNull();
    expect(resumed.onClosedBar(bar(21, { open: 94, high: 96, low: 93, close: 94 }))?.status?.phase).toBe("WAITING_FOR_SPRING_RECLAIM");
    expect(resumed.onClosedBar(bar(22, { open: 94, high: 99, low: 94, close: 97 }))?.signal.type).toBe("BUY");
    first.onClosedBar(bar(21, { open: 94, high: 96, low: 93, close: 94 }));
    first.onClosedBar(bar(22, { open: 94, high: 99, low: 94, close: 97 }));
    expect(resumed.snapshot().state).toEqual(first.snapshot().state);
  });

  it("shorts a same-bar UTAD rejection and closes the short above its high", () => {
    const session = runner();
    for (let index = 0; index < 20; index += 1) session.onClosedBar(bar(index));

    expect(session.onClosedBar(bar(20, { open: 104, high: 109, low: 101, close: 103 }))).toMatchObject({
      signal: { type: "SELL_SHORT", reason: expect.stringContaining("UTAD") },
      status: { phase: "ENTERED" }
    });
    expect(session.snapshot().state).toMatchObject({ setup: "UTAD", entrySide: "SHORT", invalidationPrice: 109 * 1.04 });
    expect(session.onClosedBar(bar(21, { open: 111, high: 115, low: 110, close: 114 }))?.signal.type).toBe("CLOSE_SHORT");
  });

  it("waits for a multi-bar UTAD rejection and tracks the highest excursion", () => {
    const session = runner();
    for (let index = 0; index < 20; index += 1) session.onClosedBar(bar(index));
    expect(session.onClosedBar(bar(20, { open: 105, high: 109, low: 104, close: 107, volume: 100 }))?.status?.phase).toBe("UTAD_DETECTED");
    expect(session.onClosedBar(bar(21, { open: 107, high: 110, low: 106, close: 107 }))?.status?.phase).toBe("WAITING_FOR_UTAD_REJECTION");
    expect(session.onClosedBar(bar(22, { open: 107, high: 108, low: 103, close: 104 }))?.signal.type).toBe("SELL_SHORT");
    expect(session.snapshot().state.invalidationPrice).toBeCloseTo(110 * 1.04);
  });

  it("recognizes a failed SOS as UTAD when the close returns inside the range", () => {
    const session = runner();
    for (let index = 0; index < 20; index += 1) session.onClosedBar(bar(index));
    expect(session.onClosedBar(bar(20, { open: 105, high: 112, low: 104, close: 110, volume: 200 }))?.status?.phase).toBe("SOS_DETECTED");
    expect(session.onClosedBar(bar(21, { open: 109, high: 110, low: 102, close: 104 }))).toMatchObject({
      signal: { type: "SELL_SHORT", reason: expect.stringContaining("failed SOS") },
      status: { phase: "ENTERED" }
    });
    expect(session.snapshot().state).toMatchObject({ setup: "UTAD", entrySide: "SHORT" });
  });

  it("does not enter for an ambiguous two-sided sweep or an expired reentry window", () => {
    const ambiguous = runner();
    for (let index = 0; index < 20; index += 1) ambiguous.onClosedBar(bar(index));
    expect(ambiguous.onClosedBar(bar(20, { high: 109, low: 92, close: 100 }))).toMatchObject({
      signal: { type: "HOLD" }, status: { phase: "INVALIDATED" }
    });

    const expired = runner();
    for (let index = 0; index < 20; index += 1) expired.onClosedBar(bar(index));
    expired.onClosedBar(bar(20, { open: 96, high: 98, low: 92, close: 94 }));
    for (let index = 21; index <= 23; index += 1) {
      expect(expired.onClosedBar(bar(index, { open: 94, high: 96, low: 93, close: 94 }))?.signal.type).not.toBe("BUY");
    }
    expect(expired.snapshot().state.phase).toBe("INVALIDATED");
  });
});
