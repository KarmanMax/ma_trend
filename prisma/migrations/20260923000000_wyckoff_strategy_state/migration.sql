CREATE TABLE "WyckoffBacktestRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resultJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "WyckoffBacktestRun_createdAt_idx" ON "WyckoffBacktestRun"("createdAt");

CREATE TABLE "WyckoffScanJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completed" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "strategyJson" TEXT NOT NULL,
    "resultsJson" TEXT NOT NULL,
    "error" TEXT
);

CREATE INDEX "WyckoffScanJob_createdAt_idx" ON "WyckoffScanJob"("createdAt");

CREATE TABLE "WyckoffCheckpoint" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "snapshotJson" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
