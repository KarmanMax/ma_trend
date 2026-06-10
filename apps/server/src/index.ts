import { PrismaClient } from "@prisma/client";
import { BacktestEngine } from "@trend-trade/backtest";
import { BinanceMarketDataProvider } from "@trend-trade/market-data";
import { backtestConfigSchema, type BacktestConfig, type BacktestResult } from "@trend-trade/shared";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";

const serverDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(serverDir, "../../../.env") });

const prisma = new PrismaClient();
const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors({
  origin: process.env.NODE_ENV === "production" ? resolveCorsOrigin : true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.options("*", cors({ origin: process.env.NODE_ENV === "production" ? resolveCorsOrigin : true }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/api/backtests", async (request, response, next) => {
  try {
    const config = backtestConfigSchema.parse(request.body) as BacktestConfig;
    const engine = new BacktestEngine(new BinanceMarketDataProvider());
    const result = await engine.run(config);
    const saved = await saveBacktestResult(config, result);
    response.status(201).json(saved);
  } catch (error) {
    next(error);
  }
});

app.get("/api/backtests", async (_request, response, next) => {
  try {
    const runs = await prisma.backtestRun.findMany({
      orderBy: { createdAt: "desc" },
      include: { metrics: true },
      take: 50
    });

    response.json(
      runs.map((run) => ({
        id: run.id,
        symbol: run.symbol,
        timeframe: run.timeframe,
        strategyType: run.strategyType,
        status: run.status,
        totalReturn: run.metrics?.totalReturn ?? null,
        maxDrawdown: run.metrics?.maxDrawdown ?? null,
        sharpeRatio: run.metrics?.sharpeRatio ?? null,
        tradeCount: run.metrics?.tradeCount ?? null,
        createdAt: run.createdAt.toISOString()
      }))
    );
  } catch (error) {
    next(error);
  }
});

app.get("/api/backtests/:id", async (request, response, next) => {
  try {
    const run = await prisma.backtestRun.findUnique({
      where: { id: request.params.id },
      include: {
        strategyConfig: true,
        metrics: true,
        trades: { orderBy: { entryTime: "asc" } },
        chartPoints: { orderBy: { time: "asc" } },
        equityPoints: { orderBy: { time: "asc" } },
        drawdownPoints: { orderBy: { time: "asc" } }
      }
    });

    if (!run) {
      response.status(404).json({ error: "Backtest run not found" });
      return;
    }

    response.json({
      id: run.id,
      config: {
        symbol: run.symbol,
        timeframe: run.timeframe,
        startTime: run.startTime.toISOString(),
        endTime: run.endTime.toISOString(),
        initialCapital: run.initialCapital,
        feeRate: run.feeRate,
        slippageRate: run.slippageRate,
        strategy: run.strategyConfig ? JSON.parse(run.strategyConfig.configJson) : null
      },
      status: run.status,
      metrics: run.metrics,
      trades: run.trades.map((trade) => ({
        id: trade.id,
        symbol: trade.symbol,
        side: trade.side,
        entryTime: trade.entryTime.toISOString(),
        exitTime: trade.exitTime?.toISOString(),
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        quantity: trade.quantity,
        grossPnl: trade.grossPnl,
        netPnl: trade.netPnl,
        fee: trade.fee,
        exitReason: trade.exitReason
      })),
      equityCurve: run.equityPoints.map((point) => ({
        time: point.time.toISOString(),
        equity: point.equity
      })),
      chartPoints: run.chartPoints.map((point) => ({
        time: point.time.toISOString(),
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
        volume: point.volume,
        emaFast: point.emaFast,
        emaSlow: point.emaSlow,
        atr: point.atr,
        adx: point.adx,
        volumeMa: point.volumeMa
      })),
      drawdownCurve: run.drawdownPoints.map((point) => ({
        time: point.time.toISOString(),
        drawdown: point.drawdown
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    response.status(400).json({ error: "Invalid request", details: error.flatten() });
    return;
  }

  const message = error instanceof Error ? error.message : "Unexpected server error";
  response.status(500).json({ error: message });
});

app.listen(port, () => {
  console.log(`Trend Trade API listening on http://localhost:${port}`);
});

async function saveBacktestResult(config: BacktestConfig, result: BacktestResult) {
  const metrics = sanitizeMetrics(result.metrics);

  const run = await prisma.backtestRun.create({
    data: {
      symbol: config.symbol,
      timeframe: config.timeframe,
      strategyType: config.strategy.type,
      status: result.status,
      initialCapital: config.initialCapital,
      feeRate: config.feeRate,
      slippageRate: config.slippageRate,
      startTime: new Date(config.startTime),
      endTime: new Date(config.endTime),
      strategyConfig: {
        create: {
          type: config.strategy.type,
          configJson: JSON.stringify(config.strategy)
        }
      },
      metrics: {
        create: metrics
      },
      trades: {
        create: result.trades.map((trade) => ({
          symbol: trade.symbol,
          side: trade.side,
          entryTime: new Date(trade.entryTime),
          exitTime: trade.exitTime ? new Date(trade.exitTime) : undefined,
          entryPrice: trade.entryPrice,
          exitPrice: trade.exitPrice,
          quantity: trade.quantity,
          grossPnl: trade.grossPnl,
          netPnl: trade.netPnl,
          fee: trade.fee,
          exitReason: trade.exitReason
        }))
      },
      chartPoints: {
        create: result.chartPoints.map((point) => ({
          time: new Date(point.time),
          open: point.open,
          high: point.high,
          low: point.low,
          close: point.close,
          volume: point.volume,
          emaFast: point.emaFast,
          emaSlow: point.emaSlow,
          atr: point.atr,
          adx: point.adx,
          volumeMa: point.volumeMa
        }))
      },
      equityPoints: {
        create: result.equityCurve.map((point) => ({
          time: new Date(point.time),
          equity: point.equity
        }))
      },
      drawdownPoints: {
        create: result.drawdownCurve.map((point) => ({
          time: new Date(point.time),
          drawdown: point.drawdown
        }))
      }
    },
    include: {
      strategyConfig: true,
      metrics: true,
      trades: { orderBy: { entryTime: "asc" } },
      chartPoints: { orderBy: { time: "asc" } },
      equityPoints: { orderBy: { time: "asc" } },
      drawdownPoints: { orderBy: { time: "asc" } }
    }
  });

  return {
    id: run.id,
    status: run.status,
    config,
    metrics: run.metrics,
    trades: run.trades,
    chartPoints: run.chartPoints,
    equityCurve: run.equityPoints,
    drawdownCurve: run.drawdownPoints
  };
}

function sanitizeMetrics(metrics: BacktestResult["metrics"]): BacktestResult["metrics"] {
  return {
    ...metrics,
    profitFactor: Number.isFinite(metrics.profitFactor) ? metrics.profitFactor : 999999
  };
}

function resolveCorsOrigin(origin: string | undefined, callback: (error: Error | null, origin?: boolean | string) => void) {
  if (!origin) {
    callback(null, true);
    return;
  }

  const configuredOrigins = process.env.WEB_ORIGIN?.split(",").map((value) => value.trim()).filter(Boolean);
  if (configuredOrigins?.length) {
    callback(null, configuredOrigins.includes(origin));
    return;
  }

  try {
    const url = new URL(origin);
    const isAllowedDevOrigin =
      url.protocol === "http:" &&
      url.port === "5173" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || isPrivateIpv4(url.hostname));

    callback(null, isAllowedDevOrigin);
  } catch {
    callback(null, false);
  }
}

function isPrivateIpv4(hostname: string): boolean {
  return /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}
