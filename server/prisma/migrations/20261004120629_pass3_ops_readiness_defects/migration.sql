-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "earlyCheckIn" TEXT;
ALTER TABLE "Booking" ADD COLUMN "earlyCheckInStatus" TEXT;

-- AlterTable
ALTER TABLE "CleaningTask" ADD COLUMN "reviewedAt" DATETIME;
ALTER TABLE "CleaningTask" ADD COLUMN "reviewedBy" TEXT;

-- CreateTable
CREATE TABLE "Defect" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "cleaningTaskId" TEXT,
    "repairTaskId" TEXT,
    "text" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'later',
    "status" TEXT NOT NULL DEFAULT 'open',
    "photoIds" JSONB,
    "reportedById" TEXT,
    "reportedByName" TEXT,
    "takenById" TEXT,
    "takenByName" TEXT,
    "resolvedAt" DATETIME,
    "resolvedByName" TEXT,
    "resolution" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Defect_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Defect_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Defect_cleaningTaskId_fkey" FOREIGN KEY ("cleaningTaskId") REFERENCES "CleaningTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Defect_repairTaskId_fkey" FOREIGN KEY ("repairTaskId") REFERENCES "RepairTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
    "driverStartWindowMin" INTEGER NOT NULL DEFAULT 120,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountSettings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AccountSettings" ("accountId", "approvalBy", "cleaningChecklist", "cleaningRateKzt", "cleaningRates", "commissionConfiguredAt", "driverFixedKzt", "flightTracking", "id", "managerNotify", "ownerCommissionPercent", "ownerDrivesKeepsAll", "payoutReminderHours", "transferPayoutMode", "updatedAt") SELECT "accountId", "approvalBy", "cleaningChecklist", "cleaningRateKzt", "cleaningRates", "commissionConfiguredAt", "driverFixedKzt", "flightTracking", "id", "managerNotify", "ownerCommissionPercent", "ownerDrivesKeepsAll", "payoutReminderHours", "transferPayoutMode", "updatedAt" FROM "AccountSettings";
DROP TABLE "AccountSettings";
ALTER TABLE "new_AccountSettings" RENAME TO "AccountSettings";
CREATE UNIQUE INDEX "AccountSettings_accountId_key" ON "AccountSettings"("accountId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Defect_accountId_status_idx" ON "Defect"("accountId", "status");

-- CreateIndex
CREATE INDEX "Defect_apartmentId_status_idx" ON "Defect"("apartmentId", "status");
