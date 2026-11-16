// Event templates (v1.41.0): what a template looks like to the website, and
// what happens when an event is made from one.
//
// Two kinds share the EventTemplate table:
// - Repeat's own (curated = false): made silently by Repeat, keyed on the
//   source event, refreshed from each event made from them.
// - Curated (curated = true): made or edited on the Templates page or with
//   "Save as template". Nothing overwrites them except someone editing them.
// A template's briefing is copied into each new event as an unpublished draft.

import { randomUUID } from 'node:crypto';
import type { EventTemplate } from '@prisma/client';
import {
  parseBriefing, remapBriefingRoles, sanitizeBriefing,
  type EventRole, type EventTemplateDto,
} from '@dem/shared';
import { prisma } from './prisma.js';
import { ValidationError } from './validate.js';

export const SIX_MONTHS_MS = 183 * 24 * 60 * 60_000;

export function parseRoles(json: string | null | undefined): EventRole[] {
  try {
    const v = JSON.parse(json || '[]') as unknown;
    return Array.isArray(v) ? (v as EventRole[]) : [];
  } catch {
    return [];
  }
}

export function templateDto(
  t: EventTemplate,
  guildId: string,
  uses: { usedAt: Date }[],
): EventTemplateDto {
  const recent = uses.filter((u) => u.usedAt.getTime() >= Date.now() - SIX_MONTHS_MS);
  const last = uses.reduce<Date | null>((m, u) => (!m || u.usedAt > m ? u.usedAt : m), null);
  return {
    id: t.id,
    guildId,
    name: t.name,
    description: t.description,
    musterPoint: t.musterPoint,
    roles: parseRoles(t.roles),
    vcNames: JSON.parse(t.vcNames || '[]') as string[],
    briefingChannel: t.briefingChannel,
    imageUrl: t.imageUrl,
    rosterSlots: JSON.parse(t.rosterSlots || '[]'),
    reminderMinutes: JSON.parse(t.reminderMinutes || '[]'),
    defaultDuration: t.defaultDuration,
    isActive: t.isActive,
    createdById: t.createdById,
    useCount: recent.length,
    curated: t.curated,
    hasBriefing: !!t.briefing,
    lastUsedAt: last ? last.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** Roles from a browser: names trimmed, counts 1–99, every role with an id. */
export function cleanRoles(v: unknown): EventRole[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ValidationError('roles must be an array');
  if (v.length > 50) throw new ValidationError('roles must have at most 50 items');
  const out: EventRole[] = [];
  for (const raw of v) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const name = typeof r['name'] === 'string' ? r['name'].trim().slice(0, 100) : '';
    if (!name) continue;
    const count = Math.max(1, Math.min(99, Math.round(Number(r['count']) || 1)));
    const id = typeof r['id'] === 'string' && r['id'].trim() ? r['id'].trim().slice(0, 64) : randomUUID();
    const guildId = typeof r['guildId'] === 'string' && /^\d{5,25}$/.test(r['guildId']) ? r['guildId'] : null;
    if (out.some((o) => o.id === id)) continue;
    out.push({ id, name, count, ...(guildId ? { guildId } : {}) });
  }
  return out;
}

/**
 * An event was just made from a template: remember which, count the use,
 * copy the template's briefing in as a draft (roster groups re-linked to the
 * event's roles), and, for Repeat's own templates only, refresh the template
 * from the event.
 */
export async function applyTemplateToNewEvent(opts: {
  templateId: string;
  hostGuildDbId: string;
  event: { id: string; description: string | null; musterPoint: string | null; roles: string; vcNames: string; briefingChannel: boolean; imageUrl: string | null };
  byDiscordId: string;
}): Promise<void> {
  const tmpl = await prisma.eventTemplate.findFirst({ where: { id: opts.templateId, guildId: opts.hostGuildDbId } });
  if (!tmpl) return;
  const { event } = opts;
  await prisma.event.update({ where: { id: event.id }, data: { templateId: tmpl.id } });
  await prisma.eventTemplateUse.create({ data: { templateId: tmpl.id } });

  if (!tmpl.curated) {
    // Repeat's own templates follow the latest event (the name stays: identity
    // is the source event).
    await prisma.eventTemplate.update({
      where: { id: tmpl.id },
      data: {
        description: event.description,
        musterPoint: event.musterPoint,
        roles: event.roles,
        vcNames: event.vcNames,
        briefingChannel: event.briefingChannel,
        imageUrl: event.imageUrl,
      },
    });
  }

  const content = tmpl.briefing ? parseBriefing(tmpl.briefing) : null;
  if (content) {
    const remapped = sanitizeBriefing(remapBriefingRoles(content, parseRoles(tmpl.roles), parseRoles(event.roles)));
    await prisma.eventBriefing.upsert({
      where: { eventId: event.id },
      create: { eventId: event.id, content: JSON.stringify(remapped), updatedBy: opts.byDiscordId },
      update: {},
    });
  }
}
