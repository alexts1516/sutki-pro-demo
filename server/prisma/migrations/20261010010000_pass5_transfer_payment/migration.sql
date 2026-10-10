ALTER TABLE "Transfer" ADD COLUMN "checkoutKeyHash" TEXT;
ALTER TABLE "Transfer" ADD COLUMN "checkoutRequestHash" TEXT;
CREATE UNIQUE INDEX "Transfer_checkoutKeyHash_key" ON "Transfer"("checkoutKeyHash");
ALTER TABLE "Payment" ADD COLUMN "transferId" TEXT;
CREATE INDEX "Payment_transferId_idx" ON "Payment"("transferId");
