BEGIN;
-- CreateTable
CREATE TABLE "LegacyReservationService" (
    "planId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "LegacyReservationService_pkey" PRIMARY KEY ("planId")
);

-- CreateTable
CREATE TABLE "ReservationPolicyConfig" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "catalogPlanId" TEXT,
    "legacyPlanId" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMPTZ(3),

    CHECK (num_nonnulls("catalogPlanId", "legacyPlanId") = 1),
    CHECK ("durationMinutes" BETWEEN 1 AND 10080),
    CHECK (version > 0),
    CHECK ("archivedAt" IS NULL OR NOT enabled),
    CONSTRAINT "ReservationPolicyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationPolicyRequirement" (
    "policyId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "units" INTEGER NOT NULL CHECK (units > 0),

    CONSTRAINT "ReservationPolicyRequirement_pkey" PRIMARY KEY ("policyId","resourceId")
);

-- Disabling does not free the scope. Archiving does, retaining requirements.
CREATE UNIQUE INDEX "reservation_live_catalog_scope" ON "ReservationPolicyConfig"("locationId", "serviceId", "catalogPlanId")
    WHERE "archivedAt" IS NULL AND "catalogPlanId" IS NOT NULL;
CREATE UNIQUE INDEX "reservation_live_legacy_scope" ON "ReservationPolicyConfig"("locationId", "serviceId", "legacyPlanId")
    WHERE "archivedAt" IS NULL AND "legacyPlanId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "LegacyReservationService_planId_serviceId_key" ON "LegacyReservationService"("planId", "serviceId");

-- CreateIndex
CREATE INDEX "ReservationPolicyConfig_locationId_archivedAt_idx" ON "ReservationPolicyConfig"("locationId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationPolicyConfig_id_locationId_serviceId_key" ON "ReservationPolicyConfig"("id", "locationId", "serviceId");

-- CreateIndex
CREATE INDEX "ReservationPolicyRequirement_resourceId_serviceId_idx" ON "ReservationPolicyRequirement"("resourceId", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogPlan_id_serviceId_key" ON "CatalogPlan"("id", "serviceId");

-- AddForeignKey
ALTER TABLE "LegacyReservationService" ADD CONSTRAINT "LegacyReservationService_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegacyReservationService" ADD CONSTRAINT "LegacyReservationService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceCategory"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReservationPolicyConfig" ADD CONSTRAINT "ReservationPolicyConfig_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReservationPolicyConfig" ADD CONSTRAINT "ReservationPolicyConfig_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceCategory"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReservationPolicyConfig" ADD CONSTRAINT "ReservationPolicyConfig_catalogPlanId_serviceId_fkey" FOREIGN KEY ("catalogPlanId", "serviceId") REFERENCES "CatalogPlan"("id", "serviceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReservationPolicyConfig" ADD CONSTRAINT "ReservationPolicyConfig_legacyPlanId_serviceId_fkey" FOREIGN KEY ("legacyPlanId", "serviceId") REFERENCES "LegacyReservationService"("planId", "serviceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReservationPolicyRequirement" ADD CONSTRAINT "ReservationPolicyRequirement_policyId_locationId_serviceId_fkey" FOREIGN KEY ("policyId", "locationId", "serviceId") REFERENCES "ReservationPolicyConfig"("id", "locationId", "serviceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReservationPolicyRequirement" ADD CONSTRAINT "ReservationPolicyRequirement_resourceId_locationId_fkey" FOREIGN KEY ("resourceId", "locationId") REFERENCES "PhysicalResource"("id", "locationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReservationPolicyRequirement" ADD CONSTRAINT "ReservationPolicyRequirement_resourceId_serviceId_fkey" FOREIGN KEY ("resourceId", "serviceId") REFERENCES "ResourceServiceMapping"("resourceId", "serviceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;
