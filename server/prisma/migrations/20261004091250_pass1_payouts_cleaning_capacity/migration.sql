-- AlterTable
ALTER TABLE "Apartment" ADD COLUMN "cleaningExtraItems" JSONB;
ALTER TABLE "Apartment" ADD COLUMN "cleaningRateKzt" INTEGER;

-- AlterTable
ALTER TABLE "CleaningTask" ADD COLUMN "finishNote" TEXT;
ALTER TABLE "CleaningTask" ADD COLUMN "problems" JSONB;
ALTER TABLE "CleaningTask" ADD COLUMN "startedAt" DATETIME;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN "vehicleBags" INTEGER;
ALTER TABLE "Membership" ADD COLUMN "vehicleClass" TEXT;
ALTER TABLE "Membership" ADD COLUMN "vehicleSeats" INTEGER;

-- AlterTable
ALTER TABLE "RepairTask" ADD COLUMN "declinedAt" DATETIME;

-- CreateTable
CREATE TABLE "CleaningPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "cleaningTaskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'item',
    "itemIndex" INTEGER,
    "url" TEXT NOT NULL,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CleaningPhoto_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CleaningPhoto_cleaningTaskId_fkey" FOREIGN KEY ("cleaningTaskId") REFERENCES "CleaningTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AccountSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "transferPayoutMode" TEXT NOT NULL DEFAULT 'PERCENT',
    "ownerCommissionPercent" REAL,
    "driverFixedKzt" INTEGER,
    "commissionConfiguredAt" DATETIME,
    "managerNotify" TEXT NOT NULL DEFAULT 'BOTH',
    "approvalBy" TEXT NOT NULL DEFAULT 'OWNER_AND_ADMIN',
    "flightTracking" BOOLEAN NOT NULL DEFAULT true,
    "ownerDrivesKeepsAll" BOOLEAN NOT NULL DEFAULT true,
    "cleaningChecklist" JSONB,
    "cleaningRateKzt" INTEGER,
    "cleaningRates" JSONB,
    "payoutReminderHours" INTEGER NOT NULL DEFAULT 3,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountSettings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AccountSettings" ("accountId", "approvalBy", "commissionConfiguredAt", "driverFixedKzt", "flightTracking", "id", "managerNotify", "ownerCommissionPercent", "ownerDrivesKeepsAll", "transferPayoutMode", "updatedAt") SELECT "accountId", "approvalBy", "commissionConfiguredAt", "driverFixedKzt", "flightTracking", "id", "managerNotify", "ownerCommissionPercent", "ownerDrivesKeepsAll", "transferPayoutMode", "updatedAt" FROM "AccountSettings";
DROP TABLE "AccountSettings";
ALTER TABLE "new_AccountSettings" RENAME TO "AccountSettings";
CREATE UNIQUE INDEX "AccountSettings_accountId_key" ON "AccountSettings"("accountId");
CREATE TABLE "new_DriverPayout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'transfer',
    "jobId" TEXT,
    "cleaningTaskId" TEXT,
    "repairTaskId" TEXT,
    "driverUserId" TEXT,
    "driverContractorId" TEXT,
    "driverName" TEXT,
    "title" TEXT,
    "amountKzt" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "method" TEXT,
    "paidAt" DATETIME,
    "paidById" TEXT,
    "paidByName" TEXT,
    "remindedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DriverPayout_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DriverPayout_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "TransferJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DriverPayout_cleaningTaskId_fkey" FOREIGN KEY ("cleaningTaskId") REFERENCES "CleaningTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DriverPayout_repairTaskId_fkey" FOREIGN KEY ("repairTaskId") REFERENCES "RepairTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DriverPayout" ("accountId", "amountKzt", "createdAt", "driverContractorId", "driverName", "driverUserId", "id", "jobId", "paidAt", "paidById", "paidByName", "status", "updatedAt") SELECT "accountId", "amountKzt", "createdAt", "driverContractorId", "driverName", "driverUserId", "id", "jobId", "paidAt", "paidById", "paidByName", "status", "updatedAt" FROM "DriverPayout";
DROP TABLE "DriverPayout";
ALTER TABLE "new_DriverPayout" RENAME TO "DriverPayout";
CREATE UNIQUE INDEX "DriverPayout_jobId_key" ON "DriverPayout"("jobId");
CREATE UNIQUE INDEX "DriverPayout_cleaningTaskId_key" ON "DriverPayout"("cleaningTaskId");
CREATE UNIQUE INDEX "DriverPayout_repairTaskId_key" ON "DriverPayout"("repairTaskId");
CREATE INDEX "DriverPayout_accountId_status_idx" ON "DriverPayout"("accountId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CleaningPhoto_cleaningTaskId_idx" ON "CleaningPhoto"("cleaningTaskId");
