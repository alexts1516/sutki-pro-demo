-- CreateTable
CREATE TABLE "RepairEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "repairTaskId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "note" TEXT,
    "data" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RepairEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RepairEvent_repairTaskId_fkey" FOREIGN KEY ("repairTaskId") REFERENCES "RepairTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RepairPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "repairTaskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "extraId" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "mimeType" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RepairPhoto_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RepairPhoto_repairTaskId_fkey" FOREIGN KEY ("repairTaskId") REFERENCES "RepairTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RepairPhoto_extraId_fkey" FOREIGN KEY ("extraId") REFERENCES "ExtraExpense" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExtraExpense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "repairTaskId" TEXT NOT NULL,
    "amountKzt" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "byName" TEXT,
    "byUserId" TEXT,
    "decisionNote" TEXT,
    "decidedAt" DATETIME,
    "decidedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExtraExpense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExtraExpense_repairTaskId_fkey" FOREIGN KEY ("repairTaskId") REFERENCES "RepairTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Contractor_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Contractor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Contractor" ("accountId", "createdAt", "id", "name", "note", "phone", "regular", "type") SELECT "accountId", "createdAt", "id", "name", "note", "phone", "regular", "type" FROM "Contractor";
DROP TABLE "Contractor";
ALTER TABLE "new_Contractor" RENAME TO "Contractor";
CREATE INDEX "Contractor_userId_idx" ON "Contractor"("userId");
CREATE TABLE "new_RepairEstimate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "repairTaskId" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'REMOTE',
    "workKzt" INTEGER NOT NULL,
    "partsKzt" INTEGER NOT NULL DEFAULT 0,
    "materialsIncluded" BOOLEAN NOT NULL DEFAULT false,
    "maxKzt" INTEGER,
    "preliminary" BOOLEAN NOT NULL DEFAULT true,
    "items" TEXT,
    "comment" TEXT,
    "byName" TEXT,
    "byUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rejectReason" TEXT,
    "decidedAt" DATETIME,
    "decidedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RepairEstimate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RepairEstimate_repairTaskId_fkey" FOREIGN KEY ("repairTaskId") REFERENCES "RepairTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RepairEstimate" ("accountId", "byName", "createdAt", "decidedAt", "decidedById", "id", "items", "partsKzt", "repairTaskId", "status", "workKzt") SELECT "accountId", "byName", "createdAt", "decidedAt", "decidedById", "id", "items", "partsKzt", "repairTaskId", "status", "workKzt" FROM "RepairEstimate";
DROP TABLE "RepairEstimate";
ALTER TABLE "new_RepairEstimate" RENAME TO "RepairEstimate";
CREATE TABLE "new_RepairTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'other',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "quickJob" BOOLEAN NOT NULL DEFAULT false,
    "assigneeId" TEXT,
    "contractorId" TEXT,
    "assigneeLabel" TEXT,
    "date" DATETIME NOT NULL,
    "accessMode" TEXT NOT NULL DEFAULT 'code',
    "accessNote" TEXT,
    "timeWindow" TEXT,
    "costKzt" INTEGER,
    "finalCostKzt" INTEGER,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" DATETIME,
    "linkToken" TEXT,
    "visitRequestedAt" DATETIME,
    "arrivedAt" DATETIME,
    "inspectionNotes" TEXT,
    "startedAt" DATETIME,
    "cancelReason" TEXT,
    "createdById" TEXT,
    "occupancy" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "occupancyUpdatedById" TEXT,
    "occupancyUpdatedAt" DATETIME,
    "accessInstructions" TEXT,
    "blockDays" INTEGER,
    "report" TEXT,
    "doneAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RepairTask_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RepairTask_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RepairTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RepairTask_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RepairTask_occupancyUpdatedById_fkey" FOREIGN KEY ("occupancyUpdatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RepairTask" ("accessMode", "accessNote", "accountId", "apartmentId", "assigneeId", "assigneeLabel", "blockDays", "contractorId", "costKzt", "createdAt", "date", "description", "doneAt", "id", "paid", "priority", "report", "status", "timeWindow", "title", "type") SELECT "accessMode", "accessNote", "accountId", "apartmentId", "assigneeId", "assigneeLabel", "blockDays", "contractorId", "costKzt", "createdAt", "date", "description", "doneAt", "id", "paid", "priority", "report", "status", "timeWindow", "title", "type" FROM "RepairTask";
DROP TABLE "RepairTask";
ALTER TABLE "new_RepairTask" RENAME TO "RepairTask";
CREATE UNIQUE INDEX "RepairTask_linkToken_key" ON "RepairTask"("linkToken");
CREATE INDEX "RepairTask_accountId_date_idx" ON "RepairTask"("accountId", "date");
CREATE INDEX "RepairTask_assigneeId_idx" ON "RepairTask"("assigneeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "RepairEvent_repairTaskId_createdAt_idx" ON "RepairEvent"("repairTaskId", "createdAt");

-- CreateIndex
CREATE INDEX "RepairPhoto_repairTaskId_idx" ON "RepairPhoto"("repairTaskId");

-- CreateIndex
CREATE INDEX "ExtraExpense_repairTaskId_idx" ON "ExtraExpense"("repairTaskId");

-- Перенос старых статусов ремонтов в новый процесс заявок мастерам
UPDATE "RepairTask" SET "status" = 'IN_PROGRESS' WHERE "status" = 'progress';
UPDATE "RepairTask" SET "status" = 'DONE', "finalCostKzt" = "costKzt" WHERE "status" = 'done';
UPDATE "RepairTask" SET "status" = 'APPROVED' WHERE "status" = 'open' AND EXISTS (SELECT 1 FROM "RepairEstimate" e WHERE e."repairTaskId" = "RepairTask"."id" AND e."status" = 'approved');
UPDATE "RepairTask" SET "status" = 'AWAITING_OWNER_APPROVAL' WHERE "status" = 'open' AND EXISTS (SELECT 1 FROM "RepairEstimate" e WHERE e."repairTaskId" = "RepairTask"."id" AND e."status" = 'pending');
UPDATE "RepairTask" SET "status" = 'NEW' WHERE "status" = 'open';
UPDATE "RepairEstimate" SET "materialsIncluded" = true WHERE "partsKzt" > 0;
