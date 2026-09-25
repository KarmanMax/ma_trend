import { describe, expect, it } from "vitest";
import type { Candle } from "@trend-trade/shared";
import {
  createStrategyConfigKey,
  IncrementalStrategyRunner,
  type IncrementalStrategySession,
  type StrategySessionIdentity
} from "./incremental";

type TestState = { seen: number };

class TestSession implements IncrementalStrategySession<TestState> {
  readonly id = "TEST_STATEFUL";
  readonly name = "Test stateful strategy";
  readonly stateVersion = 1;
  private seen = 0;

  onClosedBar(_candle: Candle) {
    this.seen += 1;
    return {
      signal: { type: this.seen === 4 ? "BUY" as const : "HOLD" as const },
      status: { phase: this.seen < 4 ? "WAITING" : "ENTERED" }
    };
  }

  snapshot(): TestState {
    return { seen: this.seen };
  }

  restore(state: TestState): void {
    this.seen = state.seen;
  }
}

const identity: StrategySessionIdentity = {
  strategyType: "TEST_STATEFUL",
  configKey: createStrategyConfigKey({ type: "TEST_STATEFUL", option: 1 }),
  symbol: "ETH",
  timeframe: "1d"
};

function candle(index: number, symbol: Candle["symbol"] = "ETH"): Candle {
  return {
    symbol,
    timeframe: "1d",
    openTime: index * 86_400_000,
    closeTime: (index + 1) * 86_400_000 - 1,
    open: 10,
    high: 11,
    low: 9,
    close: 10,
    volume: 100
  };
}

describe("incremental strategy runner", () => {
  it("matches uninterrupted replay after restoring a serialized checkpoint", () => {
    const bars = Array.from({ length: 7 }, (_, index) => candle(index));
    const continuous = new IncrementalStrategyRunner(new TestSession(), identity);
    const expected = bars.map((bar) => continuous.onClosedBar(bar));

    const first = new IncrementalStrategyRunner(new TestSession(), identity);
    const before = bars.slice(0, 3).map((bar) => first.onClosedBar(bar));
    const checkpoint = JSON.parse(JSON.stringify(first.snapshot()));
    const resumed = new IncrementalStrategyRunner(new TestSession(), identity);
    resumed.restore(checkpoint);
    const after = bars.slice(3).map((bar) => resumed.onClosedBar(bar));

    expect([...before, ...after]).toEqual(expected);
    expect(resumed.snapshot()).toEqual(continuous.snapshot());
    expect(expected[3]).toMatchObject({ signal: { type: "BUY" }, status: { phase: "ENTERED" } });
  });

  it("ignores duplicate and older bars, and isolates symbols", () => {
    const eth = new IncrementalStrategyRunner(new TestSession(), identity);
    const btc = new IncrementalStrategyRunner(new TestSession(), { ...identity, symbol: "BTC" });

    expect(eth.onClosedBar(candle(2))).not.toBeNull();
    expect(eth.onClosedBar(candle(2))).toBeNull();
    expect(eth.onClosedBar(candle(1))).toBeNull();
    expect(btc.onClosedBar(candle(2, "BTC"))).not.toBeNull();
    expect(eth.snapshot().state).toEqual({ seen: 1 });
    expect(btc.snapshot().state).toEqual({ seen: 1 });
    expect(() => eth.onClosedBar(candle(3, "BTC"))).toThrow(/symbol and timeframe/);
    expect(() => eth.onClosedBar({ ...candle(3), openTime: Number.NaN })).toThrow(/invalid timestamps/);
  });

  it("rejects a checkpoint from another config or state version", () => {
    const source = new IncrementalStrategyRunner(new TestSession(), identity);
    source.onClosedBar(candle(0));
    const checkpoint = source.snapshot();
    const otherConfig = new IncrementalStrategyRunner(new TestSession(), { ...identity, configKey: "different" });

    expect(() => otherConfig.restore(checkpoint)).toThrow(/incompatible/);
    expect(() => source.restore({ ...checkpoint, stateVersion: 2 })).toThrow(/incompatible/);
    expect(createStrategyConfigKey({ b: 2, a: 1 })).toBe(createStrategyConfigKey({ a: 1, b: 2 }));
  });

  it("requires a checkpoint restore after a session fails mid-update", () => {
    let shouldFail = true;
    class RecoveringSession extends TestSession {
      override onClosedBar(bar: Candle) {
        const result = super.onClosedBar(bar);
        if (shouldFail) {
          throw new Error("session failed");
        }
        return result;
      }
    }

    const runner = new IncrementalStrategyRunner(new RecoveringSession(), identity);
    const initial = runner.snapshot();
    expect(() => runner.onClosedBar(candle(0))).toThrow("session failed");
    expect(() => runner.snapshot()).toThrow(/failed bar update/);
    expect(() => runner.onClosedBar(candle(0))).toThrow(/must be restored/);

    shouldFail = false;
    runner.restore(initial);
    expect(runner.onClosedBar(candle(0))).toMatchObject({ status: { phase: "WAITING" } });
    expect(runner.snapshot().state).toEqual({ seen: 1 });
  });

  it("rejects state that cannot survive a JSON checkpoint", () => {
    class InvalidSnapshotSession extends TestSession {
      override snapshot(): TestState {
        return { seen: Number.NaN };
      }
    }

    const runner = new IncrementalStrategyRunner(new InvalidSnapshotSession(), identity);
    expect(() => runner.snapshot()).toThrow(/JSON values/);
  });

  it("does not process another bar after a partial restore failure", () => {
    class FragileSession extends TestSession {
      failRestore = true;

      override restore(state: TestState): void {
        super.restore(state);
        if (this.failRestore) {
          throw new Error("restore failed");
        }
      }
    }

    const session = new FragileSession();
    const runner = new IncrementalStrategyRunner(session, identity);
    const initial = runner.snapshot();
    runner.onClosedBar(candle(0));

    expect(() => runner.restore(initial)).toThrow("restore failed");
    expect(() => runner.onClosedBar(candle(1))).toThrow(/must be restored/);

    session.failRestore = false;
    runner.restore(initial);
    expect(runner.onClosedBar(candle(1))).toMatchObject({ status: { phase: "WAITING" } });
    expect(runner.snapshot().state).toEqual({ seen: 1 });
  });
});
