import type { Candle } from "@trend-trade/shared";
import { describe, expect, it } from "vitest";
import { detectPumpReversalSignals, evaluatePumpReversalSignals } from "./pump-reversal";

function candle(index: number, values: Partial<Candle> = {}): Candle {
  const close = values.close ?? 100;
  return {
    symbol: "TEST",
    timeframe: "15m",
    openTime: index * 900_000,
    closeTime: (index + 1) * 900_000 - 1,
    open: values.open ?? close,
    high: values.high ?? close,
    low: values.low ?? close,
    close,
    volume: values.volume ?? 100,
    ...values
  };
}

describe("pump reversal detector", () => {
  it("keeps the long reclaim rules for a rally below the new short threshold", () => {
    const candles = Array.from({ length: 240 }, (_, index) => candle(index));
    for (let index = 190; index < 200; index += 1) {
      const price = 100 + (index - 190) * 4;
      candles[index] = candle(index, { open: price - 2, high: price + 2, low: price - 3, close: price, volume: 150 });
    }
    candles[200] = candle(200, { open: 138, high: 145, low: 136, close: 142, volume: 180 });
    candles[201] = candle(201, { open: 140, high: 141, low: 108, close: 112, volume: 500 });
    candles[202] = candle(202, { open: 111, high: 115, low: 91, close: 108, volume: 700 });
    candles[203] = candle(203, { open: 109, high: 121, low: 107, close: 120, volume: 300 });
    candles[204] = candle(204, { open: 121, high: 124, low: 119, close: 123, volume: 180 });
    candles[205] = candle(205, { open: 124, high: 126, low: 122, close: 125, volume: 150 });

    const signals = detectPumpReversalSignals(candles);

    expect(signals.map((signal) => signal.setup)).toEqual(["CAPITULATION_RECLAIM_LONG"]);
    expect(signals[0]).toMatchObject({ signalIndex: 203, entryIndex: 204, entryPrice: 121 });
  });

  function shortCandles(peakHigh = 160): Candle[] {
    return [
      ...Array.from({ length: 60 }, (_, index) => candle(index)),
      candle(60, { close: 115 }),
      candle(61, { close: 130 }),
      candle(62, { close: 145 }),
      candle(63, { close: 149, high: peakHigh }),
      candle(64, { close: 148, high: 150 }),
      candle(65, { close: 140, high: 149 }),
      candle(66, { close: 130, high: 141 }),
      candle(67, { open: 129, close: 105, high: 132, volume: 400 })
    ];
  }

  it("confirms the latest closed bar only after the rally, slowdown and descending structure", () => {
    const candles = shortCandles();
    expect(detectPumpReversalSignals(candles.slice(0, -1))).toEqual([]);
    const [signal] = detectPumpReversalSignals(candles);
    expect(signal).toMatchObject({
      setup: "PUMP_BREAKDOWN_SHORT", peakIndex: 63, signalIndex: 67, entryPrice: null,
      slowdown: { pumpDurationMinutes: 60, slowdownTime: candles[66].closeTime }
    });
    expect(detectPumpReversalSignals([...candles, candle(68, { open: 104 })])).toEqual([
      { ...signal, entryTime: candles[67].closeTime + 1, entryPrice: 104 }
    ]);
  });

  it("rejects exactly 50% and a breakdown with no earlier slowdown observation", () => {
    expect(detectPumpReversalSignals(shortCandles(150))).toEqual([]);
    const candles = shortCandles().slice(0, -1);
    candles[66] = candle(66, { close: 105, high: 141, volume: 400 });
    expect(detectPumpReversalSignals(candles)).toEqual([]);
  });

  it("rejects a lower close when the previous high rose", () => {
    const candles = shortCandles();
    candles[66] = { ...candles[66], high: 151 };
    expect(detectPumpReversalSignals(candles)).toEqual([]);
  });

  it("does not score outcomes that lack the full forward horizon", () => {
    const candles = Array.from({ length: 240 }, (_, index) => candle(index));
    const signal = {
      setup: "PUMP_BREAKDOWN_SHORT" as const, symbol: "TEST", peakIndex: 220, signalIndex: 230, entryIndex: 231,
      peakTime: 0, signalTime: 0, entryTime: 0, entryPrice: 100, pumpReturn: 0.4, drawdownFromPeak: 0.2,
      volumeRatio: 3, invalidationPrice: 140
    };
    expect(evaluatePumpReversalSignals(candles, [signal], 16)).toHaveLength(0);
  });
});
