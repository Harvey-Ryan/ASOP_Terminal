-- v1.17.0: "Maybe" sign-ups. On Railway, `prisma db push` adds this on start.
ALTER TABLE "EventRsvp" ADD COLUMN "tentative" BOOLEAN NOT NULL DEFAULT false;
