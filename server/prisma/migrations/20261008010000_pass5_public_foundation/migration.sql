-- Minimal public access / checkout / payment-attempt foundation; existing rows retained.
ALTER TABLE "Booking" ADD COLUMN "guestAccessHash" TEXT;
ALTER TABLE "Booking" ADD COLUMN "checkoutKeyHash" TEXT;
ALTER TABLE "Booking" ADD COLUMN "checkoutRequestHash" TEXT;
CREATE UNIQUE INDEX "Booking_guestAccessHash_key" ON "Booking"("guestAccessHash");
CREATE UNIQUE INDEX "Booking_checkoutKeyHash_key" ON "Booking"("checkoutKeyHash");
ALTER TABLE "Payment" ADD COLUMN "publicRef" TEXT;
ALTER TABLE "Payment" ADD COLUMN "attemptKeyHash" TEXT;
ALTER TABLE "Payment" ADD COLUMN "initState" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "Payment" ADD COLUMN "intent" JSONB;
CREATE UNIQUE INDEX "Payment_publicRef_key" ON "Payment"("publicRef");
CREATE UNIQUE INDEX "Payment_attemptKeyHash_key" ON "Payment"("attemptKeyHash");
