-- Blog CMS: revisions, slug redirects and aggregate view counts.
CREATE TABLE "ContentRevision" (
  "id" TEXT NOT NULL,
  "contentId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "excerpt" TEXT,
  "content" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "reason" TEXT NOT NULL DEFAULT 'save',
  "actorId" TEXT,
  "actorName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentRevision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ContentRevision_contentId_createdAt_idx" ON "ContentRevision"("contentId", "createdAt" DESC);

CREATE TABLE "ContentRedirect" (
  "id" TEXT NOT NULL,
  "fromPath" TEXT NOT NULL,
  "toPath" TEXT NOT NULL,
  "contentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentRedirect_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContentRedirect_fromPath_key" ON "ContentRedirect"("fromPath");
CREATE INDEX "ContentRedirect_contentId_idx" ON "ContentRedirect"("contentId");

CREATE TABLE "ContentView" (
  "contentId" TEXT NOT NULL,
  "views" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentView_pkey" PRIMARY KEY ("contentId")
);

-- Baseline revision for every existing post, so the first restore point is the imported version.
INSERT INTO "ContentRevision" ("id","contentId","title","slug","status","excerpt","content","metadata","reason","actorName")
SELECT gen_random_uuid()::text, "id", "title", "slug", "status"::text, "excerpt", "content", "metadata", 'baseline', 'Import'
FROM "Content" WHERE "kind" = 'blog';
