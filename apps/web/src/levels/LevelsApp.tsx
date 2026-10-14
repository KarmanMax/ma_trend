import { useRef, useState } from "react";
import { LevelsChart } from "./LevelsChart";

type Timeframe = "1h" | "4h" | "1d" | "1w";
type Market = "all" | "crypto" | "us";
type Side = "all" | "support" | "resistance";
type Match = {
  symbol: string;
  name: string;
  market: Exclude<Market, "all">;
  timeframe: Timeframe;
  side: Exclude<Side, "all">;
  price: number;
  level: number;
  zoneLow: number;
  zoneHigh: number;
  distancePct: number;
  touches: number;
  levelTime: number;
  priceTime: number;
};
type ScanResult = {
  timeframe: Timeframe;
  market: Market;
  side: Side;
  proximityPct: number;
  asOf: string;
  total: number;
  scanned: number;
  matches: Match[];
  unavailable: Array<{ symbol: string; reason: string }>;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const timeframeLabels: Record<Timeframe, string> = { "1h": "1 小时", "4h": "4 小时", "1d": "日线", "1w": "周线" };
const marketLabels: Record<Market, string> = { all: "全部市场", crypto: "加密货币市值前200（不含稳定币）", us: "蓝筹美股 + 半导体" };
const sideLabels: Record<Side, string> = { all: "支撑 + 阻力", support: "支撑位", resistance: "阻力位" };

function formatPrice(value: number): string {
  const digits = value >= 100 ? 2 : value >= 1 ? 3 : value >= 0.01 ? 4 : 6;
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: digits });
}

function formatTime(timestamp: number | string): string {
  return new Date(timestamp).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function LevelsApp() {
  const [timeframe, setTimeframe] = useState<Timeframe>("4h");
  const [market, setMarket] = useState<Market>("crypto");
  const [side, setSide] = useState<Side>("all");
  const [proximityPct, setProximityPct] = useState(2);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [selected, setSelected] = useState<Match | null>(null);
  const [chartRevision, setChartRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);

  function showChart(match: Match) {
    setSelected(match);
    setChartRevision((value) => value + 1);
    window.requestAnimationFrame(() => chartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function scan() {
    setLoading(true);
    setError(null);
    setResult(null);
    setSelected(null);
    try {
      const params = new URLSearchParams({ timeframe, market, side, proximityPct: String(proximityPct) });
      const response = await fetch(`${API_BASE_URL}/api/levels/scan?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "扫描失败");
      setResult(data as ScanResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "扫描失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-panel">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div><h1 className="text-xl font-semibold">支撑与阻力扫描</h1><p className="text-sm text-muted">按周期查找价格接近关键价位的标的</p></div>
          <nav className="flex gap-4 text-sm font-medium"><a className="text-accent hover:underline" href="/">趋势回测</a><a className="text-accent hover:underline" href="/wyckoff/">Wyckoff</a></nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-5 px-6 py-6">
        <section className="rounded-lg border border-border bg-panel p-5 shadow-panel">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end">
            <label className="grid gap-1 text-sm"><span>级别</span><select className="input" value={timeframe} onChange={(event) => { setTimeframe(event.target.value as Timeframe); setResult(null); }}>{Object.entries(timeframeLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
            <label className="grid gap-1 text-sm"><span>市场</span><select className="input" value={market} onChange={(event) => { setMarket(event.target.value as Market); setResult(null); }}>{Object.entries(marketLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
            <label className="grid gap-1 text-sm"><span>位置</span><select className="input" value={side} onChange={(event) => { setSide(event.target.value as Side); setResult(null); }}>{Object.entries(sideLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
            <label className="grid gap-1 text-sm"><span>距离上限（%）</span><input className="input" type="number" min="0.1" max="10" step="0.1" value={proximityPct} onChange={(event) => { setProximityPct(Number(event.target.value)); setResult(null); }} /></label>
            <button className="h-10 rounded-md bg-accent px-5 font-medium text-white disabled:opacity-50" disabled={loading || !Number.isFinite(proximityPct) || proximityPct < 0.1 || proximityPct > 10} onClick={() => void scan()}>{loading ? "扫描中…" : "开始扫描"}</button>
          </div>
          <p className="mt-3 text-xs text-muted">使用最近 120 根已完成 K 线：相邻两侧各 2 根 K 线形成摆动高/低点，以中心价 ±0.25 ATR(14) 形成价格区间；价格离开区间后再次进入才增加一次触及，至少 2 次独立触及才有效。距离按最新收盘价与区间中心计算。扫描结果仅供观察，不代表交易信号。</p>
        </section>

        {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {loading && <div className="rounded-lg border border-border bg-panel p-5 text-sm text-muted">正在读取 Binance 与 Yahoo 行情并计算价位，请稍候…</div>}
        {result && <section className="rounded-lg border border-border bg-panel p-5 shadow-panel">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-base font-semibold">筛选结果 · {result.matches.length} 个接近价位</h2><p className="mt-1 text-sm text-muted">{marketLabels[result.market]} · {timeframeLabels[result.timeframe]} · {sideLabels[result.side]} · 距离 ≤ {result.proximityPct}%</p></div><div className="text-right text-xs text-muted">已分析 {result.scanned}/{result.total} 个标的<br />扫描时间 {formatTime(result.asOf)}</div></div>
          {selected && <div ref={chartRef}><LevelsChart key={chartRevision} selection={selected} onClose={() => setSelected(null)} /></div>}
          {result.matches.length > 0 ? <div className="overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-background text-muted"><tr><th className="px-3 py-2">标的</th><th className="px-3 py-2">市场</th><th className="px-3 py-2">位置</th><th className="px-3 py-2 text-right">最新收盘</th><th className="px-3 py-2 text-right">价格区间</th><th className="px-3 py-2 text-right">中心距离</th><th className="px-3 py-2 text-right">独立触及</th><th className="px-3 py-2">行情时间</th><th className="px-3 py-2">最近触及</th><th className="px-3 py-2">图表</th></tr></thead><tbody>{result.matches.map((match) => <tr key={`${match.symbol}-${match.side}`} className={`border-t border-border ${selected?.symbol === match.symbol && selected.side === match.side ? "bg-blue-50" : ""}`}><td className="px-3 py-2 font-medium">{match.symbol}<div className="text-xs font-normal text-muted">{match.name}</div></td><td className="px-3 py-2">{match.market === "crypto" ? "加密货币" : "美股"}</td><td className="px-3 py-2">{match.side === "support" ? "支撑" : "阻力"}</td><td className="px-3 py-2 text-right tabular-nums">{formatPrice(match.price)}</td><td className="px-3 py-2 text-right tabular-nums"><span className="whitespace-nowrap">{formatPrice(match.zoneLow)}–{formatPrice(match.zoneHigh)}</span><div className="text-xs text-muted">中心 {formatPrice(match.level)}</div></td><td className="px-3 py-2 text-right tabular-nums">{match.distancePct.toFixed(2)}%</td><td className="px-3 py-2 text-right tabular-nums">{match.touches}</td><td className="px-3 py-2 whitespace-nowrap text-xs">{formatTime(match.priceTime)}</td><td className="px-3 py-2 whitespace-nowrap text-xs">{formatTime(match.levelTime)}</td><td className="px-3 py-2"><button type="button" className="whitespace-nowrap font-medium text-accent hover:underline" onClick={() => showChart(match)}>查看 K 线</button></td></tr>)}</tbody></table></div> : <p className="rounded-md border border-border bg-background p-5 text-sm text-muted">没有标的符合当前距离和价格区间条件。可调大距离上限或切换周期后重新扫描。</p>}
          {result.unavailable.length > 0 && <details className="mt-4 text-sm"><summary className="cursor-pointer text-muted">{result.unavailable.length} 个标的未完成分析（查看原因）</summary><ul className="mt-2 grid gap-1 text-xs text-muted">{result.unavailable.map((item) => <li key={item.symbol}>{item.symbol}：{item.reason}</li>)}</ul></details>}
        </section>}
      </div>
    </main>
  );
}
