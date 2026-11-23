-- Lead triage fields on inquiries and a composite index for customer subscription lookups. Additive only.
ALTER TABLE "Inquiry" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Inquiry" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "Inquiry" ADD COLUMN IF NOT EXISTS "assignedTo" TEXT;
CREATE INDEX IF NOT EXISTS "Subscription_customerId_accessStatus_idx" ON "Subscription"("customerId", "accessStatus");
