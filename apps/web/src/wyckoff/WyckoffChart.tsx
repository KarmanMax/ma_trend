import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  LineType,
  type IChartApi,
  type SeriesMarker,
  type Time
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import type { WyckoffBacktestResult } from "./api";

type BacktestPoint = WyckoffBacktestResult["chartPoints"][number];
type TimelinePoint = WyckoffBacktestResult["timeline"][number];

const levelLines = [
  { key: "rangeHigh", label: "Range high", color: "#d97706", style: LineStyle.Solid },
  { key: "rangeLow", label: "Range low", color: "#0284c7", style: LineStyle.Solid },
  { key: "invalidationPrice", label: "Invalidation", color: "#be123c", style: LineStyle.Dashed },
  { key: "trapExtreme", label: "Spring / UTAD extreme", color: "#7c3aed", style: LineStyle.Dotted }
] as const;

export function WyckoffChart({ result }: { result: WyckoffBacktestResult }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || result.chartPoints.length === 0) return;
    setHoveredIndex(null);
    const timelineByTime = new Map(result.timeline.map((point) => [point.time, point]));
    const indexByChartTime = new Map(result.chartPoints.map((point, index) => [Math.floor(point.time / 1000), index]));

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 490,
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
      rightPriceScale: {
        borderColor: "#d9dfeb",
        scaleMargins: { top: 0.12, bottom: 0.2 }
      },
      timeScale: {
        borderColor: "#d9dfeb",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 9
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true }
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#047857",
      downColor: "#b42318",
      wickUpColor: "#047857",
      wickDownColor: "#b42318",
      borderVisible: false
    });
    candleSeries.setData(result.chartPoints.map((point) => ({
      time: toChartTime(point.time),
      open: point.open,
      high: point.high,
      low: point.low,
      close: point.close
    })));

    for (const line of levelLines) {
      const series = chart.addSeries(LineSeries, {
        color: line.color,
        lineWidth: 1,
        lineStyle: line.style,
        lineType: LineType.WithSteps,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
      series.setData(result.chartPoints.map((point) => {
        const status = timelineByTime.get(point.time)?.status;
        const value = line.key === "trapExtreme" && status?.setup === "SOS_LPS"
          ? null
          : status?.levels?.[line.key];
        return typeof value === "number" && Number.isFinite(value)
          ? { time: toChartTime(point.time), value }
          : { time: toChartTime(point.time) };
      }));
    }

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      priceLineVisible: false,
      lastValueVisible: false
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeSeries.setData(result.chartPoints.map((point) => ({
      time: toChartTime(point.time),
      value: point.volume,
      color: point.close >= point.open ? "rgba(4, 120, 87, 0.35)" : "rgba(180, 35, 24, 0.35)"
    })));

    createSeriesMarkers(candleSeries, buildMarkers(result));
    chart.subscribeCrosshairMove((event) => {
      const index = typeof event.time === "number" ? indexByChartTime.get(event.time) : undefined;
      setHoveredIndex(index ?? null);
    });
    showRecent(chart, result.chartPoints.length);

    const resizeObserver = new ResizeObserver(() => chart.applyOptions({ width: container.clientWidth }));
    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [result]);

  const selectedIndex = hoveredIndex !== null && hoveredIndex < result.chartPoints.length
    ? hoveredIndex
    : result.chartPoints.length - 1;
  const point = result.chartPoints[selectedIndex];
  const status = result.timeline.find((item) => item.time === point?.time);
  const operations = point ? result.trades.flatMap((trade) => {
    const labels: string[] = [];
    if (trade.entryTime === point.time) labels.push(`${trade.side === "SHORT" ? "Short" : "Buy"} ${price(trade.entryPrice)}`);
    if (trade.exitTime === point.time) labels.push(`${trade.side === "SHORT" ? "Cover" : "Sell"} ${price(trade.exitPrice)}`);
    return labels;
  }) : [];

  if (result.chartPoints.length === 0) {
    return <div className="rounded-md border border-border p-8 text-center text-sm text-muted">No completed candles to chart.</div>;
  }

  return (
    <div className="mt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">K-line and strategy events</h3>
          <p className="text-xs text-muted">Drag to pan, scroll or pinch to zoom. Trade markers show simulated fill prices.</p>
        </div>
        <div className="flex gap-2 text-xs">
          <button className="rounded border border-border px-2 py-1 hover:bg-background" onClick={() => chartRef.current?.timeScale().fitContent()}>Fit all</button>
          <button className="rounded border border-border px-2 py-1 hover:bg-background" onClick={() => chartRef.current && showRecent(chartRef.current, result.chartPoints.length)}>Latest 120</button>
        </div>
      </div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {levelLines.map((line) => <span className="inline-flex items-center gap-1" key={line.key}><span className="h-0.5 w-5" style={{ backgroundColor: line.color }} />{line.label}</span>)}
        <span>● SOS / Spring / UTAD detection</span><span>↑ Buy / cover</span><span>↓ Short / sell</span>
      </div>
      <div className="overflow-hidden rounded-md border border-border bg-[#fbfcff]">
        <div ref={containerRef} className="h-[490px] w-full" aria-label="Wyckoff candlestick chart with strategy levels and trade markers" />
      </div>
      {point && <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 rounded-md border border-border bg-background px-3 py-2 text-xs">
        <span className="font-medium">{new Date(point.time).toISOString().slice(0, 10)}</span>
        <span>O {price(point.open)} · H {price(point.high)} · L {price(point.low)} · C {price(point.close)}</span>
        <span>Volume {number(point.volume)}</span>
        <span>{status?.status?.setup ?? status?.phase ?? "—"}</span>
        {status && status.signal.type !== "HOLD" && <span>{status.signal.type}</span>}
        {operations.length > 0 && <span className="font-medium">{operations.join(" · ")}</span>}
        {status?.status?.levels?.rangeHigh != null && <span>Range {price(status.status.levels.rangeLow)}–{price(status.status.levels.rangeHigh)}</span>}
        {status?.status?.levels?.breakoutLevel != null && <span>Breakout {price(status.status.levels.breakoutLevel)}</span>}
        {status?.status?.levels?.invalidationPrice != null && <span>Invalidation {price(status.status.levels.invalidationPrice)}</span>}
        {status?.signal.reason && <span className="text-muted">{status.signal.reason}</span>}
      </div>}
    </div>
  );
}

function buildMarkers(result: WyckoffBacktestResult): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];
  const statusByTime = new Map(result.timeline.map((point) => [point.time, point]));
  for (const [index, step] of result.timeline.entries()) {
    const event = step.phase === "RANGE_FOUND" && result.timeline[index - 1]?.phase !== "RANGE_FOUND" ? "Range"
      : step.phase === "INVALIDATED" && step.signal.type === "HOLD" ? "Invalid"
      : step.phase === "SOS_DETECTED" ? "SOS"
      : step.phase === "SPRING_DETECTED" ? "Spring"
      : step.phase === "UTAD_DETECTED" ? "UTAD"
      : null;
    if (!event) continue;
    markers.push({
      time: toChartTime(step.time),
      position: event === "Spring" || event === "Range" ? "belowBar" : "aboveBar",
      color: event === "Spring" ? "#047857" : event === "SOS" ? "#d97706" : event === "UTAD" ? "#b42318" : "#667085",
      shape: event === "Invalid" ? "square" : "circle",
      text: event
    });
  }
  for (const trade of result.trades) {
    const setup = statusByTime.get(trade.entryTime)?.status?.setup;
    markers.push({
      time: toChartTime(trade.entryTime),
      position: trade.side === "SHORT" ? "aboveBar" : "belowBar",
      color: trade.side === "SHORT" ? "#b42318" : "#047857",
      shape: trade.side === "SHORT" ? "arrowDown" : "arrowUp",
      text: `${setup === "SOS_LPS" ? "LPS" : setup ?? ""} ${trade.side === "SHORT" ? "Short" : "Buy"} ${price(trade.entryPrice)}`.trim()
    });
    if (trade.exitTime !== undefined) {
      markers.push({
        time: toChartTime(trade.exitTime),
        position: trade.side === "SHORT" ? "belowBar" : "aboveBar",
        color: "#667085",
        shape: trade.side === "SHORT" ? "arrowUp" : "arrowDown",
        text: `${trade.exitReason === "END_OF_BACKTEST" ? "End" : trade.side === "SHORT" ? "Cover" : "Sell"} ${price(trade.exitPrice)}`
      });
    }
  }
  return markers.sort((left, right) => Number(left.time) - Number(right.time));
}

function showRecent(chart: IChartApi, count: number): void {
  chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, count - 120), to: count + 8 });
}

function toChartTime(milliseconds: number): Time {
  return Math.floor(milliseconds / 1000) as Time;
}

function price(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: value >= 100 ? 2 : 6 }).format(value);
}

function number(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}
