-- v1.15.0: officers can hide the setup checklist card. On Railway, `prisma db push` adds this on start.
ALTER TABLE "GuildSettings" ADD COLUMN "setupHidden" BOOLEAN NOT NULL DEFAULT false;
