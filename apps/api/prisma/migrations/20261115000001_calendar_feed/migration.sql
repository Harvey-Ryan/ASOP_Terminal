-- v1.16.0: personal calendar feed links. On Railway, `prisma db push` adds this on start.
ALTER TABLE "User" ADD COLUMN "calendarToken" TEXT;
CREATE UNIQUE INDEX "User_calendarToken_key" ON "User"("calendarToken");
