-- AlterTable
ALTER TABLE "Contractor" ADD COLUMN "payoutFixedKzt" INTEGER;
ALTER TABLE "Contractor" ADD COLUMN "payoutPercent" REAL;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN "payoutFixedKzt" INTEGER;
ALTER TABLE "Membership" ADD COLUMN "payoutPercent" REAL;

-- CreateTable
CREATE TABLE "AccountSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "transferPayoutMode" TEXT NOT NULL DEFAULT 'PERCENT',
    "ownerCommissionPercent" REAL,
    "driverFixedKzt" INTEGER,
    "commissionConfiguredAt" DATETIME,
    "managerNotify" TEXT NOT NULL DEFAULT 'BOTH',
    "approvalBy" TEXT NOT NULL DEFAULT 'OWNER_AND_ADMIN',
    "flightTracking" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountSettings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TransferJob" (
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
    "commissionKzt" INTEGER,
    "payoutRule" TEXT,
    "payoutManual" BOOLEAN NOT NULL DEFAULT false,
    "flightStatus" TEXT,
    "flightEta" DATETIME,
    "flightCheckedAt" DATETIME,
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
INSERT INTO "new_TransferJob" ("acceptedAt", "accountId", "apartmentId", "arrivedAt", "bookingId", "cancelReason", "cancelledAt", "createdAt", "doneAt", "driverContractorId", "driverName", "driverUserId", "enRouteAt", "escalatedAt", "etaAt", "freeWaitMin", "id", "linkToken", "meetingPoint", "notes", "offerRound", "offeredAt", "paid", "paidAt", "payoutKzt", "pickedUpAt", "pickupAt", "status", "transferId", "updatedAt", "vehicle") SELECT "acceptedAt", "accountId", "apartmentId", "arrivedAt", "bookingId", "cancelReason", "cancelledAt", "createdAt", "doneAt", "driverContractorId", "driverName", "driverUserId", "enRouteAt", "escalatedAt", "etaAt", "freeWaitMin", "id", "linkToken", "meetingPoint", "notes", "offerRound", "offeredAt", "paid", "paidAt", "payoutKzt", "pickedUpAt", "pickupAt", "status", "transferId", "updatedAt", "vehicle" FROM "TransferJob";
DROP TABLE "TransferJob";
ALTER TABLE "new_TransferJob" RENAME TO "TransferJob";
CREATE UNIQUE INDEX "TransferJob_transferId_key" ON "TransferJob"("transferId");
CREATE UNIQUE INDEX "TransferJob_linkToken_key" ON "TransferJob"("linkToken");
CREATE INDEX "TransferJob_accountId_pickupAt_idx" ON "TransferJob"("accountId", "pickupAt");
CREATE INDEX "TransferJob_accountId_status_idx" ON "TransferJob"("accountId", "status");
CREATE INDEX "TransferJob_driverUserId_idx" ON "TransferJob"("driverUserId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "AccountSettings_accountId_key" ON "AccountSettings"("accountId");
