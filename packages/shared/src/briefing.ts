// Mission briefings (v1.36.0): one per event, written by the host's event
// creators, shown as a page and as slides (present mode). The whole briefing
// is one JSON document (EventBriefing.content), checked here on the way in.


export type BriefingSectionKind = 'text' | 'image' | 'fleet';
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
} as const;

export const BRIEFING_SECTION_KINDS: { kind: BriefingSectionKind; label: string }[] = [
  { kind: 'text', label: 'Text' },
  { kind: 'image', label: 'Map or image' },
  { kind: 'fleet', label: 'Ships (picked by you)' },
];

let seq = 0;
/** A short id for a new section. */
export const newSectionId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A fresh briefing: the usual sections, empty. Empty sections are left out of the slides. */
export function defaultBriefing(): BriefingContent {
  const s = (title: string, kind: BriefingSectionKind = 'text'): BriefingSection => ({ id: newSectionId(), kind, title, body: '', imageUrl: null, ships: [] });
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
    const kind: BriefingSectionKind = s['kind'] === 'image' || s['kind'] === 'fleet' ? s['kind'] : 'text';
    return {
      id,
      kind,
      title: oneLine(s['title'], BRIEFING_LIMITS.sectionTitle),
      body: str(s['body'], BRIEFING_LIMITS.sectionBody),
      imageUrl: kind === 'image' ? safeImageUrl(s['imageUrl']) : null,
      ships: kind === 'fleet' ? sanitizeShips(s['ships']) : [],
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
  !!s.body.trim() || (s.kind === 'image' && !!s.imageUrl) || (s.kind === 'fleet' && s.ships.length > 0);

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
