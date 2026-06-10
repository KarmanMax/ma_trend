import type { BacktestConfig } from "@trend-trade/shared";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export type ApiBacktestRun = {
  id: string;
  symbol: string;
  timeframe: string;
  strategyType: string;
  status: string;
  totalReturn: number | null;
  maxDrawdown: number | null;
  sharpeRatio: number | null;
  tradeCount: number | null;
  createdAt: string;
};

export type ApiBacktestDetail = {
  id: string;
  status: string;
  config: BacktestConfig;
  metrics: {
    totalReturn: number;
    cagr: number;
    maxDrawdown: number;
    sharpeRatio: number;
    winRate: number;
    profitFactor: number;
    tradeCount: number;
  };
  equityCurve: Array<{ time: string; equity: number }>;
  drawdownCurve: Array<{ time: string; drawdown: number }>;
  chartPoints: Array<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    emaFast?: number | null;
    emaSlow?: number | null;
    atr?: number | null;
    adx?: number | null;
    volumeMa?: number | null;
  }>;
  trades: Array<{
    id: string;
    symbol: string;
    side: string;
    entryTime: string;
    exitTime?: string;
    entryPrice: number;
    exitPrice?: number;
    quantity: number;
    grossPnl?: number;
    netPnl?: number;
    fee: number;
    exitReason?: string;
  }>;
};

export async function createBacktest(config: BacktestConfig): Promise<ApiBacktestDetail> {
  const response = await fetch(`${API_BASE_URL}/api/backtests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config)
  });

  return parseResponse(response);
}

export async function listBacktests(): Promise<ApiBacktestRun[]> {
  const response = await fetch(`${API_BASE_URL}/api/backtests`);
  return parseResponse(response);
}

export async function getBacktest(id: string): Promise<ApiBacktestDetail> {
  const response = await fetch(`${API_BASE_URL}/api/backtests/${id}`);
  return parseResponse(response);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }

  return data as T;
}
