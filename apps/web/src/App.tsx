import { beijingUtcOffsetHours, defaultDailyCandleStartHour, legacyDailyCandleStartHour, supportsDailyCandleStart, type BacktestConfig, type SymbolCode, type Timeframe } from "@trend-trade/shared";
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
import { Activity, BarChart3, History } from "lucide-react";
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
import { formatCurrency, formatDailyCandleStartHour, formatDateTime, formatNumber, formatPercent } from "./lib/format";
import { BacktestForm, defaultMaStrategy } from "./components/BacktestForm";


const defaultConfig: BacktestConfig = {
  symbol: "BTC",
  timeframe: "1d",
  startTime: defaultStartTime(),
  endTime: defaultEndTime(),
  initialCapital: 10000,
  feeRate: 0.001,
  slippageRate: 0.0005,
  strategy: defaultMaStrategy
};


function defaultEndTime(): string {
  const end = new Date(Date.now() + beijingUtcOffsetHours * 3_600_000);
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
  "8h": "8H",
  "12h": "12H",
  "1d": "1D",
  "1w": "1W"
};

const symbolLabels: Record<SymbolCode, string> = {
  AAPL: "Apple (AAPL)",
  MSFT: "Microsoft (MSFT)",
  NVDA: "NVIDIA (NVDA)",
  AMZN: "Amazon (AMZN)",
  GOOGL: "Alphabet (GOOGL)",
  META: "Meta (META)",
  "BRK-B": "Berkshire Hathaway (BRK-B)",
  JPM: "JPMorgan Chase (JPM)",
  V: "Visa (V)",
  MA: "Mastercard (MA)",
  WMT: "Walmart (WMT)",
  COST: "Costco (COST)",
  UNH: "UnitedHealth (UNH)",
  XOM: "Exxon Mobil (XOM)",
  BTC: "BTC",
  ETH: "ETH",
  SOL: "SOL",
  BNB: "BNB",
  XRP: "XRP",
  ADA: "ADA",
  DOGE: "DOGE",
  AVAX: "AVAX",
  ENA: "ENA",
  SUI: "SUI",
  UNI: "UNI",
  AAVE: "AAVE",
  LINK: "LINK",
  ONDO: "ONDO",
  HYPE: "HYPE",
  VVV: "VVV",
  NEAR: "NEAR",
  MORPHO: "MORPHO",
  RAY: "RAY",
  JUP: "JUP",
  KMNO: "KMNO",
  CAKE: "CAKE",
  LDO: "LDO",
  SKHYNIX: "SK hynix",
  MU: "Micron (MU)",
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
  ASML: "ASML",
  QCOM: "Qualcomm (QCOM)",
  TXN: "Texas Instruments (TXN)",
  AMAT: "Applied Materials (AMAT)",
  LRCX: "Lam Research (LRCX)",
  KLAC: "KLA (KLAC)",
  ADI: "Analog Devices (ADI)",
  NXPI: "NXP Semiconductors (NXPI)",
  MCHP: "Microchip Technology (MCHP)",
  ON: "ON Semiconductor (ON)",
  MPWR: "Monolithic Power Systems (MPWR)",
  TER: "Teradyne (TER)",
  XIAOMI: "Xiaomi (01810.HK)",
  BABA: "BABA",
  BIDU: "BIDU",
  "00700": "Tencent (00700.HK)",
  "03690": "Meituan (03690.HK)",
  JD: "JD",
  BILI: "BILI",
  PDD: "PDD",
  TSM: "TSM",
  TCOM: "TCOM",
  FUTU: "FUTU",
  PONY: "PONY",
  QQQ: "QQQ",
  SPY: "SPY",
  VGT: "VGT",
  SMH: "SMH",
  SOXX: "SOXX",
  IGV: "IGV",
  XBI: "XBI",
  DRAM: "DRAM",
  LYTE: "LYTE"
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
      const dailyCandleStartHour = supportsDailyCandleStart(form.symbol, form.timeframe)
        ? form.dailyCandleStartHour ?? defaultDailyCandleStartHour
        : undefined;
      // Date inputs store the selected calendar day at UTC midnight. Submit the actual candle boundary.
      const offset = dailyCandleStartHour === undefined ? 0 : (dailyCandleStartHour - beijingUtcOffsetHours) * 3_600_000;
      const backtest = await createBacktest({
        ...form,
        dailyCandleStartHour,
        startTime: new Date(Date.parse(form.startTime) + offset).toISOString(),
        endTime: new Date(Date.parse(form.endTime) + offset).toISOString()
      });
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
        <div className="mx-auto flex max-w-[120rem] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-xl font-semibold tracking-normal">Trend Trade</h1>
            <p className="text-sm text-muted">Multi-asset trend backtesting workstation</p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <a className="whitespace-nowrap text-sm font-medium text-accent hover:underline" href="/levels/">支撑/阻力扫描</a>
            <a className="whitespace-nowrap text-sm font-medium text-accent hover:underline" href="/wyckoff/">Wyckoff workspace</a>
            <div className="hidden items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted sm:flex">
              <Activity size={16} />
              MVP Backtest Engine
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[120rem] grid-cols-1 items-start gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <BacktestForm config={form} onChange={setForm} onSubmit={() => void runBacktest()} loading={loading} error={error}
          symbolLabels={symbolLabels} timeframeLabels={timeframeLabels} />

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
    const trendEmaSeries = chart.addSeries(LineSeries, {
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

    let macdLineSeries: ReturnType<typeof chart.addSeries> | null = null;
    let macdSignalSeries: ReturnType<typeof chart.addSeries> | null = null;
    let macdHistogramSeries: ReturnType<typeof chart.addSeries> | null = null;
    if (result.config.strategy.type === "MACD_TREND" || result.config.strategy.type === "MACD_MOMENTUM") {
      macdLineSeries = chart.addSeries(LineSeries, {
        color: "#2563eb",
        lineWidth: 2,
        priceScaleId: "macd",
        priceLineVisible: false,
        lastValueVisible: false
      }, 1);
      macdSignalSeries = chart.addSeries(LineSeries, {
        color: "#f59e0b",
        lineWidth: 2,
        priceScaleId: "macd",
        priceLineVisible: false,
        lastValueVisible: false
      }, 1);
      macdHistogramSeries = chart.addSeries(HistogramSeries, {
        color: "#98a2b3",
        priceScaleId: "macd",
        priceFormat: { type: "price", precision: 4, minMove: 0.0001 },
        priceLineVisible: false,
        lastValueVisible: false
      }, 1);
      chart.panes()[1]?.setHeight(150);
    }

    const candles = result.chartPoints.map((point) => ({
      time: toChartTime(point.time),
      open: point.open,
      high: point.high,
      low: point.low,
      close: point.close
    }));
    const trendEma = result.chartPoints
      .filter((point) => typeof point.trendEma === "number")
      .map((point) => ({ time: toChartTime(point.time), value: point.trendEma as number }));
    const volumes = result.chartPoints.map((point) => ({
      time: toChartTime(point.time),
      value: point.volume,
      color: point.close >= point.open ? "rgba(4, 120, 87, 0.35)" : "rgba(180, 35, 24, 0.35)"
    }));

    candleSeries.setData(candles);
    trendEmaSeries.setData(trendEma);
    volumeSeries.setData(volumes);

    if (macdLineSeries && macdSignalSeries && macdHistogramSeries) {
      const macdPoints = result.chartPoints.filter((point) =>
        typeof point.macdLine === "number" || typeof point.macdSignal === "number" || typeof point.macdHistogram === "number"
      );
      macdLineSeries.setData(macdPoints.filter((point) => typeof point.macdLine === "number").map((point) => ({
        time: toChartTime(point.time), value: point.macdLine as number
      })));
      macdSignalSeries.setData(macdPoints.filter((point) => typeof point.macdSignal === "number").map((point) => ({
        time: toChartTime(point.time), value: point.macdSignal as number
      })));
      macdHistogramSeries.setData(macdPoints.filter((point) => typeof point.macdHistogram === "number").map((point) => ({
        time: toChartTime(point.time), value: point.macdHistogram as number,
        color: (point.macdHistogram as number) >= 0 ? "rgba(4, 120, 87, 0.55)" : "rgba(180, 35, 24, 0.55)"
      })));
    }

    const candleCloseTimes = result.chartPoints.map((point) => Date.parse(point.time));
    const markerTime = (value: string): Time => {
      const fillTime = Date.parse(value);
      // The price series is keyed by close time, including for trades filled at the open.
      let left = 0;
      let right = candleCloseTimes.length - 1;
      while (left < right) {
        const middle = Math.floor((left + right) / 2);
        if (candleCloseTimes[middle] < fillTime) left = middle + 1;
        else right = middle;
      }
      return candles[left].time;
    };
    createSeriesMarkers(
      candleSeries,
      result.trades.flatMap((trade) => {
        const markers = [
          {
            time: markerTime(trade.entryTime),
            position: trade.side === "SHORT" ? "aboveBar" as const : "belowBar" as const,
            color: trade.side === "SHORT" ? "#b42318" : "#047857",
            shape: trade.side === "SHORT" ? "arrowDown" as const : "arrowUp" as const,
            text: trade.side === "SHORT" ? "Short" : "Buy"
          }
        ];

        if (trade.exitTime) {
          markers.push({
            time: markerTime(trade.exitTime),
            position: trade.side === "SHORT" ? "belowBar" as const : "aboveBar" as const,
            color: "#667085",
            shape: trade.side === "SHORT" ? "arrowUp" as const : "arrowDown" as const,
            text: trade.side === "SHORT" ? "Cover" : "Sell"
          });
        }

        return markers;
      }).sort((left, right) => Number(left.time) - Number(right.time))
    );

    chart.timeScale().fitContent();
    const range = candles.length > 180 ? { from: candles.length - 180, to: candles.length - 1 } : undefined;
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
        {supportsDailyCandleStart(result.config.symbol, result.config.timeframe) && (
          <span>Daily candle start {formatDailyCandleStartHour(result.config.dailyCandleStartHour ?? legacyDailyCandleStartHour)} UTC+8</span>
        )}
        {result.config.strategy.type === "EMA_TREND" ? <span className="inline-flex items-center gap-1"><span className="h-0.5 w-5 bg-[#9333ea]" /> {result.config.strategy.trendMaType ?? "EMA"} {result.config.strategy.trendEmaPeriod}</span> : null}
        <span className="inline-flex items-center gap-1"><span className="h-2 w-4 bg-[#98a2b3]" /> Volume</span>
        {result.config.strategy.type === "MACD_TREND" || result.config.strategy.type === "MACD_MOMENTUM" ? <>
          <span className="inline-flex items-center gap-1"><span className="h-0.5 w-5 bg-[#2563eb]" /> MACD</span>
          <span className="inline-flex items-center gap-1"><span className="h-0.5 w-5 bg-[#f59e0b]" /> Signal</span>
        </> : null}
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
                {supportsDailyCandleStart(run.symbol, run.timeframe) && (
                  <span className="ml-2 text-xs font-normal text-muted">
                    {formatDailyCandleStartHour(run.dailyCandleStartHour ?? legacyDailyCandleStartHour)} UTC+8
                  </span>
                )}
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
