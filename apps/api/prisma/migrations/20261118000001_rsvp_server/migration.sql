-- v1.20.0: which server each sign-up came from, for joint ops. On Railway, `prisma db push` adds this on start.
ALTER TABLE "EventRsvp" ADD COLUMN "guildId" TEXT;
