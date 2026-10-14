import { CandlestickSeries, ColorType, createChart, HistogramSeries, LineStyle, type IChartApi, type ISeriesApi, type LogicalRange, type Time } from "lightweight-charts";
import { useCallback, useEffect, useRef, useState } from "react";

export type ChartTimeframe = "1h" | "4h" | "1d" | "1w";
export type ChartSelection = {
  symbol: string;
  name: string;
  timeframe: ChartTimeframe;
  side: "support" | "resistance";
  level: number;
  zoneLow: number;
  zoneHigh: number;
};

type Candle = { openTime: number; closeTime: number; open: number; high: number; low: number; close: number; volume: number };
type CandleResponse = { symbol: string; timeframe: ChartTimeframe; candles: Candle[]; nextBefore: number | null };
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const timeframes: ChartTimeframe[] = ["1h", "4h", "1d", "1w"];

export function LevelsChart({ selection, onClose }: { selection: ChartSelection; onClose: () => void }) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>(selection.timeframe);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [olderError, setOlderError] = useState<string | null>(null);
  const candlesRef = useRef<Candle[] | null>(null);
  const loadingOlderRef = useRef(false);
  const hasMoreRef = useRef(true);
  const generationRef = useRef(0);
  const olderControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const generation = ++generationRef.current;
    const controller = new AbortController();
    olderControllerRef.current?.abort();
    candlesRef.current = null;
    loadingOlderRef.current = false;
    hasMoreRef.current = true;
    setCandles(null);
    setError(null);
    setLoadingOlder(false);
    setHasMore(true);
    setOlderError(null);
    const params = new URLSearchParams({ symbol: selection.symbol, timeframe });
    void fetch(`${API_BASE_URL}/api/levels/candles?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "K 线读取失败");
        return data as CandleResponse;
      })
      .then((data) => {
        if (generation !== generationRef.current) return;
        candlesRef.current = data.candles;
        setCandles(data.candles);
        if (!data.nextBefore) { hasMoreRef.current = false; setHasMore(false); }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "K 线读取失败");
      });
    return () => { controller.abort(); olderControllerRef.current?.abort(); generationRef.current++; };
  }, [selection.symbol, timeframe]);

  const loadOlder = useCallback(async () => {
    const current = candlesRef.current;
    if (!current?.length || loadingOlderRef.current || !hasMoreRef.current) return;
    const before = current[0].openTime;
    const generation = generationRef.current;
    const controller = new AbortController();
    olderControllerRef.current = controller;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const params = new URLSearchParams({ symbol: selection.symbol, timeframe, before: String(before) });
      const response = await fetch(`${API_BASE_URL}/api/levels/candles?${params}`, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "历史 K 线读取失败");
      if (controller.signal.aborted || generation !== generationRef.current) return;
      const older = (data as CandleResponse).candles.filter((candle) => candle.openTime < before);
      if (older.length === 0) {
        hasMoreRef.current = false;
        setHasMore(false);
        return;
      }
      const merged = new Map<number, Candle>();
      for (const candle of [...older, ...current]) merged.set(candle.openTime, candle);
      const next = [...merged.values()].sort((a, b) => a.openTime - b.openTime);
      candlesRef.current = next;
      setCandles(next);
    } catch (cause) {
      if (controller.signal.aborted || generation !== generationRef.current) return;
      hasMoreRef.current = false;
      setHasMore(false);
      setOlderError(cause instanceof Error ? cause.message : "历史 K 线读取失败");
    } finally {
      if (generation === generationRef.current) {
        loadingOlderRef.current = false;
        setLoadingOlder(false);
        olderControllerRef.current = null;
      }
    }
  }, [selection.symbol, timeframe]);

  const latest = candles?.at(-1);
  return <section className="mb-5 rounded-md border border-border bg-white p-4" aria-label={`${selection.symbol} K 线图`}>
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-semibold">{selection.symbol} · {selection.name} K 线</h3><p className="mt-1 text-xs text-muted">{timeframe === selection.timeframe ? `${selection.side === "support" ? "支撑" : "阻力"}区间上下沿及中心已标注` : `原筛选区间属于 ${selection.timeframe} 级别`}{latest ? ` · 最新收盘 ${latest.close.toLocaleString("en-US", { maximumFractionDigits: 6 })}` : ""}</p></div>
      <button type="button" className="rounded border border-border px-3 py-1 text-sm hover:bg-background" onClick={onClose}>关闭图表</button>
    </div>
    <div className="mb-3 flex flex-wrap gap-2" aria-label="切换 K 线级别">{timeframes.map((value) => <button type="button" key={value} aria-pressed={timeframe === value} className={`rounded px-3 py-1.5 text-sm ${timeframe === value ? "bg-accent text-white" : "border border-border hover:bg-background"}`} onClick={() => { setCandles(null); setTimeframe(value); }}>{value.toUpperCase()}</button>)}</div>
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {candles === null && !error && <p className="py-20 text-center text-sm text-muted">正在读取 K 线…</p>}
    {candles?.length === 0 && <p className="py-20 text-center text-sm text-muted">当前级别没有可用的已完成 K 线。</p>}
    {!!candles?.length && <CandleCanvas key={timeframe} candles={candles} timeframe={timeframe} selection={selection} onNearLeft={() => void loadOlder()} />}
    {!!candles?.length && <p className="mt-2 text-xs text-muted">共 {candles.length} 根已完成 K 线 · 可拖动或滚轮缩放，接近左侧边界时自动加载更早数据。{loadingOlder ? "正在加载更早 K 线…" : !hasMore && !olderError ? "已无更早数据。" : ""}</p>}
    {olderError && <p role="alert" className="mt-2 text-xs text-red-700">历史数据加载失败：{olderError} <button type="button" className="font-medium underline" onClick={() => { hasMoreRef.current = true; setHasMore(true); void loadOlder(); }}>重试</button></p>}
  </section>;
}

type ChartState = {
  chart: IChartApi;
  candleSeries: ISeriesApi<"Candlestick">;
  volumeSeries: ISeriesApi<"Histogram">;
};

function CandleCanvas({ candles, timeframe, selection, onNearLeft }: {
  candles: Candle[];
  timeframe: ChartTimeframe;
  selection: ChartSelection;
  onNearLeft: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartState | null>(null);
  const firstTimeRef = useRef<number | null>(null);
  const userInteractedRef = useRef(false);
  const onNearLeftRef = useRef(onNearLeft);
  onNearLeftRef.current = onNearLeft;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 440,
      layout: { background: { type: ColorType.Solid, color: "#fbfcff" }, textColor: "#475467" },
      grid: { vertLines: { color: "#eef2f7" }, horzLines: { color: "#eef2f7" } },
      rightPriceScale: { borderColor: "#d9dfeb", scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderColor: "#d9dfeb", timeVisible: timeframe === "1h" || timeframe === "4h", secondsVisible: false },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true }
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#047857", downColor: "#b42318", wickUpColor: "#047857", wickDownColor: "#b42318", borderVisible: false
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    candleSeries.setData(toCandlestickData(candles));
    volumeSeries.setData(toVolumeData(candles));
    if (timeframe === selection.timeframe) {
      const sideLabel = selection.side === "support" ? "支撑" : "阻力";
      const color = selection.side === "support" ? "#0284c7" : "#d97706";
      candleSeries.createPriceLine({
        price: selection.zoneLow,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${sideLabel}下沿`
      });
      candleSeries.createPriceLine({
        price: selection.zoneHigh,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${sideLabel}上沿`
      });
      candleSeries.createPriceLine({
        price: selection.level,
        color,
        lineWidth: 2,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: `${sideLabel}中心`
      });
    }
    firstTimeRef.current = candles[0].openTime;
    chartRef.current = { chart, candleSeries, volumeSeries };
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - 55), to: candles.length + 4 });
    const armHistoryLoading = () => { userInteractedRef.current = true; };
    container.addEventListener("wheel", armHistoryLoading, { passive: true });
    container.addEventListener("pointerdown", armHistoryLoading);
    container.addEventListener("touchstart", armHistoryLoading, { passive: true });
    const onRangeChange = (range: LogicalRange | null) => {
      if (userInteractedRef.current && range && (candleSeries.barsInLogicalRange(range)?.barsBefore ?? Infinity) < 20) {
        userInteractedRef.current = false;
        onNearLeftRef.current();
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);
    const resizeObserver = new ResizeObserver(() => chart.applyOptions({ width: container.clientWidth }));
    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
      container.removeEventListener("wheel", armHistoryLoading);
      container.removeEventListener("pointerdown", armHistoryLoading);
      container.removeEventListener("touchstart", armHistoryLoading);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const state = chartRef.current;
    const firstTime = firstTimeRef.current;
    if (!state || firstTime === null || candles[0].openTime === firstTime) return;
    const added = candles.filter((candle) => candle.openTime < firstTime).length;
    const visible = state.chart.timeScale().getVisibleRange();
    const logical = state.chart.timeScale().getVisibleLogicalRange();
    state.candleSeries.setData(toCandlestickData(candles));
    state.volumeSeries.setData(toVolumeData(candles));
    firstTimeRef.current = candles[0].openTime;
    if (visible) {
      const revealOlder = added > 0 && logical !== null && logical.from < 20;
      const from = revealOlder
        ? Math.floor(candles[Math.max(0, added - 20)].openTime / 1000) as Time
        : visible.from;
      state.chart.timeScale().setVisibleRange({ from, to: visible.to });
    }
  }, [candles]);

  return <div ref={containerRef} className="w-full" />;
}

function toCandlestickData(candles: Candle[]) {
  return candles.map((candle) => ({
    time: Math.floor(candle.openTime / 1000) as Time,
    open: candle.open, high: candle.high, low: candle.low, close: candle.close
  }));
}

function toVolumeData(candles: Candle[]) {
  return candles.map((candle) => ({
    time: Math.floor(candle.openTime / 1000) as Time,
    value: candle.volume,
    color: candle.close >= candle.open ? "rgba(4, 120, 87, 0.35)" : "rgba(180, 35, 24, 0.35)"
  }));
}
