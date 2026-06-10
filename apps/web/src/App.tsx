import { supportedTimeframes, type BacktestConfig, type Timeframe } from "@trend-trade/shared";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type Time
} from "lightweight-charts";
import { Activity, BarChart3, History, Play, Settings2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { createBacktest, getBacktest, listBacktests, type ApiBacktestDetail, type ApiBacktestRun } from "./lib/api";
import { formatCurrency, formatDateTime, formatNumber, formatPercent } from "./lib/format";

const defaultConfig: BacktestConfig = {
  symbol: "ETHUSDT",
  timeframe: "1h",
  startTime: defaultStartTime(),
  endTime: defaultEndTime(),
  initialCapital: 10000,
  feeRate: 0.001,
  slippageRate: 0.0005,
  strategy: {
    type: "EMA_TREND",
    emaFast: 50,
    emaSlow: 200,
    atrPeriod: 14,
    atrMultiplier: 2,
    atrStopEnabled: true,
    adxPeriod: 14,
    adxThreshold: 20,
    adxFilterEnabled: true,
    volumeMaPeriod: 20,
    volumeMultiplier: 1,
    volumeFilterEnabled: true,
    direction: "LONG_SHORT",
    exitTrigger: "EMA"
  }
};

function defaultEndTime(): string {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  return end.toISOString();
}

function defaultStartTime(): string {
  const start = new Date(defaultEndTime());
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  return start.toISOString();
}

const timeframeLabels: Record<Timeframe, string> = {
  "1m": "1M",
  "2m": "2M",
  "5m": "5M",
  "15m": "15M",
  "30m": "30M",
  "1h": "1H",
  "2h": "2H",
  "4h": "4H",
  "1d": "1D"
};

export function App() {
  const [form, setForm] = useState(defaultConfig);
  const [result, setResult] = useState<ApiBacktestDetail | null>(null);
  const [runs, setRuns] = useState<ApiBacktestRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshRuns();
  }, []);

  async function refreshRuns() {
    const backtests = await listBacktests();
    setRuns(backtests);
  }

  async function runBacktest() {
    setLoading(true);
    setError(null);
    try {
      const backtest = await createBacktest(form);
      setResult(backtest);
      await refreshRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backtest failed");
    } finally {
      setLoading(false);
    }
  }

  async function selectRun(id: string) {
    setLoading(true);
    setError(null);
    try {
      setResult(await getBacktest(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load backtest");
    } finally {
      setLoading(false);
    }
  }

  const equityData = useMemo(
    () =>
      result?.equityCurve.map((point) => ({
        time: new Date(point.time).toLocaleDateString(),
        equity: Number(point.equity.toFixed(2))
      })) ?? [],
    [result]
  );

  const drawdownData = useMemo(
    () =>
      result?.drawdownCurve.map((point) => ({
        time: new Date(point.time).toLocaleDateString(),
        drawdown: Number((point.drawdown * 100).toFixed(2))
      })) ?? [],
    [result]
  );

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-panel">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-normal">Trend Trade</h1>
            <p className="text-sm text-muted">ETHUSDT EMA trend backtesting workstation</p>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted">
            <Activity size={16} />
            MVP Backtest Engine
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 px-6 py-6 lg:grid-cols-[360px_1fr]">
        <section className="rounded-lg border border-border bg-panel p-4 shadow-panel">
          <div className="mb-4 flex items-center gap-2">
            <Settings2 size={18} />
            <h2 className="text-base font-semibold">Parameters</h2>
          </div>
          <div className="grid gap-4">
            <Field label="Symbol">
              <select className="input" value={form.symbol} disabled>
                <option value="ETHUSDT">ETHUSDT</option>
              </select>
            </Field>
            <Field label="Timeframe">
              <select
                className="input"
                value={form.timeframe}
                onChange={(event) => setForm({ ...form, timeframe: event.target.value as Timeframe })}
              >
                {supportedTimeframes.map((timeframe) => (
                  <option key={timeframe} value={timeframe}>
                    {timeframeLabels[timeframe]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Start">
              <input
                className="input"
                type="date"
                value={form.startTime.slice(0, 10)}
                onChange={(event) => setForm({ ...form, startTime: `${event.target.value}T00:00:00.000Z` })}
              />
            </Field>
            <Field label="End">
              <input
                className="input"
                type="date"
                value={form.endTime.slice(0, 10)}
                onChange={(event) => setForm({ ...form, endTime: `${event.target.value}T00:00:00.000Z` })}
              />
            </Field>
            <NumberField label="Initial Capital" value={form.initialCapital} onChange={(value) => setForm({ ...form, initialCapital: value })} />
            <NumberField label="Fee Rate" step="0.0001" value={form.feeRate} onChange={(value) => setForm({ ...form, feeRate: value })} />
            <NumberField
              label="Slippage Rate"
              step="0.0001"
              value={form.slippageRate}
              onChange={(value) => setForm({ ...form, slippageRate: value })}
            />
            <div className="rounded-md border border-border p-3">
              <div className="mb-3 text-sm font-medium">EMA Trend Strategy</div>
              <div className="mb-3">
                <Field label="Direction">
                  <select
                    className="input"
                    value={form.strategy.direction}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        strategy: {
                          ...form.strategy,
                          direction: event.target.value as typeof form.strategy.direction
                        }
                      })
                    }
                  >
                    <option value="LONG_SHORT">Long & Short</option>
                    <option value="LONG_ONLY">Long Only</option>
                    <option value="SHORT_ONLY">Short Only</option>
                  </select>
                </Field>
              </div>
              <div className="mb-3">
                <Field label="Exit Trigger">
                  <select
                    className="input"
                    value={form.strategy.exitTrigger}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        strategy: {
                          ...form.strategy,
                          exitTrigger: event.target.value as typeof form.strategy.exitTrigger
                        }
                      })
                    }
                  >
                    <option value="EMA">EMA reverse signal</option>
                    <option value="NONE">None</option>
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumberField compact label="EMA Fast" value={form.strategy.emaFast} onChange={(value) => setForm({ ...form, strategy: { ...form.strategy, emaFast: value } })} />
                <NumberField compact label="EMA Slow" value={form.strategy.emaSlow} onChange={(value) => setForm({ ...form, strategy: { ...form.strategy, emaSlow: value } })} />
                <CheckboxField
                  label="ATR Stop"
                  checked={form.strategy.atrStopEnabled}
                  onChange={(value) => setForm({ ...form, strategy: { ...form.strategy, atrStopEnabled: value } })}
                />
                <NumberField compact label="ATR Period" value={form.strategy.atrPeriod} onChange={(value) => setForm({ ...form, strategy: { ...form.strategy, atrPeriod: value } })} />
                <NumberField
                  compact
                  label="ATR Multiplier"
                  value={form.strategy.atrMultiplier}
                  onChange={(value) => setForm({ ...form, strategy: { ...form.strategy, atrMultiplier: value } })}
                />
                <CheckboxField
                  label="ADX Filter"
                  checked={form.strategy.adxFilterEnabled}
                  onChange={(value) => setForm({ ...form, strategy: { ...form.strategy, adxFilterEnabled: value } })}
                />
                <NumberField compact label="ADX Period" value={form.strategy.adxPeriod} onChange={(value) => setForm({ ...form, strategy: { ...form.strategy, adxPeriod: value } })} />
                <NumberField compact label="ADX Threshold" value={form.strategy.adxThreshold} onChange={(value) => setForm({ ...form, strategy: { ...form.strategy, adxThreshold: value } })} />
                <CheckboxField
                  label="Volume Filter"
                  checked={form.strategy.volumeFilterEnabled}
                  onChange={(value) => setForm({ ...form, strategy: { ...form.strategy, volumeFilterEnabled: value } })}
                />
                <NumberField compact label="Volume MA" value={form.strategy.volumeMaPeriod} onChange={(value) => setForm({ ...form, strategy: { ...form.strategy, volumeMaPeriod: value } })} />
                <NumberField
                  compact
                  label="Volume Mult"
                  step="0.1"
                  value={form.strategy.volumeMultiplier}
                  onChange={(value) => setForm({ ...form, strategy: { ...form.strategy, volumeMultiplier: value } })}
                />
              </div>
            </div>
            <button
              className="flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white disabled:opacity-60"
              disabled={loading}
              onClick={() => void runBacktest()}
            >
              <Play size={16} />
              {loading ? "Running" : "Run Backtest"}
            </button>
            {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-negative">{error}</div> : null}
          </div>
        </section>

        <section className="grid gap-5">
          <MetricsPanel result={result} />

          <CandlestickChart result={result} />

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <ChartPanel title="Equity Curve" icon={<BarChart3 size={18} />}>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={equityData}>
                  <CartesianGrid stroke="#e7ebf3" />
                  <XAxis dataKey="time" minTickGap={32} />
                  <YAxis width={72} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Area type="monotone" dataKey="equity" stroke="#2563eb" fill="#bfdbfe" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartPanel>
            <ChartPanel title="Drawdown Curve" icon={<BarChart3 size={18} />}>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={drawdownData}>
                  <CartesianGrid stroke="#e7ebf3" />
                  <XAxis dataKey="time" minTickGap={32} />
                  <YAxis width={56} />
                  <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
                  <Line type="monotone" dataKey="drawdown" stroke="#b42318" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartPanel>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
            <TradeTable result={result} />
            <RunHistory runs={runs} onSelect={(id) => void selectRun(id)} />
          </div>
        </section>
      </div>
    </main>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{props.label}</span>
      {props.children}
    </label>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: string;
  compact?: boolean;
}) {
  return (
    <Field label={props.label}>
      <input
        className="input"
        type="number"
        step={props.step ?? "1"}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </Field>
  );
}

function CheckboxField(props: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-md border border-border bg-white px-3 text-sm">
      <input
        type="checkbox"
        className="h-4 w-4 accent-accent"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span className="font-medium">{props.label}</span>
    </label>
  );
}

function MetricsPanel({ result }: { result: ApiBacktestDetail | null }) {
  const metrics = result?.metrics;
  const cards = [
    ["Total Return", formatPercent(metrics?.totalReturn)],
    ["CAGR", formatPercent(metrics?.cagr)],
    ["Max Drawdown", formatPercent(metrics?.maxDrawdown)],
    ["Sharpe", formatNumber(metrics?.sharpeRatio)],
    ["Win Rate", formatPercent(metrics?.winRate)],
    ["Profit Factor", formatNumber(metrics?.profitFactor)],
    ["Trades", metrics?.tradeCount?.toString() ?? "-"]
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      {cards.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border bg-panel p-3 shadow-panel">
          <div className="text-xs text-muted">{label}</div>
          <div className="mt-2 text-lg font-semibold">{value}</div>
        </div>
      ))}
    </div>
  );
}

function ChartPanel(props: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4 shadow-panel">
      <div className="mb-4 flex items-center gap-2">
        {props.icon}
        <h2 className="text-base font-semibold">{props.title}</h2>
      </div>
      {props.children}
    </div>
  );
}

function CandlestickChart({ result }: { result: ApiBacktestDetail | null }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !result?.chartPoints.length) {
      return;
    }

    container.replaceChildren();

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 420,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#fbfcff" },
        textColor: "#475467",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
      },
      grid: {
        vertLines: { color: "#eef2f7" },
        horzLines: { color: "#eef2f7" }
      },
      crosshair: {
        mode: 1
      },
      rightPriceScale: {
        borderColor: "#d9dfeb",
        scaleMargins: { top: 0.08, bottom: 0.16 }
      },
      timeScale: {
        borderColor: "#d9dfeb",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 8
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true
      }
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#047857",
      downColor: "#b42318",
      wickUpColor: "#047857",
      wickDownColor: "#b42318",
      borderVisible: false
    });
    const emaFastSeries = chart.addSeries(LineSeries, {
      color: "#2563eb",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false
    });
    const emaSlowSeries = chart.addSeries(LineSeries, {
      color: "#9333ea",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "#98a2b3",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      priceLineVisible: false,
      lastValueVisible: false
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.78,
        bottom: 0
      }
    });

    const candles = result.chartPoints.map((point) => ({
      time: toChartTime(point.time),
      open: point.open,
      high: point.high,
      low: point.low,
      close: point.close
    }));
    const emaFast = result.chartPoints
      .filter((point) => typeof point.emaFast === "number")
      .map((point) => ({ time: toChartTime(point.time), value: point.emaFast as number }));
    const emaSlow = result.chartPoints
      .filter((point) => typeof point.emaSlow === "number")
      .map((point) => ({ time: toChartTime(point.time), value: point.emaSlow as number }));
    const volumes = result.chartPoints.map((point) => ({
      time: toChartTime(point.time),
      value: point.volume,
      color: point.close >= point.open ? "rgba(4, 120, 87, 0.35)" : "rgba(180, 35, 24, 0.35)"
    }));

    candleSeries.setData(candles);
    emaFastSeries.setData(emaFast);
    emaSlowSeries.setData(emaSlow);
    volumeSeries.setData(volumes);

    createSeriesMarkers(
      candleSeries,
      result.trades.flatMap((trade) => {
        const markers = [
          {
            time: toChartTime(trade.entryTime),
            position: trade.side === "SHORT" ? "aboveBar" as const : "belowBar" as const,
            color: trade.side === "SHORT" ? "#b42318" : "#047857",
            shape: trade.side === "SHORT" ? "arrowDown" as const : "arrowUp" as const,
            text: trade.side === "SHORT" ? "Short" : "Buy"
          }
        ];

        if (trade.exitTime) {
          markers.push({
            time: toChartTime(trade.exitTime),
            position: trade.side === "SHORT" ? "belowBar" as const : "aboveBar" as const,
            color: "#667085",
            shape: trade.side === "SHORT" ? "arrowUp" as const : "arrowDown" as const,
            text: trade.side === "SHORT" ? "Cover" : "Sell"
          });
        }

        return markers;
      })
    );

    chart.timeScale().fitContent();
    const range = candles.length > 180 ? { from: candles.length - 180, to: candles.length + 12 } : undefined;
    if (range) {
      chart.timeScale().setVisibleLogicalRange(range);
    }

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [result]);

  if (!result?.chartPoints.length) {
    return (
      <ChartPanel title="K-Line Strategy View" icon={<BarChart3 size={18} />}>
        <div className="flex h-[360px] items-center justify-center text-sm text-muted">Run or select a backtest to view candles, indicators, and trade markers</div>
      </ChartPanel>
    );
  }

  return (
    <ChartPanel title="K-Line Strategy View" icon={<BarChart3 size={18} />}>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1"><span className="h-0.5 w-5 bg-[#2563eb]" /> EMA Fast</span>
        <span className="inline-flex items-center gap-1"><span className="h-0.5 w-5 bg-[#9333ea]" /> EMA Slow</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-4 bg-[#98a2b3]" /> Volume</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-positive" /> Buy</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-negative" /> Short</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted" /> Exit</span>
      </div>
      <div className="overflow-hidden rounded-md border border-border bg-[#fbfcff]">
        <div ref={containerRef} className="h-[420px] w-full" />
      </div>
    </ChartPanel>
  );
}

function toChartTime(value: string): Time {
  return Math.floor(new Date(value).getTime() / 1000) as Time;
}

function TradeTable({ result }: { result: ApiBacktestDetail | null }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-panel shadow-panel">
      <div className="border-b border-border px-4 py-3 text-base font-semibold">Trade List</div>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="sticky top-0 bg-[#f2f5fa] text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2">Entry</th>
              <th className="px-3 py-2">Exit</th>
              <th className="px-3 py-2">Entry Price</th>
              <th className="px-3 py-2">Exit Price</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Side</th>
              <th className="px-3 py-2">Net PnL</th>
              <th className="px-3 py-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {(result?.trades ?? []).map((trade) => (
              <tr key={trade.id} className="border-t border-border">
                <td className="px-3 py-2">{formatDateTime(trade.entryTime)}</td>
                <td className="px-3 py-2">{trade.exitTime ? formatDateTime(trade.exitTime) : "-"}</td>
                <td className="px-3 py-2">{formatCurrency(trade.entryPrice)}</td>
                <td className="px-3 py-2">{formatCurrency(trade.exitPrice)}</td>
                <td className="px-3 py-2">{formatNumber(trade.quantity, 5)}</td>
                <td className="px-3 py-2">{trade.side}</td>
                <td className={`px-3 py-2 ${(trade.netPnl ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>{formatCurrency(trade.netPnl)}</td>
                <td className="px-3 py-2">{trade.exitReason ?? "-"}</td>
              </tr>
            ))}
            {!result?.trades.length ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted">
                  No trades yet
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RunHistory({ runs, onSelect }: { runs: ApiBacktestRun[]; onSelect: (id: string) => void }) {
  return (
    <div className="rounded-lg border border-border bg-panel shadow-panel">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-base font-semibold">
        <History size={18} />
        Runs
      </div>
      <div className="max-h-[360px] overflow-auto">
        {runs.map((run) => (
          <button key={run.id} className="block w-full border-b border-border px-4 py-3 text-left hover:bg-[#f2f5fa]" onClick={() => onSelect(run.id)}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">
                {run.symbol} {run.timeframe.toUpperCase()}
              </span>
              <span className="text-xs text-muted">{formatDateTime(run.createdAt)}</span>
            </div>
            <div className="mt-1 flex gap-3 text-xs text-muted">
              <span>{formatPercent(run.totalReturn)}</span>
              <span>DD {formatPercent(run.maxDrawdown)}</span>
              <span>Trades {run.tradeCount ?? "-"}</span>
            </div>
          </button>
        ))}
        {runs.length === 0 ? <div className="px-4 py-8 text-center text-sm text-muted">No saved runs</div> : null}
      </div>
    </div>
  );
}
