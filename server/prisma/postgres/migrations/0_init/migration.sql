-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'trial',
    "status" TEXT NOT NULL DEFAULT 'active',
    "trialEndsAt" TIMESTAMP(3),
    "billingEmail" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Almaty',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountSettings" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "transferPayoutMode" TEXT NOT NULL DEFAULT 'PERCENT',
    "ownerCommissionPercent" DOUBLE PRECISION,
    "driverFixedKzt" INTEGER,
    "commissionConfiguredAt" TIMESTAMP(3),
    "managerNotify" TEXT NOT NULL DEFAULT 'BOTH',
    "approvalBy" TEXT NOT NULL DEFAULT 'OWNER_AND_ADMIN',
    "flightTracking" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "telegramId" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "canDrive" BOOLEAN NOT NULL DEFAULT false,
    "vehicle" TEXT,
    "payoutPercent" DOUBLE PRECISION,
    "payoutFixedKzt" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "telegramChatId" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Apartment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "code" TEXT,
    "title" TEXT NOT NULL,
    "titleEn" TEXT,
    "complex" TEXT,
    "address" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "rooms" TEXT NOT NULL,
    "maxGuests" INTEGER NOT NULL,
    "areaM2" INTEGER,
    "basePriceKzt" INTEGER NOT NULL,
    "description" TEXT,
    "descriptionEn" TEXT,
    "petsAllowed" BOOLEAN NOT NULL DEFAULT false,
    "petFeeKzt" INTEGER NOT NULL DEFAULT 0,
    "petNote" TEXT,
    "lockCode" TEXT,
    "keyboxCode" TEXT,
    "intercom" TEXT,
    "entrance" TEXT,
    "floor" INTEGER,
    "wifiName" TEXT,
    "wifiPassword" TEXT,
    "accessNote" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Apartment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApartmentPhoto" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "captionEn" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApartmentPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "guestId" TEXT,
    "number" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'request',
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3) NOT NULL,
    "checkInTime" TEXT NOT NULL DEFAULT '14:00',
    "checkOutTime" TEXT NOT NULL DEFAULT '12:00',
    "guestsCount" INTEGER NOT NULL,
    "nightlyKzt" INTEGER NOT NULL,
    "totalKzt" INTEGER NOT NULL,
    "currencyShown" TEXT NOT NULL DEFAULT 'KZT',
    "amountShown" DOUBLE PRECISION,
    "paymentMethod" TEXT,
    "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
    "pets" BOOLEAN NOT NULL DEFAULT false,
    "petFeeKzt" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "cleanerName" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "bookingId" TEXT,
    "guestId" TEXT,
    "apartmentId" TEXT,
    "direction" TEXT NOT NULL,
    "place" TEXT NOT NULL DEFAULT 'airport',
    "date" TIMESTAMP(3) NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferJob" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "bookingId" TEXT,
    "apartmentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OFFERED',
    "pickupAt" TIMESTAMP(3) NOT NULL,
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
    "flightEta" TIMESTAMP(3),
    "flightCheckedAt" TIMESTAMP(3),
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "offerRound" INTEGER NOT NULL DEFAULT 1,
    "offeredAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "enRouteAt" TIMESTAMP(3),
    "etaAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "linkToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "note" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CleaningTask" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "bookingId" TEXT,
    "assigneeId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "fromTime" TEXT NOT NULL DEFAULT '12:00',
    "toTime" TEXT NOT NULL DEFAULT '18:00',
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "checklist" JSONB,
    "report" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CleaningTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contractor" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "phone" TEXT,
    "note" TEXT,
    "regular" BOOLEAN NOT NULL DEFAULT false,
    "canDrive" BOOLEAN NOT NULL DEFAULT false,
    "payoutPercent" DOUBLE PRECISION,
    "payoutFixedKzt" INTEGER,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contractor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairTask" (
    "id" TEXT NOT NULL,
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
    "date" TIMESTAMP(3) NOT NULL,
    "accessMode" TEXT NOT NULL DEFAULT 'code',
    "accessNote" TEXT,
    "timeWindow" TEXT,
    "costKzt" INTEGER,
    "finalCostKzt" INTEGER,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "linkToken" TEXT,
    "visitRequestedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "inspectionNotes" TEXT,
    "startedAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT,
    "occupancy" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "occupancyUpdatedById" TEXT,
    "occupancyUpdatedAt" TIMESTAMP(3),
    "accessInstructions" TEXT,
    "blockDays" INTEGER,
    "report" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairEstimate" (
    "id" TEXT NOT NULL,
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
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "repairTaskId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "note" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairPhoto" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "repairTaskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "extraId" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtraExpense" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "repairTaskId" TEXT NOT NULL,
    "amountKzt" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "byName" TEXT,
    "byUserId" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtraExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "rateKzt" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrencySettings" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "shown" JSONB NOT NULL,
    "roundMode" TEXT NOT NULL DEFAULT 'nearest',
    "roundStep" JSONB,

    CONSTRAINT "CurrencySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteText" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteText_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short" TEXT NOT NULL DEFAULT 'AS',
    "taglineRu" TEXT NOT NULL DEFAULT '',
    "taglineEn" TEXT NOT NULL DEFAULT '',
    "logoUrl" TEXT,
    "logoKey" TEXT,
    "colors" JSONB NOT NULL,
    "phone" TEXT,
    "telegram" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipientType" TEXT NOT NULL,
    "recipientId" TEXT,
    "chatId" TEXT,
    "lang" TEXT NOT NULL DEFAULT 'ru',
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "bookingId" TEXT,
    "provider" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "amountKzt" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KZT',
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_slug_key" ON "Account"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "AccountSettings_accountId_key" ON "AccountSettings"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE INDEX "Membership_accountId_idx" ON "Membership"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_accountId_key" ON "Membership"("userId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_code_key" ON "Invite"("code");

-- CreateIndex
CREATE INDEX "Guest_accountId_idx" ON "Guest"("accountId");

-- CreateIndex
CREATE INDEX "Apartment_accountId_idx" ON "Apartment"("accountId");

-- CreateIndex
CREATE INDEX "ApartmentPhoto_apartmentId_sortOrder_idx" ON "ApartmentPhoto"("apartmentId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_token_key" ON "Booking"("token");

-- CreateIndex
CREATE INDEX "Booking_accountId_checkIn_idx" ON "Booking"("accountId", "checkIn");

-- CreateIndex
CREATE INDEX "Booking_apartmentId_checkIn_idx" ON "Booking"("apartmentId", "checkIn");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_accountId_number_key" ON "Booking"("accountId", "number");

-- CreateIndex
CREATE INDEX "Transfer_accountId_date_idx" ON "Transfer"("accountId", "date");

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

-- CreateIndex
CREATE INDEX "CleaningTask_accountId_date_idx" ON "CleaningTask"("accountId", "date");

-- CreateIndex
CREATE INDEX "CleaningTask_assigneeId_idx" ON "CleaningTask"("assigneeId");

-- CreateIndex
CREATE INDEX "Contractor_userId_idx" ON "Contractor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RepairTask_linkToken_key" ON "RepairTask"("linkToken");

-- CreateIndex
CREATE INDEX "RepairTask_accountId_date_idx" ON "RepairTask"("accountId", "date");

-- CreateIndex
CREATE INDEX "RepairTask_assigneeId_idx" ON "RepairTask"("assigneeId");

-- CreateIndex
CREATE INDEX "RepairEvent_repairTaskId_createdAt_idx" ON "RepairEvent"("repairTaskId", "createdAt");

-- CreateIndex
CREATE INDEX "RepairPhoto_repairTaskId_idx" ON "RepairPhoto"("repairTaskId");

-- CreateIndex
CREATE INDEX "ExtraExpense_repairTaskId_idx" ON "ExtraExpense"("repairTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_accountId_code_key" ON "ExchangeRate"("accountId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CurrencySettings_accountId_key" ON "CurrencySettings"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteText_accountId_lang_key_key" ON "SiteText"("accountId", "lang", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_accountId_key" ON "Brand"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_dedupeKey_key" ON "NotificationLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationLog_accountId_createdAt_idx" ON "NotificationLog"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_accountId_idx" ON "Payment"("accountId");

-- AddForeignKey
ALTER TABLE "AccountSettings" ADD CONSTRAINT "AccountSettings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Apartment" ADD CONSTRAINT "Apartment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentPhoto" ADD CONSTRAINT "ApartmentPhoto_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentPhoto" ADD CONSTRAINT "ApartmentPhoto_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferJob" ADD CONSTRAINT "TransferJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferJob" ADD CONSTRAINT "TransferJob_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferJob" ADD CONSTRAINT "TransferJob_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferJob" ADD CONSTRAINT "TransferJob_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferJob" ADD CONSTRAINT "TransferJob_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferJob" ADD CONSTRAINT "TransferJob_driverContractorId_fkey" FOREIGN KEY ("driverContractorId") REFERENCES "Contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferEvent" ADD CONSTRAINT "TransferEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferEvent" ADD CONSTRAINT "TransferEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "TransferJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleaningTask" ADD CONSTRAINT "CleaningTask_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleaningTask" ADD CONSTRAINT "CleaningTask_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleaningTask" ADD CONSTRAINT "CleaningTask_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleaningTask" ADD CONSTRAINT "CleaningTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contractor" ADD CONSTRAINT "Contractor_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contractor" ADD CONSTRAINT "Contractor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairTask" ADD CONSTRAINT "RepairTask_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairTask" ADD CONSTRAINT "RepairTask_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairTask" ADD CONSTRAINT "RepairTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairTask" ADD CONSTRAINT "RepairTask_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairTask" ADD CONSTRAINT "RepairTask_occupancyUpdatedById_fkey" FOREIGN KEY ("occupancyUpdatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairEstimate" ADD CONSTRAINT "RepairEstimate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairEstimate" ADD CONSTRAINT "RepairEstimate_repairTaskId_fkey" FOREIGN KEY ("repairTaskId") REFERENCES "RepairTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairEvent" ADD CONSTRAINT "RepairEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairEvent" ADD CONSTRAINT "RepairEvent_repairTaskId_fkey" FOREIGN KEY ("repairTaskId") REFERENCES "RepairTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairPhoto" ADD CONSTRAINT "RepairPhoto_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairPhoto" ADD CONSTRAINT "RepairPhoto_repairTaskId_fkey" FOREIGN KEY ("repairTaskId") REFERENCES "RepairTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairPhoto" ADD CONSTRAINT "RepairPhoto_extraId_fkey" FOREIGN KEY ("extraId") REFERENCES "ExtraExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraExpense" ADD CONSTRAINT "ExtraExpense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraExpense" ADD CONSTRAINT "ExtraExpense_repairTaskId_fkey" FOREIGN KEY ("repairTaskId") REFERENCES "RepairTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrencySettings" ADD CONSTRAINT "CurrencySettings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteText" ADD CONSTRAINT "SiteText_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

