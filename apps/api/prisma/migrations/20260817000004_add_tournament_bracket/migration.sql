-- Tournament Bracket Module
-- Adds: Tournament, TournamentParticipant, TournamentTeamMember, TournamentMatch,
--       TournamentReminder, TournamentSeason, TournamentSeasonLink,
--       TournamentPlayerRating, TournamentSeasonStanding, TournamentRatingHistory.
-- Also adds: tournamentsEnabled toggle to GuildSettings.

-- Module toggle on GuildSettings
ALTER TABLE "GuildSettings" ADD COLUMN "tournamentsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Tournament
CREATE TABLE "Tournament" (
  "id"                 TEXT         NOT NULL,
  "guildId"            TEXT         NOT NULL,
  "name"               TEXT         NOT NULL,
  "description"        TEXT,
  "format"             TEXT         NOT NULL DEFAULT 'SINGLE_ELIM',
  "participantMode"    TEXT         NOT NULL DEFAULT 'INDIVIDUAL',
  "size"               INTEGER      NOT NULL DEFAULT 8,
  "status"             TEXT         NOT NULL DEFAULT 'DRAFT',
  "seedingMode"        TEXT         NOT NULL DEFAULT 'RANDOM',
  "dkpPrize1st"        INTEGER      NOT NULL DEFAULT 0,
  "dkpPrize2nd"        INTEGER      NOT NULL DEFAULT 0,
  "dkpPrize3rd"        INTEGER      NOT NULL DEFAULT 0,
  "channelId"          TEXT,
  "threadId"           TEXT,
  "bracketMessageId"   TEXT,
  "registrationEndsAt" TIMESTAMP(3),
  "startedAt"          TIMESTAMP(3),
  "completedAt"        TIMESTAMP(3),
  "createdById"        TEXT         NOT NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Tournament_guildId_idx"        ON "Tournament"("guildId");
CREATE INDEX "Tournament_guildId_status_idx" ON "Tournament"("guildId", "status");

-- TournamentParticipant
CREATE TABLE "TournamentParticipant" (
  "id"           TEXT         NOT NULL,
  "tournamentId" TEXT         NOT NULL,
  "displayName"  TEXT         NOT NULL,
  "discordId"    TEXT,
  "seed"         INTEGER,
  "status"       TEXT         NOT NULL DEFAULT 'ACTIVE',
  "inLosers"     BOOLEAN      NOT NULL DEFAULT false,
  "placement"    INTEGER,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TournamentParticipant_pkey"                      PRIMARY KEY ("id"),
  CONSTRAINT "TournamentParticipant_tournamentId_discordId_key" UNIQUE ("tournamentId", "discordId"),
  CONSTRAINT "TournamentParticipant_tournamentId_fkey"          FOREIGN KEY ("tournamentId")
    REFERENCES "Tournament"("id") ON DELETE CASCADE
);
CREATE INDEX "TournamentParticipant_tournamentId_idx" ON "TournamentParticipant"("tournamentId");

-- TournamentTeamMember
CREATE TABLE "TournamentTeamMember" (
  "id"            TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "discordId"     TEXT NOT NULL,
  "displayName"   TEXT NOT NULL,
  CONSTRAINT "TournamentTeamMember_pkey"                      PRIMARY KEY ("id"),
  CONSTRAINT "TournamentTeamMember_participantId_discordId_key" UNIQUE ("participantId", "discordId"),
  CONSTRAINT "TournamentTeamMember_participantId_fkey"          FOREIGN KEY ("participantId")
    REFERENCES "TournamentParticipant"("id") ON DELETE CASCADE
);

-- TournamentMatch
CREATE TABLE "TournamentMatch" (
  "id"               TEXT         NOT NULL,
  "tournamentId"     TEXT         NOT NULL,
  "round"            INTEGER      NOT NULL,
  "position"         INTEGER      NOT NULL,
  "bracketSide"      TEXT         NOT NULL DEFAULT 'WINNERS',
  "participantAId"   TEXT,
  "participantBId"   TEXT,
  "winnerId"         TEXT,
  "scoreA"           INTEGER,
  "scoreB"           INTEGER,
  "status"           TEXT         NOT NULL DEFAULT 'PENDING',
  "nextMatchId"      TEXT,
  "nextLoserMatchId" TEXT,
  "scheduledAt"      TIMESTAMP(3),
  "readyA"           BOOLEAN      NOT NULL DEFAULT false,
  "readyB"           BOOLEAN      NOT NULL DEFAULT false,
  "checkedInA"       BOOLEAN      NOT NULL DEFAULT false,
  "checkedInB"       BOOLEAN      NOT NULL DEFAULT false,
  "resultPostedAt"   TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TournamentMatch_pkey"             PRIMARY KEY ("id"),
  CONSTRAINT "TournamentMatch_tournamentId_fkey"   FOREIGN KEY ("tournamentId")
    REFERENCES "Tournament"("id") ON DELETE CASCADE,
  CONSTRAINT "TournamentMatch_participantAId_fkey" FOREIGN KEY ("participantAId")
    REFERENCES "TournamentParticipant"("id"),
  CONSTRAINT "TournamentMatch_participantBId_fkey" FOREIGN KEY ("participantBId")
    REFERENCES "TournamentParticipant"("id"),
  CONSTRAINT "TournamentMatch_winnerId_fkey"        FOREIGN KEY ("winnerId")
    REFERENCES "TournamentParticipant"("id")
);
CREATE INDEX "TournamentMatch_tournamentId_round_idx"       ON "TournamentMatch"("tournamentId", "round");
CREATE INDEX "TournamentMatch_scheduledAt_status_idx"       ON "TournamentMatch"("scheduledAt", "status");
CREATE INDEX "TournamentMatch_tournamentId_bracketSide_idx" ON "TournamentMatch"("tournamentId", "bracketSide");

-- TournamentReminder
CREATE TABLE "TournamentReminder" (
  "id"           TEXT         NOT NULL,
  "tournamentId" TEXT         NOT NULL,
  "matchId"      TEXT,
  "type"         TEXT         NOT NULL,
  "scheduledAt"  TIMESTAMP(3) NOT NULL,
  "sentAt"       TIMESTAMP(3),
  CONSTRAINT "TournamentReminder_pkey"             PRIMARY KEY ("id"),
  CONSTRAINT "TournamentReminder_tournamentId_fkey" FOREIGN KEY ("tournamentId")
    REFERENCES "Tournament"("id") ON DELETE CASCADE
);
CREATE INDEX "TournamentReminder_scheduledAt_sentAt_idx" ON "TournamentReminder"("scheduledAt", "sentAt");
CREATE INDEX "TournamentReminder_tournamentId_idx"       ON "TournamentReminder"("tournamentId");

-- TournamentSeason
CREATE TABLE "TournamentSeason" (
  "id"        TEXT         NOT NULL,
  "guildId"   TEXT         NOT NULL,
  "name"      TEXT         NOT NULL,
  "status"    TEXT         NOT NULL DEFAULT 'ACTIVE',
  "startsAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TournamentSeason_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TournamentSeason_guildId_idx"        ON "TournamentSeason"("guildId");
CREATE INDEX "TournamentSeason_guildId_status_idx" ON "TournamentSeason"("guildId", "status");

-- TournamentSeasonLink (composite PK)
CREATE TABLE "TournamentSeasonLink" (
  "seasonId"     TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  CONSTRAINT "TournamentSeasonLink_pkey"             PRIMARY KEY ("seasonId", "tournamentId"),
  CONSTRAINT "TournamentSeasonLink_seasonId_fkey"     FOREIGN KEY ("seasonId")
    REFERENCES "TournamentSeason"("id") ON DELETE CASCADE,
  CONSTRAINT "TournamentSeasonLink_tournamentId_fkey" FOREIGN KEY ("tournamentId")
    REFERENCES "Tournament"("id") ON DELETE CASCADE
);

-- TournamentPlayerRating (all-time ELO per player per guild)
CREATE TABLE "TournamentPlayerRating" (
  "id"            TEXT         NOT NULL,
  "guildId"       TEXT         NOT NULL,
  "discordId"     TEXT         NOT NULL,
  "displayName"   TEXT         NOT NULL,
  "rating"        INTEGER      NOT NULL DEFAULT 1200,
  "matchesPlayed" INTEGER      NOT NULL DEFAULT 0,
  "wins"          INTEGER      NOT NULL DEFAULT 0,
  "losses"        INTEGER      NOT NULL DEFAULT 0,
  "peakRating"    INTEGER      NOT NULL DEFAULT 1200,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TournamentPlayerRating_pkey"                  PRIMARY KEY ("id"),
  CONSTRAINT "TournamentPlayerRating_guildId_discordId_key" UNIQUE ("guildId", "discordId")
);
CREATE INDEX "TournamentPlayerRating_guildId_rating_idx" ON "TournamentPlayerRating"("guildId", "rating");

-- TournamentSeasonStanding (per-season ELO; resets to 1200 each new season)
CREATE TABLE "TournamentSeasonStanding" (
  "id"            TEXT    NOT NULL,
  "seasonId"      TEXT    NOT NULL,
  "guildId"       TEXT    NOT NULL,
  "discordId"     TEXT    NOT NULL,
  "displayName"   TEXT    NOT NULL,
  "rating"        INTEGER NOT NULL DEFAULT 1200,
  "matchesPlayed" INTEGER NOT NULL DEFAULT 0,
  "wins"          INTEGER NOT NULL DEFAULT 0,
  "losses"        INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "TournamentSeasonStanding_pkey"                PRIMARY KEY ("id"),
  CONSTRAINT "TournamentSeasonStanding_seasonId_discordId_key" UNIQUE ("seasonId", "discordId"),
  CONSTRAINT "TournamentSeasonStanding_seasonId_fkey"        FOREIGN KEY ("seasonId")
    REFERENCES "TournamentSeason"("id") ON DELETE CASCADE
);
CREATE INDEX "TournamentSeasonStanding_seasonId_rating_idx" ON "TournamentSeasonStanding"("seasonId", "rating");

-- TournamentRatingHistory (ELO change audit trail)
CREATE TABLE "TournamentRatingHistory" (
  "id"                   TEXT         NOT NULL,
  "ratingId"             TEXT         NOT NULL,
  "matchId"              TEXT         NOT NULL,
  "tournamentId"         TEXT         NOT NULL,
  "ratingBefore"         INTEGER      NOT NULL,
  "ratingAfter"          INTEGER      NOT NULL,
  "delta"                INTEGER      NOT NULL,
  "won"                  BOOLEAN      NOT NULL,
  "opponentName"         TEXT,
  "opponentRatingBefore" INTEGER,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TournamentRatingHistory_pkey"      PRIMARY KEY ("id"),
  CONSTRAINT "TournamentRatingHistory_ratingId_fkey" FOREIGN KEY ("ratingId")
    REFERENCES "TournamentPlayerRating"("id") ON DELETE CASCADE
);
CREATE INDEX "TournamentRatingHistory_ratingId_createdAt_idx" ON "TournamentRatingHistory"("ratingId", "createdAt");
CREATE INDEX "TournamentRatingHistory_tournamentId_idx"       ON "TournamentRatingHistory"("tournamentId");
