import { describe, expect, it } from "vitest";
import { macd } from "./index";

describe("MACD", () => {
  it("uses the first available MACD values to seed the signal EMA", () => {
    const series = macd([10, 10, 10, 12, 10], 2, 3, 2);
    expect(series.line.slice(0, 2)).toEqual([null, null]);
    expect(series.signal.slice(0, 3)).toEqual([null, null, null]);
    expect(series.line[3]).toBeCloseTo(1 / 3);
    expect(series.signal[3]).toBeCloseTo(1 / 6);
    expect(series.histogram[3]).toBeCloseTo(1 / 6);
    expect(series.line[4]).toBeCloseTo(-1 / 18);
  });
});
