-- Allow H2H (out-of-tournament) matches by making matchId and tournamentId optional.
-- Add isH2H flag so the history feed can distinguish standalone matches from bracket results.

ALTER TABLE "TournamentRatingHistory" ALTER COLUMN "matchId" DROP NOT NULL;
ALTER TABLE "TournamentRatingHistory" ALTER COLUMN "tournamentId" DROP NOT NULL;
ALTER TABLE "TournamentRatingHistory" ADD COLUMN "isH2H" BOOLEAN NOT NULL DEFAULT false;
