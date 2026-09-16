-- CreateTable: member location pins for the Member Map module
CREATE TABLE "MemberPin" (
    "id"           TEXT             NOT NULL,
    "guildId"      TEXT             NOT NULL,
    "userId"       TEXT             NOT NULL,
    "lat"          DOUBLE PRECISION NOT NULL,
    "lng"          DOUBLE PRECISION NOT NULL,
    "municipality" TEXT             NOT NULL,
    "displayName"  TEXT,
    "createdAt"    TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3)     NOT NULL,

    CONSTRAINT "MemberPin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberPin_guildId_userId_key" ON "MemberPin"("guildId", "userId");
CREATE INDEX "MemberPin_guildId_idx" ON "MemberPin"("guildId");

-- AddForeignKey
ALTER TABLE "MemberPin" ADD CONSTRAINT "MemberPin_guildId_fkey"
    FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MemberPin" ADD CONSTRAINT "MemberPin_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
