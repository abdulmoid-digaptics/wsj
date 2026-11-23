CREATE TABLE "KisiPlanMapping" ("planId" TEXT PRIMARY KEY, "enabled" BOOLEAN NOT NULL DEFAULT false, "groupId" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "KisiMember" ("id" TEXT PRIMARY KEY, "customerId" TEXT NOT NULL, "kisiUserId" TEXT, "blocked" BOOLEAN NOT NULL DEFAULT false, "status" TEXT NOT NULL DEFAULT 'PENDING', "error" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE UNIQUE INDEX "KisiMember_customerId_key" ON "KisiMember"("customerId");
CREATE UNIQUE INDEX "KisiMember_kisiUserId_key" ON "KisiMember"("kisiUserId");
CREATE TABLE "KisiGrant" ("id" TEXT PRIMARY KEY, "memberId" TEXT NOT NULL, "sourceKey" TEXT NOT NULL, "groupId" TEXT NOT NULL, "validFrom" TIMESTAMP(3) NOT NULL, "validUntil" TIMESTAMP(3) NOT NULL, "assignmentId" TEXT, "status" TEXT NOT NULL DEFAULT 'PENDING', "error" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "KisiGrant_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "KisiMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE);
CREATE UNIQUE INDEX "KisiGrant_sourceKey_key" ON "KisiGrant"("sourceKey");
CREATE UNIQUE INDEX "KisiGrant_assignmentId_key" ON "KisiGrant"("assignmentId");
CREATE INDEX "KisiGrant_memberId_status_idx" ON "KisiGrant"("memberId", "status");
CREATE TABLE "KisiSyncLock" ("id" TEXT PRIMARY KEY, "token" TEXT NOT NULL, "until" TIMESTAMP(3) NOT NULL);
