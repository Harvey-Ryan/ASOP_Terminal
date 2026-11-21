// Commodities in a loot session (v1.60.1).
//
// A loot line with a quality level (QL) is a commodity: "Quantainium QL 800 ×5"
// is five units, handed out by the commodity roll, one unit per assignment.
// Everything else is gear, handed out one line at a time by the session's
// method (random roll, DKP, snake draft). An event session can hold both, so
// the gear methods leave commodity lines alone and the commodity roll leaves
// gear alone:
//   - the snake draft's turn order counts gear picks only (`gearPickCount`),
//   - the roll only (re)assigns commodity lines (`commodityRollAssignments`),
//   - results group commodity units per member (`commodityShares`).

export interface CommodityLine {
  id: string;
  name: string;
  quantity: number;
  qualityLevel: number | null;
}

export interface CountedAssignment {
  id?: string;
  userId: string;
  username: string;
  delivered?: boolean;
  /** 1-based position within its commodity's roll (commodityRollAssignments). */
  pickNumber?: number | null;
}

/** A commodity line: it has a quality level. */
export function isCommodityItem(item: { qualityLevel: number | null | undefined }): boolean {
  return item.qualityLevel !== null && item.qualityLevel !== undefined;
}

/** Snake-draft picks made so far: assignments on gear lines only. */
export function gearPickCount(
  items: readonly { qualityLevel: number | null; assignments: readonly unknown[] }[],
): number {
  return items.filter((i) => !isCommodityItem(i)).reduce((n, i) => n + i.assignments.length, 0);
}

/** Gear lines nobody has yet. */
export function gearItemsLeft(
  items: readonly { qualityLevel: number | null; assignments: readonly unknown[] }[],
): number {
  return items.filter((i) => !isCommodityItem(i) && i.assignments.length === 0).length;
}

/** True when the session has commodity lines that haven't been rolled yet. */
export function commoditiesWaiting(
  items: readonly { qualityLevel: number | null; assignments: readonly unknown[] }[],
): boolean {
  return items.some((i) => isCommodityItem(i) && i.assignments.length === 0);
}

/** Snake order position → index into the draft order (0, 1, …, n−1, n−1, …, 0, 0, …). */
export function snakeIndex(pick: number, n: number): number {
  const round = Math.floor(pick / n);
  const pos = pick % n;
  return round % 2 === 0 ? pos : n - 1 - pos;
}

/** Fisher–Yates with an injectable random source (tests pass a seeded one). */
export function shuffled<T>(arr: readonly T[], random: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface RolledUnit {
  itemId: string;
  userId: string;
  username: string;
  /** 1-based position of this unit within its commodity's snake. */
  pickNumber: number;
}

/**
 * The commodity roll: every unit of the given lines goes to someone.
 * Lines are grouped by name; each group gets its own random snake order over
 * the participants, and its units go out highest QL first (lines without a QL
 * last), one unit per turn. Pass only the lines to roll (commodity lines).
 */
export function commodityRollAssignments(
  lines: readonly CommodityLine[],
  participants: readonly { userId: string; username: string }[],
  random: () => number = Math.random,
): RolledUnit[] {
  if (participants.length === 0) return [];
  const names = new Map(participants.map((p) => [p.userId, p.username]));
  const groups = new Map<string, CommodityLine[]>();
  for (const line of lines) {
    if (!groups.has(line.name)) groups.set(line.name, []);
    groups.get(line.name)!.push(line);
  }
  const out: RolledUnit[] = [];
  for (const group of groups.values()) {
    const order = shuffled(
      participants.map((p) => p.userId),
      random,
    );
    const sorted = [...group].sort((a, b) => {
      if (a.qualityLevel === null && b.qualityLevel === null) return 0;
      if (a.qualityLevel === null) return 1;
      if (b.qualityLevel === null) return -1;
      return b.qualityLevel - a.qualityLevel;
    });
    let pick = 0;
    for (const line of sorted) {
      for (let unit = 0; unit < Math.max(0, line.quantity); unit++) {
        const userId = order[snakeIndex(pick, order.length)]!;
        out.push({ itemId: line.id, userId, username: names.get(userId) ?? userId, pickNumber: pick + 1 });
        pick++;
      }
    }
  }
  return out;
}

export interface CommodityShareLine {
  name: string;
  qualityLevel: number | null;
  count: number;
  delivered: number;
  /** Assignment ids, for marking units delivered one at a time. */
  assignmentIds: string[];
  /** This member's picks in the commodity's roll, ascending (1 = first pick). */
  picks: number[];
}

export interface CommodityShare {
  userId: string;
  username: string;
  lines: CommodityShareLine[];
}

/**
 * Who got what from the commodity lines: one entry per member, their units
 * stacked by name and QL (best QL first within a name), members in the order
 * they first appear.
 */
export function commodityShares(
  items: readonly {
    name: string;
    qualityLevel: number | null;
    assignments: readonly CountedAssignment[];
  }[],
): CommodityShare[] {
  const byUser = new Map<string, CommodityShare>();
  for (const item of items) {
    if (!isCommodityItem(item)) continue;
    for (const a of item.assignments) {
      if (!byUser.has(a.userId)) byUser.set(a.userId, { userId: a.userId, username: a.username, lines: [] });
      const share = byUser.get(a.userId)!;
      let line = share.lines.find((l) => l.name === item.name && l.qualityLevel === item.qualityLevel);
      if (!line) {
        line = {
          name: item.name,
          qualityLevel: item.qualityLevel,
          count: 0,
          delivered: 0,
          assignmentIds: [],
          picks: [],
        };
        share.lines.push(line);
      }
      line.count++;
      if (a.delivered) line.delivered++;
      if (a.id) line.assignmentIds.push(a.id);
      if (a.pickNumber != null) line.picks.push(a.pickNumber);
    }
  }
  for (const share of byUser.values()) {
    for (const line of share.lines) line.picks.sort((x, y) => x - y);
    share.lines.sort((x, y) =>
      x.name !== y.name ? x.name.localeCompare(y.name) : (y.qualityLevel ?? -1) - (x.qualityLevel ?? -1),
    );
  }
  return [...byUser.values()];
}

/** "Quantainium QL 800 ×2" */
export function commodityShareLabel(line: Pick<CommodityShareLine, 'name' | 'qualityLevel' | 'count'>): string {
  const ql = line.qualityLevel !== null ? ` QL ${line.qualityLevel}` : '';
  const ct = line.count > 1 ? ` ×${line.count}` : '';
  return `${line.name}${ql}${ct}`;
}

/**
 * Splits text blocks into chunks of at most `max` characters (Discord embed
 * descriptions hold 4,096), joining blocks with `sep` and never splitting a
 * block unless it alone is too long (then it's cut with "…").
 */
export function chunkBlocks(blocks: readonly string[], max = 4000, sep = '\n\n'): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const raw of blocks) {
    const block = raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
    if (!current) current = block;
    else if (current.length + sep.length + block.length <= max) current += sep + block;
    else {
      chunks.push(current);
      current = block;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
