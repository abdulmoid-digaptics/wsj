BEGIN;
-- The existing primary key makes this index unique even on populated installations.
-- Its second column lets the target FK enforce location membership under concurrency.
CREATE UNIQUE INDEX "PhysicalResource_id_locationId_key" ON "PhysicalResource"("id", "locationId");

CREATE TABLE "BookingRuleConfig" (
  "id" TEXT PRIMARY KEY,
  "locationId" TEXT NOT NULL REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "enabled" BOOLEAN NOT NULL,
  "priority" INTEGER NOT NULL,
  "condition" JSONB NOT NULL CHECK (jsonb_typeof("condition") = 'object'),
  "beforeMinutes" INTEGER NOT NULL CHECK ("beforeMinutes" BETWEEN 0 AND 10080),
  "afterMinutes" INTEGER NOT NULL CHECK ("afterMinutes" BETWEEN 0 AND 10080),
  "activeFrom" TIMESTAMPTZ(3),
  "activeUntil" TIMESTAMPTZ(3),
  "excludedDates" DATE[] NOT NULL DEFAULT ARRAY[]::date[] CHECK (cardinality("excludedDates") <= 366),
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "archivedAt" TIMESTAMPTZ(3),
  CHECK ("activeFrom" < "activeUntil"),
  CHECK ("archivedAt" IS NULL OR NOT "enabled")
);
CREATE UNIQUE INDEX "BookingRuleConfig_id_locationId_key" ON "BookingRuleConfig"("id", "locationId");
CREATE INDEX "BookingRuleConfig_locationId_priority_id_idx" ON "BookingRuleConfig"("locationId", "priority" DESC, "id");

CREATE TABLE "BookingRuleTarget" (
  "ruleId" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  PRIMARY KEY ("ruleId", "resourceId"),
  FOREIGN KEY ("ruleId", "locationId") REFERENCES "BookingRuleConfig"("id", "locationId") ON DELETE CASCADE ON UPDATE RESTRICT,
  FOREIGN KEY ("resourceId", "locationId") REFERENCES "PhysicalResource"("id", "locationId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "BookingRuleTarget_resourceId_locationId_idx" ON "BookingRuleTarget"("resourceId", "locationId");
COMMIT;
