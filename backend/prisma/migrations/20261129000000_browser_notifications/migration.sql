CREATE TYPE "NotificationType" AS ENUM ('BOOKING_CONFIRMED', 'BOOKING_REMINDER', 'NEW_LEAD', 'PAYMENT_FAILED');
CREATE TYPE "NotificationTopic" AS ENUM ('bookings', 'billing', 'system');

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "userAgent" TEXT,
    "deviceType" TEXT,
    "topics" "NotificationTopic"[] DEFAULT ARRAY['bookings', 'billing', 'system']::"NotificationTopic"[],
    "expiresAt" TIMESTAMP(3),
    "customerId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PushSubscription_one_owner" CHECK (("customerId" IS NULL) <> ("userId" IS NULL)),
    CONSTRAINT "PushSubscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_customerId_idx" ON "PushSubscription"("customerId");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

CREATE TABLE "NotificationRecord" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "metadata" JSONB,
    "customerId" TEXT,
    "userId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NotificationRecord_one_owner" CHECK (("customerId" IS NULL) <> ("userId" IS NULL)),
    CONSTRAINT "NotificationRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NotificationRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NotificationRecord_dedupeKey_key" ON "NotificationRecord"("dedupeKey");
CREATE INDEX "NotificationRecord_customerId_createdAt_idx" ON "NotificationRecord"("customerId", "createdAt" DESC);
CREATE INDEX "NotificationRecord_userId_createdAt_idx" ON "NotificationRecord"("userId", "createdAt" DESC);
CREATE INDEX "NotificationRecord_customerId_readAt_idx" ON "NotificationRecord"("customerId", "readAt");
CREATE INDEX "NotificationRecord_userId_readAt_idx" ON "NotificationRecord"("userId", "readAt");
