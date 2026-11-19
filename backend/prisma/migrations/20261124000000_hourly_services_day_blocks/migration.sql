-- Hourly services: per-service minimum hours, same-day blocking rules and manual day closures.
ALTER TABLE "ServiceCategory" ADD COLUMN "minBookingHours" INTEGER;
ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_minBookingHours_check" CHECK ("minBookingHours" IS NULL OR ("minBookingHours" BETWEEN 1 AND 24));

CREATE TABLE "DayBlockRule" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "triggerServices" TEXT[],
  "blockedServices" TEXT[],
  "reverse" BOOLEAN NOT NULL DEFAULT false,
  "countUnpaid" BOOLEAN NOT NULL DEFAULT true,
  "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  "activeFrom" DATE,
  "activeUntil" DATE,
  "note" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DayBlockRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DayBlockRule_enabled_archivedAt_idx" ON "DayBlockRule"("enabled", "archivedAt");

CREATE TABLE "DayBlackout" (
  "id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "services" TEXT[],
  "reason" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DayBlackout_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DayBlackout_date_idx" ON "DayBlackout"("date");

-- Every package of these services is sold by the hour, with a 2-hour minimum by default.
UPDATE "ServiceCategory" SET "minBookingHours" = 2
 WHERE "slug" IN ('meeting-rooms','photo-studio','podcast-studio','events','workshops','webinars');

-- Fixed-length packages become hourly at the same total for their original length
-- (e.g. 4 hours for $799 -> $199.75 per hour). The original price is kept in metadata.
UPDATE "CatalogPlan" p SET
  "metadata" = COALESCE(p."metadata", '{}'::jsonb) || jsonb_build_object('preHourly', jsonb_build_object('unitAmountCents', p."unitAmountCents", 'billingUnit', p."billingUnit"::text, 'durationMinutes', p."durationMinutes"), 'billingPeriodLabel', 'per hour'),
  "unitAmountCents" = ROUND(p."unitAmountCents" * 60.0 / p."durationMinutes")::int,
  "billingUnit" = 'PER_HOUR',
  "durationMinutes" = 60,
  "minQuantity" = 1,
  "maxQuantity" = GREATEST(p."maxQuantity", 12)
FROM "ServiceCategory" s
WHERE s."id" = p."serviceId"
  AND s."slug" IN ('meeting-rooms','photo-studio','podcast-studio','events','workshops','webinars')
  AND p."billingUnit" IN ('PER_BOOKING','PER_SESSION','ONE_TIME')
  AND p."durationMinutes" > 0;

-- Hourly packages that already existed can be booked long enough for the new minimum.
UPDATE "CatalogPlan" p SET "maxQuantity" = GREATEST(p."maxQuantity", 12)
FROM "ServiceCategory" s
WHERE s."id" = p."serviceId" AND p."billingUnit" = 'PER_HOUR'
  AND s."slug" IN ('photo-studio','podcast-studio','events','workshops','webinars');

-- Same conversion for the legacy package table that still backs old links.
UPDATE "Plan" SET
  "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object('preHourly', jsonb_build_object('unitAmount', "unitAmount", 'pricingUnit', "pricingUnit"::text, 'durationMinutes', "durationMinutes")),
  "unitAmount" = ROUND("unitAmount" * 60.0 / "durationMinutes")::int,
  "pricingUnit" = 'HOUR',
  "durationMinutes" = 60,
  "minQuantity" = 1,
  "maxQuantity" = GREATEST("maxQuantity", 12)
WHERE "serviceType" IN ('meeting-rooms','photo-studio','podcast-studio','events','workshops','webinars')
  AND "pricingUnit" = 'SESSION' AND "durationMinutes" > 0 AND "billingType" = 'ONE_TIME';

-- Ready-made rules, off until an admin turns them on.
INSERT INTO "DayBlockRule" ("id","name","enabled","triggerServices","blockedServices","reverse","countUnpaid","note","updatedAt") VALUES
 ('dayblock-events-lock-studios', 'Event space or workshop booked: close rooms and studios', false,
  ARRAY['events','workshops'], ARRAY['meeting-rooms','photo-studio','podcast-studio'], false, true,
  'When the event space or a workshop is booked, meeting rooms, the photo studio and the podcast studio cannot be booked that day.', CURRENT_TIMESTAMP),
 ('dayblock-studios-lock-events', 'Room or studio booked: close event space and webinars', false,
  ARRAY['meeting-rooms','photo-studio','podcast-studio'], ARRAY['events','webinars'], false, true,
  'When a meeting room, the photo studio or the podcast studio is already booked, the event space and webinars cannot be booked that day.', CURRENT_TIMESTAMP);
