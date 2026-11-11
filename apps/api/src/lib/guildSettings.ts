// A server's settings: validating a change and saving it, used by the
// server's own settings pages (routes/settings.ts) and by the admin panel
// (routes/admin.ts), so both follow exactly the same rules and side effects.
// Moved out of routes/settings.ts unchanged in v1.13.0.

import { prisma } from './prisma.js';
import { triggerBot } from './triggerBot.js';
import { optStr, optStrArr, optBool, optNonNegInt, requireStr } from './validate.js';

export type SettingsPatch = {
    forumChannelId?: string | null;
    eventChannelId?: string | null;
    voiceCategoryId?: string | null;
    lootChannelId?: string | null;
    dkpAnnouncementChannelId?: string | null;
    timezone?: string;
    eventCreatorRoles?: string[];
    moduleEditorRoles?: string[];
    viewerRoles?: string[];
    dkpLabel?: string;
    lootDraftCreatorRoles?: string[];
    allianceManagerRoles?: string[];
    eventBotEnabled?: boolean;
    dkpEnabled?: boolean;
    lootEnabled?: boolean;
    exchangeEnabled?: boolean;
    fleetEnabled?: boolean;
    blueprintsEnabled?: boolean;
    craftingEnabled?: boolean;
    activityEnabled?: boolean;
    activityHeatmapPublic?: boolean;
    tournamentsEnabled?: boolean;
    tournamentHideElo?: boolean;
    tournamentChannelId?: string | null;
    h2hChannelId?: string | null;
    statusChannelId?: string | null;
    allyNoticeChannelId?: string | null;
    jobsEnabled?: boolean;
    jobsChannelId?: string | null;
    dkpDefaultAuctionDuration?: number;
    dkpMinBid?: number;
    lootDefaultMethod?: string;
    rsiOrgTag?: string | null;
    allianceTag?: string | null;
  };

/** Validates a settings change from a request body (throws ValidationError). Unknown keys are ignored. */
export function parseSettingsPatch(raw: Record<string, unknown>): SettingsPatch {
  const rawDur = raw.dkpDefaultAuctionDuration !== undefined ? optNonNegInt(raw.dkpDefaultAuctionDuration, 'dkpDefaultAuctionDuration') : undefined;
  const rawMin = raw.dkpMinBid !== undefined ? optNonNegInt(raw.dkpMinBid, 'dkpMinBid') : undefined;
  const LOOT_METHODS = ['RANDOM_ROLL', 'DKP', 'SNAKE_DRAFT'] as const;
  return {
    forumChannelId:            raw.forumChannelId !== undefined ? optStr(raw.forumChannelId, 'forumChannelId', 30) : undefined,
    eventChannelId:            raw.eventChannelId !== undefined ? optStr(raw.eventChannelId, 'eventChannelId', 30) : undefined,
    voiceCategoryId:           raw.voiceCategoryId !== undefined ? optStr(raw.voiceCategoryId, 'voiceCategoryId', 30) : undefined,
    lootChannelId:             raw.lootChannelId !== undefined ? optStr(raw.lootChannelId, 'lootChannelId', 30) : undefined,
    dkpAnnouncementChannelId:  raw.dkpAnnouncementChannelId !== undefined ? optStr(raw.dkpAnnouncementChannelId, 'dkpAnnouncementChannelId', 30) : undefined,
    timezone:                  raw.timezone !== undefined ? requireStr(raw.timezone, 'timezone', 60) : undefined,
    eventCreatorRoles:         raw.eventCreatorRoles !== undefined ? optStrArr(raw.eventCreatorRoles, 'eventCreatorRoles', 100, 30) : undefined,
    moduleEditorRoles:         raw.moduleEditorRoles !== undefined ? optStrArr(raw.moduleEditorRoles, 'moduleEditorRoles', 100, 30) : undefined,
    viewerRoles:               raw.viewerRoles !== undefined ? optStrArr(raw.viewerRoles, 'viewerRoles', 100, 30) : undefined,
    dkpLabel:                  raw.dkpLabel !== undefined ? requireStr(raw.dkpLabel, 'dkpLabel', 30) : undefined,
    lootDraftCreatorRoles:     raw.lootDraftCreatorRoles !== undefined ? optStrArr(raw.lootDraftCreatorRoles, 'lootDraftCreatorRoles', 100, 30) : undefined,
    allianceManagerRoles:      raw.allianceManagerRoles !== undefined ? optStrArr(raw.allianceManagerRoles, 'allianceManagerRoles', 100, 30) : undefined,
    eventBotEnabled:           raw.eventBotEnabled !== undefined ? optBool(raw.eventBotEnabled, 'eventBotEnabled') : undefined,
    dkpEnabled:                raw.dkpEnabled !== undefined ? optBool(raw.dkpEnabled, 'dkpEnabled') : undefined,
    lootEnabled:               raw.lootEnabled !== undefined ? optBool(raw.lootEnabled, 'lootEnabled') : undefined,
    exchangeEnabled:           raw.exchangeEnabled !== undefined ? optBool(raw.exchangeEnabled, 'exchangeEnabled') : undefined,
    fleetEnabled:              raw.fleetEnabled !== undefined ? optBool(raw.fleetEnabled, 'fleetEnabled') : undefined,
    blueprintsEnabled:         raw.blueprintsEnabled !== undefined ? optBool(raw.blueprintsEnabled, 'blueprintsEnabled') : undefined,
    craftingEnabled:           raw.craftingEnabled !== undefined ? optBool(raw.craftingEnabled, 'craftingEnabled') : undefined,
    activityEnabled:           raw.activityEnabled !== undefined ? optBool(raw.activityEnabled, 'activityEnabled') : undefined,
    activityHeatmapPublic:     raw.activityHeatmapPublic !== undefined ? optBool(raw.activityHeatmapPublic, 'activityHeatmapPublic') : undefined,
    tournamentsEnabled:        raw.tournamentsEnabled !== undefined ? optBool(raw.tournamentsEnabled, 'tournamentsEnabled') : undefined,
    tournamentHideElo:         raw.tournamentHideElo !== undefined ? optBool(raw.tournamentHideElo, 'tournamentHideElo') : undefined,
    tournamentChannelId:       raw.tournamentChannelId !== undefined ? optStr(raw.tournamentChannelId, 'tournamentChannelId', 30) : undefined,
    h2hChannelId:              raw.h2hChannelId !== undefined ? optStr(raw.h2hChannelId, 'h2hChannelId', 30) : undefined,
    statusChannelId:           raw.statusChannelId !== undefined ? optStr(raw.statusChannelId, 'statusChannelId', 30) : undefined,
    allyNoticeChannelId:       raw.allyNoticeChannelId !== undefined ? optStr(raw.allyNoticeChannelId, 'allyNoticeChannelId', 30) : undefined,
    jobsEnabled:               raw.jobsEnabled !== undefined ? optBool(raw.jobsEnabled, 'jobsEnabled') : undefined,
    jobsChannelId:             raw.jobsChannelId !== undefined ? optStr(raw.jobsChannelId, 'jobsChannelId', 30) : undefined,
    dkpDefaultAuctionDuration: rawDur !== undefined ? Math.min(168, Math.max(1, rawDur)) : undefined,
    dkpMinBid:                 rawMin !== undefined ? Math.max(0, rawMin) : undefined,
    lootDefaultMethod:         raw.lootDefaultMethod !== undefined && LOOT_METHODS.includes(raw.lootDefaultMethod as typeof LOOT_METHODS[number]) ? raw.lootDefaultMethod as string : undefined,
    rsiOrgTag:                 raw.rsiOrgTag !== undefined ? optStr(raw.rsiOrgTag, 'rsiOrgTag', 20) : undefined,
    allianceTag:               raw.allianceTag !== undefined ? optStr(raw.allianceTag, 'allianceTag', 4) : undefined,
  };
}

/** Module toggles, roles, the currency label…: only the server's managers may change these. */
export function patchNeedsManager(patch: SettingsPatch): boolean {
  return (patch.moduleEditorRoles !== undefined ||
    patch.viewerRoles !== undefined ||
    patch.dkpLabel !== undefined ||
    patch.lootDraftCreatorRoles !== undefined ||
    patch.allianceManagerRoles !== undefined ||
    patch.eventBotEnabled !== undefined ||
    patch.dkpEnabled !== undefined ||
    patch.lootEnabled !== undefined ||
    patch.exchangeEnabled !== undefined ||
    patch.fleetEnabled !== undefined ||
    patch.blueprintsEnabled !== undefined ||
    patch.craftingEnabled !== undefined ||
    patch.activityEnabled !== undefined ||
    patch.activityHeatmapPublic !== undefined ||
    patch.tournamentsEnabled !== undefined ||
    patch.jobsEnabled !== undefined);
}

export interface PermissionFields {
  eventCreatorRoles: string[];
  moduleEditorRoles: string[];
  viewerRoles: string[];
}

export async function readPermissionFields(settingsId: string): Promise<PermissionFields & { dkpLabel: string; lootDraftCreatorRoles: string[]; allianceManagerRoles: string[] }> {
  const settings = await prisma.guildSettings.findUnique({
    where: { id: settingsId },
    select: { eventCreatorRoles: true, moduleEditorRoles: true, viewerRoles: true, dkpLabel: true, lootDraftCreatorRoles: true, allianceManagerRoles: true } as Record<string, boolean>,
  });
  const s = settings as unknown as Record<string, string | undefined>;
  return {
    eventCreatorRoles:      JSON.parse(s['eventCreatorRoles']      ?? '[]') as string[],
    moduleEditorRoles:      JSON.parse(s['moduleEditorRoles']      ?? '[]') as string[],
    viewerRoles:            JSON.parse(s['viewerRoles']            ?? '[]') as string[],
    dkpLabel:               s['dkpLabel'] ?? 'DKP',
    lootDraftCreatorRoles:  JSON.parse(s['lootDraftCreatorRoles']  ?? '[]') as string[],
    allianceManagerRoles:   JSON.parse(s['allianceManagerRoles']   ?? '[]') as string[],
  };
}

/** Saves a validated change for a server (Discord id) and runs its side effects. Null if the bot isn't in that server. */
export async function applySettingsPatch(guildId: string, patch: SettingsPatch) {
  const guild = await prisma.guild.findUnique({ where: { guildId } });
  if (!guild) return null;

  const s = await prisma.guildSettings.upsert({
    where: { guildId: guild.id },
    update: {
      ...(patch.forumChannelId !== undefined            ? { forumChannelId: patch.forumChannelId }                                   : {}),
      ...(patch.eventChannelId !== undefined            ? { eventChannelId: patch.eventChannelId }                                   : {}),
      ...(patch.voiceCategoryId !== undefined           ? { voiceCategoryId: patch.voiceCategoryId }                                 : {}),
      ...(patch.lootChannelId !== undefined             ? { lootChannelId: patch.lootChannelId }                                     : {}),
      ...(patch.dkpAnnouncementChannelId !== undefined  ? { dkpAnnouncementChannelId: patch.dkpAnnouncementChannelId }               : {}),
      ...(patch.timezone !== undefined                  ? { timezone: patch.timezone }                                               : {}),
      ...(patch.eventCreatorRoles !== undefined         ? { eventCreatorRoles: JSON.stringify(patch.eventCreatorRoles) }             : {}),
      ...(patch.moduleEditorRoles !== undefined         ? { moduleEditorRoles: JSON.stringify(patch.moduleEditorRoles) }             : {}),
      ...(patch.viewerRoles !== undefined               ? { viewerRoles: JSON.stringify(patch.viewerRoles) }                         : {}),
      ...(patch.dkpLabel !== undefined                  ? { dkpLabel: patch.dkpLabel }                                               : {}),
      ...(patch.lootDraftCreatorRoles !== undefined     ? { lootDraftCreatorRoles: JSON.stringify(patch.lootDraftCreatorRoles) }     : {}),
      ...(patch.allianceManagerRoles !== undefined      ? { allianceManagerRoles:  JSON.stringify(patch.allianceManagerRoles) }      : {}),
      ...(patch.eventBotEnabled !== undefined           ? { eventBotEnabled: patch.eventBotEnabled }                                 : {}),
      ...(patch.dkpEnabled !== undefined                ? { dkpEnabled: patch.dkpEnabled }                                           : {}),
      ...(patch.lootEnabled !== undefined               ? { lootEnabled: patch.lootEnabled }                                         : {}),
      ...(patch.exchangeEnabled !== undefined           ? { exchangeEnabled: patch.exchangeEnabled }                                 : {}),
      ...(patch.fleetEnabled !== undefined              ? { fleetEnabled: patch.fleetEnabled }                                       : {}),
      ...(patch.blueprintsEnabled !== undefined         ? { blueprintsEnabled: patch.blueprintsEnabled }                             : {}),
      ...(patch.craftingEnabled !== undefined           ? { craftingEnabled: patch.craftingEnabled }                                 : {}),
      ...(patch.activityEnabled !== undefined           ? { activityEnabled: patch.activityEnabled }                                 : {}),
      ...(patch.activityHeatmapPublic !== undefined     ? { activityHeatmapPublic: patch.activityHeatmapPublic }                     : {}),
      ...(patch.tournamentsEnabled !== undefined         ? { tournamentsEnabled: patch.tournamentsEnabled }                           : {}),
      ...(patch.tournamentHideElo !== undefined          ? { tournamentHideElo: patch.tournamentHideElo }                               : {}),
      ...(patch.tournamentChannelId !== undefined        ? { tournamentChannelId: patch.tournamentChannelId }                         : {}),
      ...(patch.h2hChannelId !== undefined               ? { h2hChannelId: patch.h2hChannelId }                                       : {}),
      ...(patch.statusChannelId !== undefined            ? { statusChannelId: patch.statusChannelId }                                 : {}),
      ...(patch.allyNoticeChannelId !== undefined        ? { allyNoticeChannelId: patch.allyNoticeChannelId }                         : {}),
      ...(patch.jobsEnabled !== undefined                ? { jobsEnabled: patch.jobsEnabled }                                         : {}),
      ...(patch.jobsChannelId !== undefined              ? { jobsChannelId: patch.jobsChannelId }                                     : {}),
      ...(patch.dkpDefaultAuctionDuration !== undefined ? { dkpDefaultAuctionDuration: patch.dkpDefaultAuctionDuration }             : {}),
      ...(patch.dkpMinBid !== undefined                 ? { dkpMinBid: patch.dkpMinBid }                                             : {}),
      ...(patch.lootDefaultMethod !== undefined         ? { lootDefaultMethod: patch.lootDefaultMethod }                             : {}),
      ...(patch.rsiOrgTag !== undefined                 ? { rsiOrgTag: patch.rsiOrgTag }                                             : {}),
      ...(patch.allianceTag !== undefined               ? { allianceTag: patch.allianceTag }                                         : {}),
    },
    create: {
      guildId:                    guild.id,
      forumChannelId:             patch.forumChannelId             ?? null,
      eventChannelId:             patch.eventChannelId             ?? null,
      voiceCategoryId:            patch.voiceCategoryId            ?? null,
      lootChannelId:              patch.lootChannelId              ?? null,
      dkpAnnouncementChannelId:   patch.dkpAnnouncementChannelId   ?? null,
      timezone:                   patch.timezone                   ?? 'UTC',
      eventCreatorRoles:          JSON.stringify(patch.eventCreatorRoles          ?? []),
      moduleEditorRoles:          JSON.stringify(patch.moduleEditorRoles          ?? []),
      viewerRoles:                JSON.stringify(patch.viewerRoles                ?? []),
      dkpLabel:                   patch.dkpLabel                   ?? 'DKP',
      lootDraftCreatorRoles:      JSON.stringify(patch.lootDraftCreatorRoles      ?? []),
      allianceManagerRoles:       JSON.stringify(patch.allianceManagerRoles       ?? []),
      eventBotEnabled:            patch.eventBotEnabled            ?? true,
      dkpEnabled:                 patch.dkpEnabled                 ?? true,
      lootEnabled:                patch.lootEnabled                ?? true,
      exchangeEnabled:            patch.exchangeEnabled            ?? true,
      fleetEnabled:               patch.fleetEnabled               ?? true,
      blueprintsEnabled:          patch.blueprintsEnabled          ?? true,
      craftingEnabled:            patch.craftingEnabled            ?? true,
      activityEnabled:            patch.activityEnabled            ?? true,
      activityHeatmapPublic:      patch.activityHeatmapPublic      ?? true,
      tournamentsEnabled:         patch.tournamentsEnabled          ?? true,
      tournamentHideElo:          patch.tournamentHideElo           ?? false,
      tournamentChannelId:        patch.tournamentChannelId         ?? null,
      h2hChannelId:               patch.h2hChannelId                ?? null,
      statusChannelId:            patch.statusChannelId             ?? null,
      allyNoticeChannelId:        patch.allyNoticeChannelId         ?? null,
      jobsEnabled:                patch.jobsEnabled                 ?? true,
      jobsChannelId:              patch.jobsChannelId               ?? null,
      dkpDefaultAuctionDuration:  patch.dkpDefaultAuctionDuration  ?? 24,
      dkpMinBid:                  patch.dkpMinBid                  ?? 0,
      lootDefaultMethod:          patch.lootDefaultMethod          ?? 'RANDOM_ROLL',
      rsiOrgTag:                  patch.rsiOrgTag                  ?? null,
      allianceTag:                patch.allianceTag                ?? null,
    },
  });

  const { eventCreatorRoles, moduleEditorRoles, viewerRoles, dkpLabel, lootDraftCreatorRoles, allianceManagerRoles } = await readPermissionFields(s.id);
  // The bot keeps the status channel settings in memory; tell it when one changes.
  if (patch.statusChannelId !== undefined) triggerBot('/trigger/status');
  // A new forum channel: events still waiting for their thread get a fresh set of setup attempts (v1.11.1).
  if (patch.forumChannelId !== undefined) {
    await prisma.event.updateMany({
      where: { guildId, status: { in: ['PENDING', 'ACTIVE'] }, threadId: null },
      data: { setupAttempts: 0, nextSetupAt: null },
    });
  }

  return {
      forumChannelId:             s.forumChannelId             ?? null,
      eventChannelId:             s.eventChannelId             ?? null,
      voiceCategoryId:            s.voiceCategoryId            ?? null,
      lootChannelId:              s.lootChannelId              ?? null,
      dkpAnnouncementChannelId:   s.dkpAnnouncementChannelId   ?? null,
      timezone:                   s.timezone                   ?? 'UTC',
      eventCreatorRoles,
      moduleEditorRoles,
      viewerRoles,
      dkpLabel,
      lootDraftCreatorRoles,
      allianceManagerRoles,
      eventBotEnabled:            s.eventBotEnabled            ?? true,
      dkpEnabled:                 s.dkpEnabled                 ?? true,
      lootEnabled:                s.lootEnabled                ?? true,
      exchangeEnabled:            s.exchangeEnabled            ?? true,
      fleetEnabled:               s.fleetEnabled               ?? true,
      blueprintsEnabled:          s.blueprintsEnabled          ?? true,
      craftingEnabled:            s.craftingEnabled            ?? true,
      activityEnabled:            s.activityEnabled            ?? true,
      activityHeatmapPublic:      s.activityHeatmapPublic      ?? true,
      tournamentsEnabled:         s.tournamentsEnabled          ?? true,
      tournamentHideElo:          s.tournamentHideElo           ?? false,
      tournamentChannelId:        s.tournamentChannelId         ?? null,
      h2hChannelId:               s.h2hChannelId                ?? null,
      statusChannelId:            s.statusChannelId             ?? null,
      allyNoticeChannelId:        s.allyNoticeChannelId         ?? null,
      dkpDefaultAuctionDuration:  s.dkpDefaultAuctionDuration  ?? 24,
      dkpMinBid:                  s.dkpMinBid                  ?? 0,
      lootDefaultMethod:          s.lootDefaultMethod          ?? 'RANDOM_ROLL',
      rsiOrgTag:                  s.rsiOrgTag                  ?? null,
      allianceTag:                s.allianceTag                ?? null,
    };
}

export type GuildSettingsView = NonNullable<Awaited<ReturnType<typeof applySettingsPatch>>>;
