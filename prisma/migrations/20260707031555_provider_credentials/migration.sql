-- CreateTable
CREATE TABLE "ProviderCredential" (
    "provider" TEXT NOT NULL PRIMARY KEY,
    "ciphertext" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
