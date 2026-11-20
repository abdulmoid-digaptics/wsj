-- Coworking day selection (Bronze/Silver/Gold/Platinum). Additive only.
CREATE TABLE "CoworkingDay" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "planSlug" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "windowStart" DATE NOT NULL,
    "windowEnd" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "movedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CoworkingDay_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CoworkingDay_status_check" CHECK ("status" IN ('ACTIVE','MOVED')),
    CONSTRAINT "CoworkingDay_window_check" CHECK ("windowStart" <= "day" AND "day" <= "windowEnd")
);
CREATE INDEX "CoworkingDay_day_status_idx" ON "CoworkingDay"("day", "status");
CREATE INDEX "CoworkingDay_orderId_idx" ON "CoworkingDay"("orderId");
CREATE INDEX "CoworkingDay_customerId_idx" ON "CoworkingDay"("customerId");
-- The same order can never hold the same day twice.
CREATE UNIQUE INDEX "CoworkingDay_order_day_active_key" ON "CoworkingDay"("orderId", "day") WHERE "status" = 'ACTIVE';
ALTER TABLE "CoworkingDay" ADD CONSTRAINT "CoworkingDay_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoworkingDay" ADD CONSTRAINT "CoworkingDay_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
