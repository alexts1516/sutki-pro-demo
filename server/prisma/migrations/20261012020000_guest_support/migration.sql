CREATE TABLE "SupportThread" (
 "id" TEXT NOT NULL PRIMARY KEY, "accountId" TEXT NOT NULL, "accessHash" TEXT NOT NULL,
 "topic" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
 CONSTRAINT "SupportThread_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SupportThread_accessHash_key" ON "SupportThread"("accessHash");
CREATE INDEX "SupportThread_accountId_updatedAt_idx" ON "SupportThread"("accountId", "updatedAt");
CREATE TABLE "SupportMessage" (
 "id" TEXT NOT NULL PRIMARY KEY, "threadId" TEXT NOT NULL, "sender" TEXT NOT NULL, "authorId" TEXT,
 "text" TEXT NOT NULL, "operationKey" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SupportMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "SupportThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SupportMessage_threadId_operationKey_key" ON "SupportMessage"("threadId", "operationKey");
CREATE INDEX "SupportMessage_threadId_createdAt_idx" ON "SupportMessage"("threadId", "createdAt");
