-- CreateEnum
CREATE TYPE "InventoryClaimKind" AS ENUM ('ALLOCATION', 'CLOSURE');

-- CreateEnum
CREATE TYPE "InventoryClaimState" AS ENUM ('HELD', 'CONFIRMED', 'RELEASED', 'EXPIRED');

-- CreateTable
CREATE TABLE "InventoryLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,

    CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhysicalResource" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PhysicalResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceServiceMapping" (
    "resourceId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "ResourceServiceMapping_pkey" PRIMARY KEY ("resourceId","serviceId")
);

-- CreateTable
CREATE TABLE "InventoryClaim" (
    "id" TEXT NOT NULL,
    "kind" "InventoryClaimKind" NOT NULL,
    "state" "InventoryClaimState" NOT NULL,
    "serviceId" TEXT,
    "ownerRef" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InventoryClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryClaimLine" (
    "claimId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "units" INTEGER NOT NULL,

    CONSTRAINT "InventoryClaimLine_pkey" PRIMARY KEY ("claimId","resourceId")
);

-- CreateIndex
CREATE INDEX "PhysicalResource_locationId_active_idx" ON "PhysicalResource"("locationId", "active");

-- CreateIndex
CREATE INDEX "ResourceServiceMapping_serviceId_idx" ON "ResourceServiceMapping"("serviceId");

-- CreateIndex
CREATE INDEX "InventoryClaim_ownerRef_idx" ON "InventoryClaim"("ownerRef");

-- CreateIndex
CREATE INDEX "InventoryClaim_state_expiresAt_idx" ON "InventoryClaim"("state", "expiresAt");

-- CreateIndex
CREATE INDEX "InventoryClaim_startsAt_endsAt_idx" ON "InventoryClaim"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "InventoryClaimLine_resourceId_claimId_idx" ON "InventoryClaimLine"("resourceId", "claimId");

-- AddForeignKey
ALTER TABLE "PhysicalResource" ADD CONSTRAINT "PhysicalResource_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceServiceMapping" ADD CONSTRAINT "ResourceServiceMapping_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "PhysicalResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceServiceMapping" ADD CONSTRAINT "ResourceServiceMapping_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryClaim" ADD CONSTRAINT "InventoryClaim_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryClaimLine" ADD CONSTRAINT "InventoryClaimLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "InventoryClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryClaimLine" ADD CONSTRAINT "InventoryClaimLine_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "PhysicalResource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row invariants Prisma cannot express. Cross-row capacity is enforced by the
-- inventory writer after ordered resource locks, not by these CHECK clauses.
ALTER TABLE "PhysicalResource" ADD CONSTRAINT "PhysicalResource_positive_capacity" CHECK ("capacity" > 0);
ALTER TABLE "InventoryClaimLine" ADD CONSTRAINT "InventoryClaimLine_positive_units" CHECK ("units" > 0);
ALTER TABLE "InventoryClaim" ADD CONSTRAINT "InventoryClaim_valid_interval" CHECK ("startsAt" < "endsAt");
ALTER TABLE "InventoryClaim" ADD CONSTRAINT "InventoryClaim_valid_kind" CHECK (
  ("kind" = 'ALLOCATION' AND "serviceId" IS NOT NULL) OR
  ("kind" = 'CLOSURE' AND "serviceId" IS NULL AND "state" IN ('CONFIRMED', 'RELEASED'))
);
ALTER TABLE "InventoryClaim" ADD CONSTRAINT "InventoryClaim_valid_expiry" CHECK (
  ("state" IN ('HELD', 'EXPIRED') AND "expiresAt" IS NOT NULL) OR
  ("state" IN ('CONFIRMED', 'RELEASED') AND "expiresAt" IS NULL)
);
