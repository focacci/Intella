-- CreateTable
CREATE TABLE "PairingWindow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pinHash" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL DEFAULT 'Paired device',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "PairingWindow_expiresAt_idx" ON "PairingWindow"("expiresAt");
