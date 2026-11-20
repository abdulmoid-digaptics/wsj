-- Email marketing: subscribers, campaigns, recipients and click events.
CREATE TABLE "Subscriber" (
  "id" TEXT NOT NULL, "email" TEXT NOT NULL, "emailKey" TEXT NOT NULL, "name" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'PENDING', "source" TEXT NOT NULL DEFAULT 'manual', "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "customerId" TEXT, "consentAt" TIMESTAMP(3), "consentSource" TEXT, "confirmedAt" TIMESTAMP(3), "unsubscribedAt" TIMESTAMP(3),
  "unsubscribeReason" TEXT, "lastEmailAt" TIMESTAMP(3), "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Subscriber_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Subscriber_emailKey_key" ON "Subscriber"("emailKey");
CREATE INDEX "Subscriber_status_createdAt_idx" ON "Subscriber"("status", "createdAt");
CREATE INDEX "Subscriber_customerId_idx" ON "Subscriber"("customerId");

CREATE TABLE "MarketingCampaign" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "kind" TEXT NOT NULL DEFAULT 'MARKETING', "subject" TEXT NOT NULL DEFAULT '', "preheader" TEXT NOT NULL DEFAULT '',
  "contentHtml" TEXT NOT NULL DEFAULT '', "contentDoc" JSONB, "audience" JSONB NOT NULL DEFAULT '{}', "couponCode" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT', "scheduledAt" TIMESTAMP(3), "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "pauseReason" TEXT,
  "recipients" INTEGER NOT NULL DEFAULT 0, "sent" INTEGER NOT NULL DEFAULT 0, "failed" INTEGER NOT NULL DEFAULT 0, "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MarketingCampaign_status_scheduledAt_idx" ON "MarketingCampaign"("status", "scheduledAt");

CREATE TABLE "CampaignRecipient" (
  "id" TEXT NOT NULL, "campaignId" TEXT NOT NULL, "subscriberId" TEXT, "customerId" TEXT, "email" TEXT NOT NULL, "name" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'QUEUED', "attempts" INTEGER NOT NULL DEFAULT 0, "error" TEXT, "lockedUntil" TIMESTAMP(3), "sentAt" TIMESTAMP(3),
  "openedAt" TIMESTAMP(3), "opens" INTEGER NOT NULL DEFAULT 0, "clickedAt" TIMESTAMP(3), "clicks" INTEGER NOT NULL DEFAULT 0, "unsubscribedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_email_key" ON "CampaignRecipient"("campaignId", "email");
CREATE INDEX "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId", "status");

CREATE TABLE "CampaignClick" (
  "id" TEXT NOT NULL, "campaignId" TEXT NOT NULL, "recipientId" TEXT NOT NULL, "url" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignClick_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CampaignClick_campaignId_url_idx" ON "CampaignClick"("campaignId", "url");

-- Existing consent: customers who ticked marketing at checkout or in their account become subscribers.
INSERT INTO "Subscriber" ("id","email","emailKey","name","status","source","customerId","consentAt","consentSource","confirmedAt","updatedAt")
SELECT gen_random_uuid()::text, c."email", lower(c."email"), c."name", 'SUBSCRIBED', 'customer', c."id", COALESCE(c."marketingConsentAt", c."createdAt"), 'customer-opt-in', COALESCE(c."marketingConsentAt", c."createdAt"), CURRENT_TIMESTAMP
FROM "Customer" c WHERE c."marketingOptIn" = true AND c."mergedIntoId" IS NULL AND c."email" <> ''
ON CONFLICT ("emailKey") DO NOTHING;

-- Earlier newsletter sign-ups were stored as inquiries; they become PENDING (they never confirmed by email).
INSERT INTO "Subscriber" ("id","email","emailKey","name","status","source","consentSource","updatedAt","createdAt")
SELECT gen_random_uuid()::text, i."email", lower(i."email"), '', 'PENDING', 'newsletter-legacy', 'newsletter form (unconfirmed)', CURRENT_TIMESTAMP, min(i."createdAt")
FROM "Inquiry" i WHERE lower(coalesce(i."service",'')) = 'newsletter' AND i."email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
GROUP BY i."email" ON CONFLICT ("emailKey") DO NOTHING;
