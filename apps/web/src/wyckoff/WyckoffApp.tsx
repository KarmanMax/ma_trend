import { defaultWyckoffStrategyConfig, type WyckoffStrategyConfig } from "@trend-trade/shared";
import { useEffect, useMemo, useState } from "react";
import { createWyckoffBacktest, getWyckoffScan, startWyckoffScan, type WyckoffBacktestResult, type WyckoffScanJob } from "./api";
import { WyckoffChart } from "./WyckoffChart";

const defaultEndTime = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
const defaultStartTime = new Date(Date.parse(defaultEndTime) - 2 * 365 * 86_400_000).toISOString();

type NumericParameterKey = Exclude<keyof WyckoffStrategyConfig, "type" | "sosLpsEnabled" | "springEnabled" | "utadEnabled">;

const parameterFields: Array<{ key: NumericParameterKey; label: string; step?: string }> = [
  { key: "rangeBars", label: "Range bars" },
  { key: "maxRangeWidthPct", label: "Max range width", step: "0.01" },
  { key: "sosBreakoutPct", label: "SOS breakout", step: "0.005" },
  { key: "sosVolumeMultiplier", label: "SOS volume multiple", step: "0.1" },
  { key: "sosCloseLocationMin", label: "SOS close location", step: "0.05" },
  { key: "lpsMinBars", label: "Min LPS wait bars" },
  { key: "lpsMaxBars", label: "Max LPS wait bars" },
  { key: "lpsTolerancePct", label: "LPS tolerance", step: "0.005" },
  { key: "lpsMaxVolumeRatio", label: "Max LPS/SOS volume", step: "0.05" },
  { key: "springPenetrationPct", label: "Spring support break", step: "0.005" },
  { key: "utadPenetrationPct", label: "UTAD resistance break", step: "0.005" },
  { key: "trapReentryMaxBars", label: "Trap reentry days" },
  { key: "invalidationPct", label: "Invalidation beyond setup extreme", step: "0.005" }
];

export function WyckoffApp() {
  const [strategy, setStrategy] = useState<WyckoffStrategyConfig>({ ...defaultWyckoffStrategyConfig });
  const [symbol, setSymbol] = useState("BTC");
  const [startTime, setStartTime] = useState(defaultStartTime);
  const [endTime, setEndTime] = useState(defaultEndTime);
  const [initialCapital, setInitialCapital] = useState(10_000);
  const [feeRate, setFeeRate] = useState(0.001);
  const [slippageRate, setSlippageRate] = useState(0.0005);
  const [backtest, setBacktest] = useState<WyckoffBacktestResult | null>(null);
  const [backtestBusy, setBacktestBusy] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  const [scanJob, setScanJob] = useState<WyckoffScanJob | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanFilter, setScanFilter] = useState("ALL");

  useEffect(() => {
    if (!scanId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const job = await getWyckoffScan(scanId);
        if (cancelled) return;
        setScanJob(job);
        if (job.status === "RUNNING") timer = setTimeout(() => void poll(), 2000);
      } catch (error) {
        if (!cancelled) setScanError(error instanceof Error ? error.message : "Scan failed");
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scanId]);

  const transitions = useMemo(() => backtest?.timeline
    .filter((point, index, all) => point.phase !== all[index - 1]?.phase || point.signal.type !== "HOLD")
    .slice(-30).reverse() ?? [], [backtest]);
  const scanResults = useMemo(() => (scanJob?.results ?? []).filter((result) => {
    if (scanFilter === "BUY") return result.signal?.type === "BUY";
    if (scanFilter === "SELL_SHORT") return result.signal?.type === "SELL_SHORT";
    if (scanFilter === "SPRING" || scanFilter === "UTAD") return result.setup === scanFilter;
    if (scanFilter === "WAITING") return result.phase?.startsWith("WAITING_") || result.phase === "SOS_DETECTED" || result.phase === "SPRING_DETECTED" || result.phase === "UTAD_DETECTED";
    if (scanFilter === "SKIPPED") return result.status !== "SCANNED";
    return true;
  }), [scanJob, scanFilter]);

  async function runBacktest() {
    setBacktestBusy(true);
    setBacktestError(null);
    try {
      setBacktest(await createWyckoffBacktest({ symbol, startTime, endTime, initialCapital, feeRate, slippageRate, strategy }));
    } catch (error) {
      setBacktestError(error instanceof Error ? error.message : "Backtest failed");
    } finally {
      setBacktestBusy(false);
    }
  }

  async function startScan() {
    setScanError(null);
    setScanJob(null);
    setScanId(null);
    try {
      const job = await startWyckoffScan(strategy);
      setScanId(job.id);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "Scan failed");
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-panel">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold">Wyckoff SOS/LPS · Spring · UTAD</h1>
            <p className="text-sm text-muted">Configurable daily-bar heuristic</p>
          </div>
          <a className="text-sm font-medium text-accent hover:underline" href="/">Trend backtest</a>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-6 py-6">
        <section className="rounded-lg border border-border bg-panel p-5 shadow-panel">
          <h2 className="text-base font-semibold">Strategy parameters</h2>
          <p className="mt-1 text-sm text-muted">Configurable first-pass heuristics. Spring and SOS/LPS emit BUY; UTAD-style range rejection emits SELL_SHORT. Signals are filled at that day's close in the simulator; spot-market candles do not provide short execution.</p>
          <div className="mt-4 flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={strategy.sosLpsEnabled} onChange={(event) => setStrategy({ ...strategy, sosLpsEnabled: event.target.checked })} />SOS → LPS long</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={strategy.springEnabled} onChange={(event) => setStrategy({ ...strategy, springEnabled: event.target.checked })} />Spring long</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={strategy.utadEnabled} onChange={(event) => setStrategy({ ...strategy, utadEnabled: event.target.checked })} />UTAD short</label>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {parameterFields.map((field) => (
              <label className="grid gap-1 text-sm" key={field.key}>
                <span>{field.label}</span>
                <input className="input" type="number" step={field.step ?? "1"} value={strategy[field.key]}
                  onChange={(event) => setStrategy({ ...strategy, [field.key]: Number(event.target.value) })} />
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-panel p-5 shadow-panel">
          <h2 className="text-base font-semibold">Historical backtest</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="Binance symbol"><input className="input" value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} /></Field>
            <Field label="Start"><input className="input" type="date" value={startTime.slice(0, 10)} onChange={(event) => setStartTime(`${event.target.value}T00:00:00.000Z`)} /></Field>
            <Field label="End"><input className="input" type="date" value={endTime.slice(0, 10)} onChange={(event) => setEndTime(`${event.target.value}T00:00:00.000Z`)} /></Field>
            <Field label="Capital"><input className="input" type="number" value={initialCapital} onChange={(event) => setInitialCapital(Number(event.target.value))} /></Field>
            <Field label="Fee rate"><input className="input" type="number" step="0.0001" value={feeRate} onChange={(event) => setFeeRate(Number(event.target.value))} /></Field>
            <Field label="Slippage rate"><input className="input" type="number" step="0.0001" value={slippageRate} onChange={(event) => setSlippageRate(Number(event.target.value))} /></Field>
          </div>
          <button className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60" disabled={backtestBusy} onClick={() => void runBacktest()}>
            {backtestBusy ? "Running…" : "Run backtest"}
          </button>
          {backtestError && <p className="mt-3 text-sm text-negative">{backtestError}</p>}
          {backtest && (
            <div className="mt-5">
              <div className="grid gap-3 sm:grid-cols-4">
                <Metric label="Total return" value={percent(backtest.metrics.totalReturn)} />
                <Metric label="Max drawdown" value={percent(backtest.metrics.maxDrawdown)} />
                <Metric label="Trades" value={String(backtest.metrics.tradeCount)} />
                <Metric label="Daily bars" value={String(backtest.chartPoints.length)} />
              </div>
              <WyckoffChart result={backtest} />
              <h3 className="mt-5 font-medium">Recent state transitions</h3>
              <div className="mt-2 max-h-72 overflow-auto rounded-md border border-border">
                <table className="w-full text-left text-sm"><thead className="bg-background"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Phase</th><th className="px-3 py-2">Signal</th><th className="px-3 py-2">Reason</th></tr></thead>
                  <tbody>{transitions.map((point) => <tr className="border-t border-border" key={point.time}><td className="px-3 py-2">{date(point.time)}</td><td className="px-3 py-2">{point.phase}</td><td className="px-3 py-2">{point.signal.type}</td><td className="px-3 py-2">{point.signal.reason ?? "—"}</td></tr>)}</tbody>
                </table>
              </div>
              <h3 className="mt-5 font-medium">Filled operations</h3>
              <div className="mt-2 max-h-72 overflow-auto rounded-md border border-border">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-background"><tr><th className="px-3 py-2">Side</th><th className="px-3 py-2">Entry</th><th className="px-3 py-2">Entry price</th><th className="px-3 py-2">Exit</th><th className="px-3 py-2">Exit price</th><th className="px-3 py-2">Net P&amp;L</th><th className="px-3 py-2">Exit reason</th></tr></thead>
                  <tbody>
                    {backtest.trades.map((trade) => <tr className="border-t border-border" key={trade.id}>
                      <td className="px-3 py-2">{trade.side}</td><td className="px-3 py-2">{date(trade.entryTime)}</td><td className="px-3 py-2">{formatPrice(trade.entryPrice)}</td>
                      <td className="px-3 py-2">{trade.exitTime ? date(trade.exitTime) : "—"}</td><td className="px-3 py-2">{formatPrice(trade.exitPrice)}</td>
                      <td className="px-3 py-2">{trade.netPnl?.toFixed(2) ?? "—"}</td><td className="px-3 py-2">{trade.exitReason ?? "—"}</td>
                    </tr>)}
                    {backtest.trades.length === 0 && <tr className="border-t border-border"><td className="px-3 py-5 text-muted" colSpan={7}>No filled operations in this period.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-panel p-5 shadow-panel">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-base font-semibold">Crypto market-cap Top300 scan</h2><p className="mt-1 text-sm text-muted">Manual scan of completed Binance USDT daily bars. Unavailable assets remain visible with reasons.</p></div>
            <button className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60" disabled={scanJob?.status === "RUNNING"} onClick={() => void startScan()}>Run scan</button>
          </div>
          {scanError && <p className="mt-3 text-sm text-negative">{scanError}</p>}
          {scanJob && <p className="mt-3 text-sm">{scanJob.status} · {scanJob.completed}/{scanJob.total} processed {scanJob.error ? `· ${scanJob.error}` : ""}</p>}
          {scanJob && <div className="mt-4 flex items-center gap-2"><span className="text-sm">Show</span><select className="input max-w-44" value={scanFilter} onChange={(event) => setScanFilter(event.target.value)}><option value="ALL">All</option><option value="BUY">BUY signals</option><option value="SELL_SHORT">SELL_SHORT signals</option><option value="SPRING">Spring setups</option><option value="UTAD">UTAD setups</option><option value="WAITING">Waiting</option><option value="SKIPPED">Skipped / error</option></select></div>}
          {scanJob && <div className="mt-3 max-h-[500px] overflow-auto rounded-md border border-border"><table className="w-full min-w-[900px] text-left text-sm"><thead className="sticky top-0 bg-background"><tr><th className="px-3 py-2">Rank</th><th className="px-3 py-2">Asset</th><th className="px-3 py-2">Pair</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Phase</th><th className="px-3 py-2">Setup</th><th className="px-3 py-2">Side</th><th className="px-3 py-2">Signal</th><th className="px-3 py-2">Reason</th></tr></thead><tbody>{scanResults.map((result) => <tr className="border-t border-border" key={result.asset.id}><td className="px-3 py-2">{result.asset.marketCapRank}</td><td className="px-3 py-2">{result.asset.name} ({result.asset.symbol})</td><td className="px-3 py-2">{result.pair ?? "—"}</td><td className="px-3 py-2">{result.status}</td><td className="px-3 py-2">{result.phase ?? "—"}</td><td className="px-3 py-2">{result.setup ?? "—"}</td><td className="px-3 py-2">{result.entrySide ?? "—"}</td><td className="px-3 py-2">{result.signal?.type ?? "—"}</td><td className="px-3 py-2">{result.reason ?? result.signal?.reason ?? "—"}</td></tr>)}</tbody></table></div>}
        </section>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-sm"><span>{label}</span>{children}</label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border p-3"><div className="text-xs text-muted">{label}</div><div className="mt-1 font-semibold">{value}</div></div>;
}

function percent(value: number): string { return `${(value * 100).toFixed(2)}%`; }
function date(value: number): string { return new Date(value).toISOString().slice(0, 10); }
function formatPrice(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value !== 0 && Math.abs(value) < 0.000001) return value.toExponential(3);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: Math.abs(value) >= 100 ? 2 : Math.abs(value) >= 1 ? 4 : 8 }).format(value);
}
