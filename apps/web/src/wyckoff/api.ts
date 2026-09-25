import type { BacktestChartPoint, BacktestMetrics, Signal, Trade, WyckoffStrategyConfig } from "@trend-trade/shared";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export type WyckoffBacktestRequest = {
  symbol: string;
  startTime: string;
  endTime: string;
  initialCapital: number;
  feeRate: number;
  slippageRate: number;
  strategy: WyckoffStrategyConfig;
};

export type WyckoffBacktestResult = {
  id: string;
  config: WyckoffBacktestRequest;
  pair: string;
  metrics: BacktestMetrics;
  trades: Trade[];
  chartPoints: BacktestChartPoint[];
  timeline: Array<{
    time: number;
    phase: string | null;
    signal: Signal;
    status?: {
      phase: string;
      setup?: string | null;
      entrySide?: "LONG" | "SHORT" | null;
      levels?: Record<string, number | null>;
    };
  }>;
};

export type WyckoffScanJob = {
  id: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  createdAt: string;
  completed: number;
  total: number;
  error?: string;
  results: Array<{
    asset: { id: string; symbol: string; name: string; marketCapRank: number; marketCap: number };
    pair: string | null;
    status: "SCANNED" | "SKIPPED" | "ERROR";
    reason?: string;
    phase?: string;
    setup?: "SOS_LPS" | "SPRING" | "UTAD" | null;
    entrySide?: "LONG" | "SHORT" | null;
    signal?: Signal;
    lastCloseTime?: number;
  }>;
};

export async function createWyckoffBacktest(input: WyckoffBacktestRequest): Promise<WyckoffBacktestResult> {
  return request("/api/wyckoff/backtests", { method: "POST", body: JSON.stringify(input) });
}

export async function startWyckoffScan(strategy: WyckoffStrategyConfig): Promise<{ id: string }> {
  return request("/api/wyckoff/scans", { method: "POST", body: JSON.stringify({ strategy }) });
}

export async function getWyckoffScan(id: string): Promise<WyckoffScanJob> {
  return request(`/api/wyckoff/scans/${encodeURIComponent(id)}`);
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Wyckoff request failed");
  }
  return data as T;
}
