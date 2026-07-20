-- CreateTable
CREATE TABLE "GenerationCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inputHash" TEXT NOT NULL,
    "generator" TEXT NOT NULL,
    "artifactType" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "constraintsHash" TEXT NOT NULL,
    "hashVersion" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LlmCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generator" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costEst" REAL NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "validatorPassed" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "OpsConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "llmMonthlyCeiling" REAL NOT NULL DEFAULT 10,
    "routerPolicy" TEXT NOT NULL DEFAULT 'auto',
    "localModelEndpoint" TEXT,
    "localModel" TEXT NOT NULL DEFAULT 'llama3.1',
    "claudeModel" TEXT NOT NULL DEFAULT 'claude-opus-4-8',
    "safetyFloors" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "GenerationCache_inputHash_key" ON "GenerationCache"("inputHash");

-- CreateIndex
CREATE INDEX "GenerationCache_generator_idx" ON "GenerationCache"("generator");

-- CreateIndex
CREATE INDEX "GenerationCache_artifactType_artifactId_idx" ON "GenerationCache"("artifactType", "artifactId");

-- CreateIndex
CREATE INDEX "LlmCall_generator_createdAt_idx" ON "LlmCall"("generator", "createdAt");

-- CreateIndex
CREATE INDEX "LlmCall_createdAt_idx" ON "LlmCall"("createdAt");
