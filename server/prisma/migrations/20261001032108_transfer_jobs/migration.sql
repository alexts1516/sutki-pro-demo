-- CreateTable
CREATE TABLE "TransferJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "bookingId" TEXT,
    "apartmentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OFFERED',
    "pickupAt" DATETIME NOT NULL,
    "meetingPoint" TEXT,
    "notes" TEXT,
    "freeWaitMin" INTEGER NOT NULL DEFAULT 60,
    "driverUserId" TEXT,
    "driverContractorId" TEXT,
    "driverName" TEXT,
    "vehicle" TEXT,
    "payoutKzt" INTEGER,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" DATETIME,
    "offerRound" INTEGER NOT NULL DEFAULT 1,
    "offeredAt" DATETIME,
    "escalatedAt" DATETIME,
    "acceptedAt" DATETIME,
    "enRouteAt" DATETIME,
    "etaAt" DATETIME,
    "arrivedAt" DATETIME,
    "pickedUpAt" DATETIME,
    "doneAt" DATETIME,
    "cancelledAt" DATETIME,
    "cancelReason" TEXT,
    "linkToken" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TransferJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TransferJob_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TransferJob_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TransferJob_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TransferJob_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TransferJob_driverContractorId_fkey" FOREIGN KEY ("driverContractorId") REFERENCES "Contractor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransferEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "note" TEXT,
    "data" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TransferEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TransferEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "TransferJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Contractor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "phone" TEXT,
    "note" TEXT,
    "regular" BOOLEAN NOT NULL DEFAULT false,
    "canDrive" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Contractor_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Contractor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Contractor" ("accountId", "createdAt", "id", "name", "note", "phone", "regular", "type", "userId") SELECT "accountId", "createdAt", "id", "name", "note", "phone", "regular", "type", "userId" FROM "Contractor";
DROP TABLE "Contractor";
ALTER TABLE "new_Contractor" RENAME TO "Contractor";
CREATE INDEX "Contractor_userId_idx" ON "Contractor"("userId");
CREATE TABLE "new_Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "canDrive" BOOLEAN NOT NULL DEFAULT false,
    "vehicle" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Membership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Membership" ("accountId", "active", "createdAt", "id", "role", "userId") SELECT "accountId", "active", "createdAt", "id", "role", "userId" FROM "Membership";
DROP TABLE "Membership";
ALTER TABLE "new_Membership" RENAME TO "Membership";
CREATE INDEX "Membership_accountId_idx" ON "Membership"("accountId");
CREATE UNIQUE INDEX "Membership_userId_accountId_key" ON "Membership"("userId", "accountId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "TransferJob_transferId_key" ON "TransferJob"("transferId");

-- CreateIndex
CREATE UNIQUE INDEX "TransferJob_linkToken_key" ON "TransferJob"("linkToken");

-- CreateIndex
CREATE INDEX "TransferJob_accountId_pickupAt_idx" ON "TransferJob"("accountId", "pickupAt");

-- CreateIndex
CREATE INDEX "TransferJob_accountId_status_idx" ON "TransferJob"("accountId", "status");

-- CreateIndex
CREATE INDEX "TransferJob_driverUserId_idx" ON "TransferJob"("driverUserId");

-- CreateIndex
CREATE INDEX "TransferEvent_jobId_createdAt_idx" ON "TransferEvent"("jobId", "createdAt");

-- Владелец и админ по умолчанию в списке водителей (можно выключить в «Команде»)
UPDATE "Membership" SET "canDrive" = true WHERE "role" IN ('owner', 'admin');
