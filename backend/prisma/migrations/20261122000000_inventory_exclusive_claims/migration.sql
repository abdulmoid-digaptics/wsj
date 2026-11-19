-- Historical rows cannot reliably distinguish shared claims from exclusive rule locks.
-- Conservatively mark all existing lines exclusive until they expire or are released.
-- Old inventory readers cannot safely coexist with the new writer during rollout.
ALTER TABLE "InventoryClaimLine" ADD COLUMN "exclusive" BOOLEAN NOT NULL DEFAULT true;
