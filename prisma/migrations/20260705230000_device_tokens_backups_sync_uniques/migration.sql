-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME
);

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'running',
    "snapshotPath" TEXT,
    "sizeBytes" INTEGER,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "restoreOk" BOOLEAN NOT NULL DEFAULT false,
    "prunedCount" INTEGER NOT NULL DEFAULT 0,
    "offsiteWarned" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_revokedAt_idx" ON "ApiToken"("revokedAt");

-- CreateIndex
CREATE INDEX "BackupRun_status_startedAt_idx" ON "BackupRun"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BodyMetric_clientId_key" ON "BodyMetric"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_clientId_key" ON "Feedback"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "SetLog_clientId_key" ON "SetLog"("clientId");

