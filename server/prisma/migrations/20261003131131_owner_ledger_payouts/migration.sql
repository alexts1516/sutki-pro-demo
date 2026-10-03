-- CreateTable
CREATE TABLE "DriverPayout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "driverUserId" TEXT,
    "driverContractorId" TEXT,
    "driverName" TEXT,
    "amountKzt" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" DATETIME,
    "paidById" TEXT,
    "paidByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DriverPayout_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DriverPayout_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "TransferJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountSettings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AccountSettings" ("accountId", "approvalBy", "commissionConfiguredAt", "driverFixedKzt", "flightTracking", "id", "managerNotify", "ownerCommissionPercent", "transferPayoutMode", "updatedAt") SELECT "accountId", "approvalBy", "commissionConfiguredAt", "driverFixedKzt", "flightTracking", "id", "managerNotify", "ownerCommissionPercent", "transferPayoutMode", "updatedAt" FROM "AccountSettings";
DROP TABLE "AccountSettings";
ALTER TABLE "new_AccountSettings" RENAME TO "AccountSettings";
CREATE UNIQUE INDEX "AccountSettings_accountId_key" ON "AccountSettings"("accountId");
CREATE TABLE "new_Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "canDrive" BOOLEAN NOT NULL DEFAULT false,
    "vehicle" TEXT,
    "payoutPercent" REAL,
    "payoutFixedKzt" INTEGER,
    "paidAsDriver" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Membership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Membership" ("accountId", "active", "canDrive", "createdAt", "id", "payoutFixedKzt", "payoutPercent", "role", "userId", "vehicle") SELECT "accountId", "active", "canDrive", "createdAt", "id", "payoutFixedKzt", "payoutPercent", "role", "userId", "vehicle" FROM "Membership";
DROP TABLE "Membership";
ALTER TABLE "new_Membership" RENAME TO "Membership";
CREATE INDEX "Membership_accountId_idx" ON "Membership"("accountId");
CREATE UNIQUE INDEX "Membership_userId_accountId_key" ON "Membership"("userId", "accountId");
CREATE TABLE "new_Transfer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "bookingId" TEXT,
    "guestId" TEXT,
    "apartmentId" TEXT,
    "direction" TEXT NOT NULL,
    "place" TEXT NOT NULL DEFAULT 'airport',
    "date" DATETIME NOT NULL,
    "time" TEXT NOT NULL,
    "flight" TEXT,
    "pax" INTEGER NOT NULL DEFAULT 1,
    "bags" INTEGER NOT NULL DEFAULT 1,
    "childSeats" INTEGER NOT NULL DEFAULT 0,
    "carClass" TEXT NOT NULL DEFAULT 'standard',
    "priceKzt" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "driverName" TEXT,
    "sign" TEXT,
    "address" TEXT,
    "guestName" TEXT,
    "guestPhone" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "guestPaymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "guestPaymentMethod" TEXT,
    "guestPaidAt" DATETIME,
    "guestPaidById" TEXT,
    "guestPaidByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transfer_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transfer_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transfer_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transfer_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transfer" ("accountId", "address", "apartmentId", "bags", "bookingId", "carClass", "childSeats", "createdAt", "date", "direction", "driverName", "flight", "guestId", "guestName", "guestPhone", "id", "paid", "pax", "place", "priceKzt", "sign", "status", "time") SELECT "accountId", "address", "apartmentId", "bags", "bookingId", "carClass", "childSeats", "createdAt", "date", "direction", "driverName", "flight", "guestId", "guestName", "guestPhone", "id", "paid", "pax", "place", "priceKzt", "sign", "status", "time" FROM "Transfer";
DROP TABLE "Transfer";
ALTER TABLE "new_Transfer" RENAME TO "Transfer";
CREATE INDEX "Transfer_accountId_date_idx" ON "Transfer"("accountId", "date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "DriverPayout_jobId_key" ON "DriverPayout"("jobId");

-- CreateIndex
CREATE INDEX "DriverPayout_accountId_status_idx" ON "DriverPayout"("accountId", "status");

-- Данные. Трансферы, которые везёт/вёз сам владелец (выплата ещё не отмечена), — без выплаты, вся сумма бизнесу
UPDATE "TransferJob" SET "payoutKzt" = 0, "commissionKzt" = (SELECT t."priceKzt" FROM "Transfer" t WHERE t."id" = "TransferJob"."transferId"), "payoutRule" = 'owner', "payoutManual" = false
WHERE "paid" = false AND "driverUserId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId" = "TransferJob"."driverUserId" AND m."accountId" = "TransferJob"."accountId" AND m."role" = 'owner');

-- Долги водителям за уже выполненные заказы (только если выплата > 0)
INSERT INTO "DriverPayout" ("id", "accountId", "jobId", "driverUserId", "driverContractorId", "driverName", "amountKzt", "status", "paidAt", "createdAt", "updatedAt")
SELECT 'dp_' || "id", "accountId", "id", "driverUserId", "driverContractorId", "driverName", "payoutKzt", CASE WHEN "paid" THEN 'PAID' ELSE 'PENDING' END, "paidAt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TransferJob" WHERE "status" = 'DONE' AND "payoutKzt" > 0;

-- Оплата гостя: старый флаг Transfer.paid
UPDATE "Transfer" SET "guestPaymentStatus" = 'PAID' WHERE "paid" = true;
