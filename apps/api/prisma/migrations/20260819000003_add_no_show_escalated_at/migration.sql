-- AlterTable: add noShowEscalatedAt to TournamentMatch
-- Nullable DateTime — no default value; NULL means the escalation has not fired yet.
ALTER TABLE "TournamentMatch" ADD COLUMN "noShowEscalatedAt" TIMESTAMP(3);
