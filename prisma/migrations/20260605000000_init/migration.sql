-- CreateTable
CREATE TABLE "BacktestRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "strategyType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "initialCapital" REAL NOT NULL,
    "feeRate" REAL NOT NULL,
    "slippageRate" REAL NOT NULL,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StrategyConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "backtestRunId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "configJson" TEXT NOT NULL,
    CONSTRAINT "StrategyConfig_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "BacktestRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "backtestRunId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "entryTime" DATETIME NOT NULL,
    "exitTime" DATETIME,
    "entryPrice" REAL NOT NULL,
    "exitPrice" REAL,
    "quantity" REAL NOT NULL,
    "grossPnl" REAL,
    "netPnl" REAL,
    "fee" REAL NOT NULL,
    "exitReason" TEXT,
    CONSTRAINT "Trade_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "BacktestRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Metrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "backtestRunId" TEXT NOT NULL,
    "totalReturn" REAL NOT NULL,
    "cagr" REAL NOT NULL,
    "maxDrawdown" REAL NOT NULL,
    "sharpeRatio" REAL NOT NULL,
    "winRate" REAL NOT NULL,
    "profitFactor" REAL NOT NULL,
    "tradeCount" INTEGER NOT NULL,
    CONSTRAINT "Metrics_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "BacktestRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EquityPoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "backtestRunId" TEXT NOT NULL,
    "time" DATETIME NOT NULL,
    "equity" REAL NOT NULL,
    CONSTRAINT "EquityPoint_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "BacktestRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChartPoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "backtestRunId" TEXT NOT NULL,
    "time" DATETIME NOT NULL,
    "open" REAL NOT NULL,
    "high" REAL NOT NULL,
    "low" REAL NOT NULL,
    "close" REAL NOT NULL,
    "volume" REAL NOT NULL,
    "emaFast" REAL,
    "emaSlow" REAL,
    "atr" REAL,
    "adx" REAL,
    "volumeMa" REAL,
    CONSTRAINT "ChartPoint_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "BacktestRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DrawdownPoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "backtestRunId" TEXT NOT NULL,
    "time" DATETIME NOT NULL,
    "drawdown" REAL NOT NULL,
    CONSTRAINT "DrawdownPoint_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "BacktestRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BacktestRun_createdAt_idx" ON "BacktestRun"("createdAt");

-- CreateIndex
CREATE INDEX "BacktestRun_symbol_timeframe_idx" ON "BacktestRun"("symbol", "timeframe");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyConfig_backtestRunId_key" ON "StrategyConfig"("backtestRunId");

-- CreateIndex
CREATE INDEX "Trade_backtestRunId_idx" ON "Trade"("backtestRunId");

-- CreateIndex
CREATE UNIQUE INDEX "Metrics_backtestRunId_key" ON "Metrics"("backtestRunId");

-- CreateIndex
CREATE INDEX "EquityPoint_backtestRunId_time_idx" ON "EquityPoint"("backtestRunId", "time");

-- CreateIndex
CREATE INDEX "ChartPoint_backtestRunId_time_idx" ON "ChartPoint"("backtestRunId", "time");

-- CreateIndex
CREATE INDEX "DrawdownPoint_backtestRunId_time_idx" ON "DrawdownPoint"("backtestRunId", "time");
