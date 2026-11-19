-- One transaction: concurrent writers cannot insert between backfill and NOT NULL.
BEGIN;
ALTER TABLE "InventoryClaimLine" ADD COLUMN "startsAt" TIMESTAMPTZ(3), ADD COLUMN "endsAt" TIMESTAMPTZ(3);
UPDATE "InventoryClaimLine" AS l SET "startsAt" = c."startsAt", "endsAt" = c."endsAt"
FROM "InventoryClaim" AS c WHERE l."claimId" = c.id;
ALTER TABLE "InventoryClaimLine"
  ALTER COLUMN "startsAt" SET NOT NULL, ALTER COLUMN "endsAt" SET NOT NULL,
  ADD CONSTRAINT "InventoryClaimLine_valid_interval" CHECK ("startsAt" < "endsAt");
CREATE INDEX "InventoryClaimLine_resourceId_startsAt_endsAt_idx" ON "InventoryClaimLine"("resourceId", "startsAt", "endsAt");
COMMIT;
