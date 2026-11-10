// Rebuilds the clean `scdata` tables from `scdata_raw.file`.
//
// Runs inside the sync transaction: rows are replaced with DELETE + INSERT,
// so readers keep seeing the previous build until COMMIT (no empty window,
// no lock that blocks the app's reads).

import type { PoolClient } from 'pg';

// Raw paths each clean table is built from. Anything else in raw is reported
// as "unmapped" on the sync run so new upstream data gets noticed.
export const MAPPED = {
  files: [
    'items.json', 'fps-items.json', 'ship-items.json', 'ships.json', 'blueprints.json',
    'manufacturers.json', 'starmap.json', 'starmap_positions.json', 'trade_locations.json',
    'tags.json', 'labels.json', 'resources/commodities.json', 'resources/resources.json',
    'resources/locations.json', 'resources/commodity_trade_locations.json',
  ],
  // Folders whose files are covered: contracts/ and factions/ are read directly;
  // items/, ships/ and blueprints/ duplicate the combined lists plus the raw game
  // entity, which stays available in scdata_raw (items.raw_path points at it).
  prefixes: ['contracts/', 'factions/', 'items/', 'ships/', 'blueprints/'],
};

const arr = (path: string) =>
  `jsonb_array_elements((SELECT content FROM scdata_raw.file WHERE path = '${path}'))`;
const obj = (path: string) =>
  `jsonb_each((SELECT content FROM scdata_raw.file WHERE path = '${path}'))`;

// Each entry: [table, INSERT statement]. Order doesn't matter (no FKs between clean
// tables, so a missing upstream file can't break the rest of the rebuild).
const BUILDS: [string, string][] = [
  ['manufacturers', `
    INSERT INTO scdata.manufacturers (uuid, code, name, description, data)
    SELECT DISTINCT ON (e->>'Reference') e->>'Reference', e->>'Code', e->>'Name', e->>'Description', e
    FROM ${arr('manufacturers.json')} e
    WHERE e->>'Reference' IS NOT NULL`],

  ['items', `
    WITH fps  AS (SELECT e->>'reference' AS ref, e AS d FROM ${arr('fps-items.json')} e),
         ship AS (SELECT e->>'reference' AS ref, e AS d FROM ${arr('ship-items.json')} e)
    INSERT INTO scdata.items (uuid, class_name, item_name, name, is_placeholder, type, sub_type,
      classification, size, grade, manufacturer_code, manufacturer_name, mass, rarity, tags,
      description, is_fps, is_ship_item, raw_path, data)
    SELECT DISTINCT ON (e->>'reference')
      e->>'reference', e->>'className', e->>'itemName', e->>'name',
      scdata_raw.is_placeholder(e->>'name'),
      e->>'type', e->>'subType', e->>'classification',
      scdata_raw.num(e->'size'), scdata_raw.num(e->'grade'),
      coalesce(e->>'manufacturer', e#>>'{stdItem,Manufacturer,Code}'),
      e#>>'{stdItem,Manufacturer,Name}',
      scdata_raw.num(e#>'{stdItem,Mass}'),
      e#>>'{stdItem,Rarity}',
      coalesce(e->>'tags', fps.d->>'tags', ship.d->>'tags'),
      e#>>'{stdItem,DescriptionText}',
      fps.ref IS NOT NULL, ship.ref IS NOT NULL,
      'items/' || (e->>'itemName') || '.json',
      e || coalesce(fps.d, '{}'::jsonb) || coalesce(ship.d, '{}'::jsonb)
    FROM ${arr('items.json')} e
    LEFT JOIN fps  ON fps.ref  = e->>'reference'
    LEFT JOIN ship ON ship.ref = e->>'reference'
    WHERE e->>'reference' IS NOT NULL`],

  ['ships', `
    INSERT INTO scdata.ships (uuid, class_name, name, manufacturer_code, manufacturer_name, career,
      role, size, crew, is_spaceship, is_vehicle, is_gravlev, mass_total, length, width, height,
      description, data)
    SELECT DISTINCT ON (e->>'UUID')
      e->>'UUID', e->>'ClassName', e->>'Name',
      e#>>'{Manufacturer,Code}', e#>>'{Manufacturer,Name}', e->>'Career', e->>'Role',
      scdata_raw.num(e->'Size'), scdata_raw.num(e->'Crew'),
      scdata_raw.bool(e->'IsSpaceship'), scdata_raw.bool(e->'IsVehicle'), scdata_raw.bool(e->'IsGravlev'),
      scdata_raw.num(e->'MassTotal'), scdata_raw.num(e->'Length'), scdata_raw.num(e->'Width'),
      scdata_raw.num(e->'Height'), e->>'DescriptionText', e
    FROM ${arr('ships.json')} e
    WHERE e->>'UUID' IS NOT NULL`],

  ['blueprints', `
    INSERT INTO scdata.blueprints (uuid, key, kind, category_uuid, output_uuid, output_class, output_type, data)
    SELECT DISTINCT ON (e->>'UUID')
      e->>'UUID', e->>'Key', e->>'Kind', e->>'CategoryUUID',
      e#>>'{Output,UUID}', e#>>'{Output,Class}', e#>>'{Output,Type}', e
    FROM ${arr('blueprints.json')} e
    WHERE e->>'UUID' IS NOT NULL`],

  ['contracts', `
    INSERT INTO scdata.contracts (uuid, debug_name, title, mission_type, mission_giver, faction_uuid,
      faction_name, entry_type, illegal, shareable, once_only, not_for_release, work_in_progress,
      time_to_complete, raw_path, data)
    SELECT DISTINCT ON (c->>'UUID')
      c->>'UUID', c->>'DebugName', c->>'DisplayTitle', c#>>'{MissionType,Name}', c->>'MissionGiver',
      c#>>'{Faction,UUID}', c#>>'{Faction,Name}', c->>'entry_type',
      scdata_raw.bool(c->'Illegal'), scdata_raw.bool(c->'Shareable'), scdata_raw.bool(c->'OnceOnly'),
      scdata_raw.bool(c->'NotForRelease'), scdata_raw.bool(c->'WorkInProgress'),
      scdata_raw.num(c->'TimeToComplete'), f.path, c
    FROM scdata_raw.file f, LATERAL (SELECT f.content AS c) x
    WHERE f.path LIKE 'contracts/%' AND jsonb_typeof(f.content) = 'object' AND c->>'UUID' IS NOT NULL`],

  ['factions', `
    INSERT INTO scdata.factions (uuid, name, faction_type, default_reaction, data)
    SELECT DISTINCT ON (c->>'UUID') c->>'UUID', c->>'Name', c->>'FactionType', c->>'DefaultReaction', c
    FROM scdata_raw.file f, LATERAL (SELECT f.content AS c) x
    WHERE f.path LIKE 'factions/%' AND jsonb_typeof(f.content) = 'object' AND c->>'UUID' IS NOT NULL`],

  ['commodities', `
    INSERT INTO scdata.commodities (uuid, key, name, tier, refined_uuid, data)
    SELECT DISTINCT ON (e->>'UUID') e->>'UUID', e->>'Key', e->>'Name', scdata_raw.num(e->'Tier'),
      e->>'RefinedVersionUUID', e
    FROM ${arr('resources/commodities.json')} e
    WHERE e->>'UUID' IS NOT NULL`],

  ['resources', `
    INSERT INTO scdata.resources (uuid, key, name, kind, data)
    SELECT DISTINCT ON (e->>'UUID') e->>'UUID', e->>'Key', e->>'Name', e->>'Kind', e
    FROM ${arr('resources/resources.json')} e
    WHERE e->>'UUID' IS NOT NULL`],

  ['resource_locations', `
    INSERT INTO scdata.resource_locations (provider_uuid, provider_name, data)
    SELECT DISTINCT ON (e#>>'{Provider,UUID}') e#>>'{Provider,UUID}', e#>>'{Provider,Name}', e
    FROM ${arr('resources/locations.json')} e
    WHERE e#>>'{Provider,UUID}' IS NOT NULL`],

  ['commodity_trade_locations', `
    INSERT INTO scdata.commodity_trade_locations (commodity_uuid, commodity_key, commodity_name, data)
    SELECT DISTINCT ON (e->>'CommodityUUID') e->>'CommodityUUID', e->>'CommodityKey', e->>'CommodityName', e
    FROM ${arr('resources/commodity_trade_locations.json')} e
    WHERE e->>'CommodityUUID' IS NOT NULL`],

  ['trade_locations', `
    INSERT INTO scdata.trade_locations (uuid, class_name, display_name, disabled, data)
    SELECT DISTINCT ON (e->>'UUID') e->>'UUID', e->>'ClassName', e->>'DisplayName',
      scdata_raw.bool(e->'Disabled'), e
    FROM ${arr('trade_locations.json')} e
    WHERE e->>'UUID' IS NOT NULL`],

  ['starmap', `
    INSERT INTO scdata.starmap (uuid, name, is_placeholder, type_name, parent_uuid, data)
    SELECT DISTINCT ON (e->>'UUID') e->>'UUID', e->>'Name', scdata_raw.is_placeholder(e->>'Name'),
      e#>>'{Type,Name}', e->>'ParentUUID', e
    FROM ${arr('starmap.json')} e
    WHERE e->>'UUID' IS NOT NULL`],

  ['starmap_positions', `
    INSERT INTO scdata.starmap_positions (idx, uuid, name, type, system, parent_uuid, hidden, qt_valid, x, y, z)
    SELECT i::int, e->>'uuid', e->>'name', e->>'type', e->>'system', e->>'parent_uuid',
      scdata_raw.bool(e->'hidden'), scdata_raw.bool(e->'qt_valid'),
      scdata_raw.num(e->'x'), scdata_raw.num(e->'y'), scdata_raw.num(e->'z')
    FROM jsonb_array_elements((SELECT content->'entities' FROM scdata_raw.file WHERE path = 'starmap_positions.json'))
      WITH ORDINALITY AS t(e, i)`],

  ['starmap_connections', `
    INSERT INTO scdata.starmap_connections (entry_uuid, exit_uuid, entry_system, exit_system, fuel_cost)
    SELECT DISTINCT ON (e->>'entry_uuid', e->>'exit_uuid')
      e->>'entry_uuid', e->>'exit_uuid', e->>'entry_system', e->>'exit_system', scdata_raw.num(e->'fuel_cost')
    FROM jsonb_array_elements((SELECT content->'connections' FROM scdata_raw.file WHERE path = 'starmap_positions.json')) e
    WHERE e->>'entry_uuid' IS NOT NULL AND e->>'exit_uuid' IS NOT NULL`],

  ['tags', `
    INSERT INTO scdata.tags (uuid, name, parent_uuid)
    SELECT DISTINCT ON (k) k, v->>'name', v->>'parent_uuid'
    FROM ${obj('tags.json')} AS t(k, v)`],

  // labels.json starts with a byte-order mark inside its first key.
  ['labels', `
    INSERT INTO scdata.labels (key, value)
    SELECT DISTINCT ON (regexp_replace(k, '^\\uFEFF', '')) regexp_replace(k, '^\\uFEFF', ''), v #>> '{}'
    FROM ${obj('labels.json')} AS t(k, v)`],
];

export async function rebuildClean(
  client: PoolClient,
  source: { commit: string; build: string | null; committedAt: Date | null },
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [table, insert] of BUILDS) {
    await client.query(`DELETE FROM scdata.${table}`);
    const res = await client.query(insert);
    counts[table] = res.rowCount ?? 0;
  }
  const placeholders = await client.query<{ n: string }>(
    'SELECT count(*) AS n FROM scdata.items WHERE is_placeholder',
  );
  counts['items_placeholder'] = Number(placeholders.rows[0]?.n ?? 0);

  await client.query('DELETE FROM scdata.source');
  await client.query(
    'INSERT INTO scdata.source (commit, build, committed_at, synced_at) VALUES ($1, $2, $3, now())',
    [source.commit, source.build, source.committedAt],
  );
  return counts;
}

export function unmappedPaths(paths: Iterable<string>): string[] {
  const files = new Set(MAPPED.files);
  const out: string[] = [];
  for (const p of paths) {
    if (files.has(p) || MAPPED.prefixes.some((pre) => p.startsWith(pre))) continue;
    out.push(p);
  }
  return out.sort();
}
