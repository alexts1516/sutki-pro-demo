-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'trial',
    "status" TEXT NOT NULL DEFAULT 'active',
    "trialEndsAt" DATETIME,
    "billingEmail" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Almaty',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "phone" TEXT,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "telegramId" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Membership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invite_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Invite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Guest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "telegramChatId" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Guest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Apartment" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Apartment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApartmentPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApartmentPhoto_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApartmentPhoto_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "guestId" TEXT,
    "number" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'request',
    "checkIn" DATETIME NOT NULL,
    "checkOut" DATETIME NOT NULL,
    "checkInTime" TEXT NOT NULL DEFAULT '14:00',
    "checkOutTime" TEXT NOT NULL DEFAULT '12:00',
    "guestsCount" INTEGER NOT NULL,
    "nightlyKzt" INTEGER NOT NULL,
    "totalKzt" INTEGER NOT NULL,
    "currencyShown" TEXT NOT NULL DEFAULT 'KZT',
    "amountShown" REAL,
    "paymentMethod" TEXT,
    "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
    "pets" BOOLEAN NOT NULL DEFAULT false,
    "petFeeKzt" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "cleanerName" TEXT,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Booking_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Booking_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Booking_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transfer" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transfer_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transfer_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transfer_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transfer_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CleaningTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "bookingId" TEXT,
    "assigneeId" TEXT,
    "date" DATETIME NOT NULL,
    "fromTime" TEXT NOT NULL DEFAULT '12:00',
    "toTime" TEXT NOT NULL DEFAULT '18:00',
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "checklist" JSONB,
    "report" TEXT,
    "doneAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CleaningTask_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CleaningTask_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CleaningTask_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CleaningTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Contractor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "phone" TEXT,
    "note" TEXT,
    "regular" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Contractor_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RepairTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'other',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "assigneeId" TEXT,
    "contractorId" TEXT,
    "assigneeLabel" TEXT,
    "date" DATETIME NOT NULL,
    "accessMode" TEXT NOT NULL DEFAULT 'code',
    "accessNote" TEXT,
    "timeWindow" TEXT,
    "costKzt" INTEGER,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "blockDays" INTEGER,
    "report" TEXT,
    "doneAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RepairTask_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RepairTask_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RepairTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RepairTask_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RepairEstimate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "repairTaskId" TEXT NOT NULL,
    "workKzt" INTEGER NOT NULL,
    "partsKzt" INTEGER NOT NULL,
    "items" TEXT,
    "byName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedAt" DATETIME,
    "decidedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RepairEstimate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RepairEstimate_repairTaskId_fkey" FOREIGN KEY ("repairTaskId") REFERENCES "RepairTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "rateKzt" REAL NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExchangeRate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CurrencySettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "shown" JSONB NOT NULL,
    "roundMode" TEXT NOT NULL DEFAULT 'nearest',
    "roundStep" JSONB,
    CONSTRAINT "CurrencySettings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SiteText" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SiteText_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    CONSTRAINT "Brand_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "bookingId" TEXT,
    "provider" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "amountKzt" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KZT',
    "amount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "raw" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_slug_key" ON "Account"("slug");

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
CREATE INDEX "CleaningTask_accountId_date_idx" ON "CleaningTask"("accountId", "date");

-- CreateIndex
CREATE INDEX "CleaningTask_assigneeId_idx" ON "CleaningTask"("assigneeId");

-- CreateIndex
CREATE INDEX "RepairTask_accountId_date_idx" ON "RepairTask"("accountId", "date");

-- CreateIndex
CREATE INDEX "RepairTask_assigneeId_idx" ON "RepairTask"("assigneeId");

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
