// Mission briefings (v1.36.0): one per event, written by the host's event
// creators, shown as a page and as slides (present mode). The whole briefing
// is one JSON document (EventBriefing.content), checked here on the way in.

import type { EventRole } from './index.js';
import { roleKeyOf } from './roster.js';


export type BriefingSectionKind = 'text' | 'image' | 'fleet' | 'roster';
export type BriefingLogoPosition = 'TOP_LEFT' | 'TOP_RIGHT';
export type BriefingWatermark = 'CORNER' | 'CENTER' | 'TILED' | 'NONE';

export interface BriefingSection {
  id: string;
  kind: BriefingSectionKind;
  title: string;
  /** Plain text; lines starting "- " are bullets */
  body: string;
  /** An image (map, screenshot) for image sections */
  imageUrl: string | null;
  /** Ships the organisers picked, for ship sections (v1.36.1). Nothing is filled in for them. */
  ships: BriefingShip[];
  /** Role groups, for roster sections (v1.37.0): several rosters on one slide. */
  groups: BriefingGroup[];
  /** A picture behind the slide (v1.37.0), any kind of section. */
  bgUrl: string | null;
  /** 0–100 (%) */
  bgOpacity: number;
}

/**
 * One group on a roster slide: "Ironclad crew", "Miners (Geo)", "Ground
 * defence". People come from an event role's sign-ups (roleId), plus any
 * names typed in.
 */
export interface BriefingGroup {
  id: string;
  title: string;
  /** EventRole.id (or a role's name on old events); null = names only */
  roleId: string | null;
  /** One per line */
  names: string;
  /** A ship's picture or an upload */
  imageUrl: string | null;
  /** "Ironclad Assault", "Lead: …" */
  note: string;
}

/** A ship picked for the op: a copy of its name and crew, so readers needn't load the fleet. */
export interface BriefingShip {
  shipId: string;
  name: string;
  count: number;
  crew: number | null;
  focus: string | null;
  /** "Lead: …", "Medevac", … */
  note: string;
}

export interface BriefingFact { label: string; value: string }

export interface BriefingContent {
  /** One or two sentences: what the op is for. Also shown on the Discord roster. */
  objective: string;
  /** Up to four short facts on the title slide ("Form up" → "Ruin Station, 7:45") */
  facts: BriefingFact[];
  sections: BriefingSection[];
  appearance: {
    /** null = the server's logo (GuildSettings.logoUrl) */
    logoUrl: string | null;
    /** Show allied servers' logos too on a shared event */
    allyLogos: boolean;
    logoPosition: BriefingLogoPosition;
    watermark: BriefingWatermark;
    /** 0–30 (%) */
    watermarkStrength: number;
    /** Optional banner, e.g. "ORG ONLY" */
    banner: string;
  };
}

export interface BriefingDto {
  eventId: string;
  content: BriefingContent;
  publishedAt: string | null;
  updatedAt: string;
}

export interface BriefingLogo { guildId: string; name: string; tag: string | null; logoUrl: string | null }

/** Everything the briefing page needs in one go. */
export interface BriefingViewDto {
  event: {
    id: string;
    name: string;
    startTime: string;
    endTime: string | null;
    musterPoint: string | null;
    hostGuildId: string;
    signedUp: number;
    maybe: number;
    /** The event's roles and who's signed up for each (not maybes), for roster slides. */
    roles: { id: string; name: string; count: number; people: string[] }[];
  };
  /** null when there's no briefing yet (or, for people who can't edit, none published) */
  briefing: BriefingDto | null;
  /** Host first, then servers the event is shared with */
  logos: BriefingLogo[];
  canEdit: boolean;
}

export const BRIEFING_LIMITS = {
  objective: 400,
  facts: 4,
  factLabel: 24,
  factValue: 60,
  sections: 20,
  sectionTitle: 60,
  sectionBody: 3000,
  banner: 24,
  url: 1000,
  ships: 40,
  shipCount: 99,
  shipName: 60,
  shipNote: 60,
  groups: 8,
  groupTitle: 40,
  groupNames: 600,
  groupNote: 60,
} as const;

export const BRIEFING_SECTION_KINDS: { kind: BriefingSectionKind; label: string }[] = [
  { kind: 'text', label: 'Text' },
  { kind: 'image', label: 'Map or image' },
  { kind: 'fleet', label: 'Ships (picked by you)' },
  { kind: 'roster', label: 'Role rosters' },
];

let seq = 0;
/** A short id for a new section. */
export const newSectionId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A fresh briefing: the usual sections, empty. Empty sections are left out of the slides. */
export function defaultBriefing(): BriefingContent {
  const s = (title: string, kind: BriefingSectionKind = 'text'): BriefingSection => ({ id: newSectionId(), kind, title, body: '', imageUrl: null, ships: [], groups: [], bgUrl: null, bgOpacity: 35 });
  return {
    objective: '',
    facts: [{ label: 'Form up', value: '' }, { label: 'Comms', value: '' }],
    sections: [s('Situation'), s('Area of operations', 'image'), s('Phases'), s('Force', 'fleet'), s('Comms & callsigns'), s('Rules of engagement')],
    appearance: { logoUrl: null, allyLogos: true, logoPosition: 'TOP_LEFT', watermark: 'CORNER', watermarkStrength: 7, banner: '' },
  };
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').slice(0, max) : '');
const oneLine = (v: unknown, max: number) => str(v, max).replace(/\s+/g, ' ').trim();

/** A link we'll show: our own uploads, or https. */
export function safeImageUrl(v: unknown): string | null {
  const u = typeof v === 'string' ? v.trim() : '';
  if (!u || u.length > BRIEFING_LIMITS.url) return null;
  if (u.startsWith('/uploads/') && !u.includes('..')) return u;
  return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null;
}

function sanitizeShips(v: unknown): BriefingShip[] {
  const out: BriefingShip[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    if (out.length >= BRIEFING_LIMITS.ships) break;
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const shipId = oneLine(r['shipId'], 80);
    const name = oneLine(r['name'], BRIEFING_LIMITS.shipName);
    if (!shipId || !name || out.some((x) => x.shipId === shipId)) continue;
    const n = (x: unknown, max: number) => (Number.isFinite(Number(x)) && Number(x) >= 1 ? Math.min(max, Math.round(Number(x))) : null);
    out.push({
      shipId,
      name,
      count: n(r['count'], BRIEFING_LIMITS.shipCount) ?? 1,
      crew: n(r['crew'], 999),
      focus: oneLine(r['focus'], BRIEFING_LIMITS.shipName) || null,
      note: oneLine(r['note'], BRIEFING_LIMITS.shipNote),
    });
  }
  return out;
}

function sanitizeGroups(v: unknown): BriefingGroup[] {
  const ids = new Set<string>();
  return (Array.isArray(v) ? v : []).slice(0, BRIEFING_LIMITS.groups).map((raw) => {
    const g = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    let id = oneLine(g['id'], 40).replace(/[^\w-]/g, '') || newSectionId();
    while (ids.has(id)) id = newSectionId();
    ids.add(id);
    return {
      id,
      title: oneLine(g['title'], BRIEFING_LIMITS.groupTitle),
      roleId: oneLine(g['roleId'], 80) || null,
      names: str(g['names'], BRIEFING_LIMITS.groupNames),
      imageUrl: safeImageUrl(g['imageUrl']),
      note: oneLine(g['note'], BRIEFING_LIMITS.groupNote),
    };
  });
}

/** The event's roles with who signed up for each (yeses only, in sign-up order). */
export function briefingRoles(rolesJson: string, rsvps: { role: string | null; username: string; tentative: boolean }[]): BriefingViewDto['event']['roles'] {
  let roles: EventRole[] = [];
  try { roles = JSON.parse(rolesJson || '[]') as EventRole[]; } catch { roles = []; }
  return (Array.isArray(roles) ? roles : []).filter((r) => r && r.name).map((r) => {
    const key = roleKeyOf(r);
    return { id: key, name: r.name, count: r.count ?? 0, people: rsvps.filter((x) => !x.tentative && x.role === key).map((x) => x.username) };
  });
}

/** Who's in a group: the role's sign-ups, then typed names (no repeats). */
export function groupPeople(g: BriefingGroup, roles: BriefingViewDto['event']['roles']): { people: string[]; slots: number | null } {
  const role = g.roleId ? roles.find((r) => r.id === g.roleId) : undefined;
  const people = [...(role?.people ?? [])];
  for (const line of g.names.split(/\n|,/)) {
    const n = line.trim();
    if (n && !people.some((p) => p.toLowerCase() === n.toLowerCase())) people.push(n);
  }
  // Typed names can take a group past its role's slots: then the slots stop meaning anything.
  return { people, slots: role && role.count > 0 && people.length <= role.count ? role.count : null };
}

/** Anything sent by a browser → a valid briefing (unknown fields dropped, lengths capped). */
export function sanitizeBriefing(input: unknown): BriefingContent {
  const d = defaultBriefing();
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const a = (o['appearance'] && typeof o['appearance'] === 'object' ? o['appearance'] : {}) as Record<string, unknown>;
  const ids = new Set<string>();
  const sections = (Array.isArray(o['sections']) ? o['sections'] : []).slice(0, BRIEFING_LIMITS.sections).map((raw): BriefingSection => {
    const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    let id = oneLine(s['id'], 40).replace(/[^\w-]/g, '') || newSectionId();
    while (ids.has(id)) id = newSectionId();
    ids.add(id);
    const kind: BriefingSectionKind = s['kind'] === 'image' || s['kind'] === 'fleet' || s['kind'] === 'roster' ? s['kind'] : 'text';
    const bgOpacity = Number(s['bgOpacity']);
    return {
      id,
      kind,
      title: oneLine(s['title'], BRIEFING_LIMITS.sectionTitle),
      body: str(s['body'], BRIEFING_LIMITS.sectionBody),
      imageUrl: kind === 'image' ? safeImageUrl(s['imageUrl']) : null,
      ships: kind === 'fleet' ? sanitizeShips(s['ships']) : [],
      groups: kind === 'roster' ? sanitizeGroups(s['groups']) : [],
      bgUrl: safeImageUrl(s['bgUrl']),
      bgOpacity: Number.isFinite(bgOpacity) ? Math.max(0, Math.min(100, Math.round(bgOpacity))) : 35,
    };
  });
  const facts = (Array.isArray(o['facts']) ? o['facts'] : []).slice(0, BRIEFING_LIMITS.facts).map((raw) => {
    const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return { label: oneLine(f['label'], BRIEFING_LIMITS.factLabel), value: oneLine(f['value'], BRIEFING_LIMITS.factValue) };
  });
  const strength = Number(a['watermarkStrength']);
  return {
    objective: str(o['objective'], BRIEFING_LIMITS.objective).trim(),
    facts,
    sections,
    appearance: {
      logoUrl: safeImageUrl(a['logoUrl']),
      allyLogos: typeof a['allyLogos'] === 'boolean' ? a['allyLogos'] : d.appearance.allyLogos,
      logoPosition: a['logoPosition'] === 'TOP_RIGHT' ? 'TOP_RIGHT' : 'TOP_LEFT',
      watermark: (['CORNER', 'CENTER', 'TILED', 'NONE'] as const).find((w) => w === a['watermark']) ?? 'CORNER',
      watermarkStrength: Number.isFinite(strength) ? Math.max(0, Math.min(30, Math.round(strength))) : d.appearance.watermarkStrength,
      banner: oneLine(a['banner'], BRIEFING_LIMITS.banner),
    },
  };
}

/** Stored JSON → content (old or broken rows come back as a valid briefing). */
export function parseBriefing(raw: string | null | undefined): BriefingContent {
  try {
    return sanitizeBriefing(JSON.parse(raw ?? '{}'));
  } catch {
    return sanitizeBriefing({});
  }
}

/** A section with nothing in it isn't shown (a ship section until someone picks ships or writes something). */
export const sectionHasContent = (s: BriefingSection) =>
  !!s.body.trim() || (s.kind === 'image' && !!s.imageUrl) || (s.kind === 'fleet' && s.ships.length > 0) || (s.kind === 'roster' && s.groups.length > 0);

/** The slides, in order: the title slide, then each section with something in it. */
export function briefingSlides(c: BriefingContent): ({ kind: 'title' } | { kind: 'section'; section: BriefingSection })[] {
  return [{ kind: 'title' as const }, ...c.sections.filter(sectionHasContent).map((section) => ({ kind: 'section' as const, section }))];
}

/** A body as lines and bullet lists, for the page and the slides. */
export function bodyBlocks(body: string): ({ kind: 'p'; text: string } | { kind: 'ul'; items: string[] })[] {
  const out: ({ kind: 'p'; text: string } | { kind: 'ul'; items: string[] })[] = [];
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const bullet = /^[-•*]\s+(.*)$/.exec(t);
    const last = out[out.length - 1];
    if (bullet) {
      if (last?.kind === 'ul') last.items.push(bullet[1]!);
      else out.push({ kind: 'ul', items: [bullet[1]!] });
    } else {
      out.push({ kind: 'p', text: t });
    }
  }
  return out;
}

/** The one-liner on the Discord roster (Event.briefingSummary). */
export function briefingSummary(c: BriefingContent): string {
  const objective = c.objective.replace(/\s+/g, ' ').trim();
  return objective.length > 300 ? `${objective.slice(0, 299)}…` : objective;
}

/** Totals for a ship section: hulls and crew seats. */
export function forceTotals(ships: BriefingShip[]): { ships: number; seats: number } {
  return {
    ships: ships.reduce((n, s) => n + s.count, 0),
    seats: ships.reduce((n, s) => n + (s.crew ?? 1) * s.count, 0),
  };
}
