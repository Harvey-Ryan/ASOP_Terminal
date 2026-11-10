// Schema for our own copy of scunpacked-data.
//
// Two Postgres schemas, deliberately NOT `public`:
//   scdata_raw — every upstream file exactly as published (jsonb), plus sync bookkeeping
//   scdata     — clean, typed tables rebuilt from scdata_raw; what the app reads
//
// They live outside `public` because the API container starts with
// `prisma db push --accept-data-loss`, which drops any table in `public` that
// isn't in schema.prisma. Prisma leaves other schemas alone.
//
// Migrations are append-only: never edit one that has shipped, add a new entry.

export interface Migration {
  id: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: '001_raw',
    sql: `
CREATE SCHEMA IF NOT EXISTS scdata_raw;
CREATE SCHEMA IF NOT EXISTS scdata;

-- One row per upstream .json file, keyed by its path in the repo.
CREATE TABLE scdata_raw.file (
  path              text PRIMARY KEY,
  sha256            text        NOT NULL,
  size_bytes        integer     NOT NULL,
  content           jsonb       NOT NULL,
  first_seen_commit text        NOT NULL,
  changed_commit    text        NOT NULL,
  changed_at        timestamptz NOT NULL DEFAULT now()
);

-- Per-file history of what changed in each upstream commit.
CREATE TABLE scdata_raw.file_change (
  id         bigserial PRIMARY KEY,
  commit     text        NOT NULL,
  path       text        NOT NULL,
  kind       text        NOT NULL CHECK (kind IN ('added', 'changed', 'removed')),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX file_change_commit_idx ON scdata_raw.file_change (commit);
CREATE INDEX file_change_path_idx   ON scdata_raw.file_change (path);

-- One row per run of the worker, including runs that found nothing new.
CREATE TABLE scdata_raw.sync_run (
  id              bigserial PRIMARY KEY,
  trigger         text        NOT NULL,
  status          text        NOT NULL CHECK (status IN ('running', 'no_change', 'success', 'failed')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  upstream_commit text,
  build           text,
  files_seen      integer,
  files_added     integer,
  files_changed   integer,
  files_removed   integer,
  files_invalid   integer,
  invalid_paths   text[],
  unmapped_paths  text[],
  clean_counts    jsonb,
  error           text
);
CREATE INDEX sync_run_started_idx ON scdata_raw.sync_run (started_at DESC);

-- What we currently hold. Exactly one row.
CREATE TABLE scdata_raw.state (
  id           boolean PRIMARY KEY DEFAULT true CHECK (id),
  commit       text,
  build        text,
  committed_at timestamptz,
  synced_at    timestamptz
);
INSERT INTO scdata_raw.state (id) VALUES (true);

-- Lenient casts: upstream values are occasionally missing or the wrong type.
CREATE FUNCTION scdata_raw.num(v jsonb) RETURNS double precision
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF v IS NULL OR jsonb_typeof(v) NOT IN ('number', 'string') THEN RETURN NULL; END IF;
  RETURN (v #>> '{}')::double precision;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

CREATE FUNCTION scdata_raw.bool(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF v IS NULL OR jsonb_typeof(v) = 'null' THEN RETURN NULL; END IF;
  RETURN (v #>> '{}')::boolean;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

-- Upstream marks unfinished records with names like "<= PLACEHOLDER =>".
CREATE FUNCTION scdata_raw.is_placeholder(name text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT name IS NULL OR btrim(name) = '' OR name ~ '^\\s*<=.*=>\\s*$'
$$;
`,
  },
  {
    id: '002_clean',
    sql: `
-- ── Clean tables ────────────────────────────────────────────────────────────
-- Every table keeps the full upstream record in \`data\`, so nothing is lost;
-- the typed columns are the fields the app is most likely to filter or show.
-- Ids are text (upstream UUIDs, kept as published).

CREATE TABLE scdata.source (
  id           boolean PRIMARY KEY DEFAULT true CHECK (id),
  commit       text NOT NULL,
  build        text,
  committed_at timestamptz,
  synced_at    timestamptz NOT NULL
);

CREATE TABLE scdata.manufacturers (
  uuid        text PRIMARY KEY,
  code        text,
  name        text,
  description text,
  data        jsonb NOT NULL
);

CREATE TABLE scdata.items (
  uuid              text PRIMARY KEY,
  class_name        text,
  item_name         text,
  name              text,
  is_placeholder    boolean NOT NULL,
  type              text,
  sub_type          text,
  classification    text,
  size              double precision,
  grade             double precision,
  manufacturer_code text,
  manufacturer_name text,
  mass              double precision,
  rarity            text,
  tags              text,
  description       text,
  is_fps            boolean NOT NULL,
  is_ship_item      boolean NOT NULL,
  raw_path          text,
  data              jsonb NOT NULL
);
CREATE INDEX items_name_idx           ON scdata.items (lower(name)) WHERE NOT is_placeholder;
CREATE INDEX items_type_idx           ON scdata.items (type, sub_type);
CREATE INDEX items_classification_idx ON scdata.items (classification);
CREATE INDEX items_class_name_idx     ON scdata.items (class_name);

CREATE TABLE scdata.ships (
  uuid              text PRIMARY KEY,
  class_name        text,
  name              text,
  manufacturer_code text,
  manufacturer_name text,
  career            text,
  role              text,
  size              double precision,
  crew              double precision,
  is_spaceship      boolean,
  is_vehicle        boolean,
  is_gravlev        boolean,
  mass_total        double precision,
  length            double precision,
  width             double precision,
  height            double precision,
  description       text,
  data              jsonb NOT NULL
);
CREATE INDEX ships_name_idx ON scdata.ships (lower(name));

CREATE TABLE scdata.blueprints (
  uuid          text PRIMARY KEY,
  key           text,
  kind          text,
  category_uuid text,
  output_uuid   text,
  output_class  text,
  output_type   text,
  data          jsonb NOT NULL
);
CREATE INDEX blueprints_output_idx ON scdata.blueprints (output_uuid);

CREATE TABLE scdata.contracts (
  uuid              text PRIMARY KEY,
  debug_name        text,
  title             text,
  mission_type      text,
  mission_giver     text,
  faction_uuid      text,
  faction_name      text,
  entry_type        text,
  illegal           boolean,
  shareable         boolean,
  once_only         boolean,
  not_for_release   boolean,
  work_in_progress  boolean,
  time_to_complete  double precision,
  raw_path          text,
  data              jsonb NOT NULL
);
CREATE INDEX contracts_type_idx    ON scdata.contracts (mission_type);
CREATE INDEX contracts_faction_idx ON scdata.contracts (faction_uuid);

CREATE TABLE scdata.factions (
  uuid             text PRIMARY KEY,
  name             text,
  faction_type     text,
  default_reaction text,
  data             jsonb NOT NULL
);

CREATE TABLE scdata.commodities (
  uuid         text PRIMARY KEY,
  key          text,
  name         text,
  tier         double precision,
  refined_uuid text,
  data         jsonb NOT NULL
);

CREATE TABLE scdata.resources (
  uuid text PRIMARY KEY,
  key  text,
  name text,
  kind text,
  data jsonb NOT NULL
);

CREATE TABLE scdata.resource_locations (
  provider_uuid text PRIMARY KEY,
  provider_name text,
  data          jsonb NOT NULL
);

CREATE TABLE scdata.commodity_trade_locations (
  commodity_uuid text PRIMARY KEY,
  commodity_key  text,
  commodity_name text,
  data           jsonb NOT NULL
);

CREATE TABLE scdata.trade_locations (
  uuid         text PRIMARY KEY,
  class_name   text,
  display_name text,
  disabled     boolean,
  data         jsonb NOT NULL
);

CREATE TABLE scdata.starmap (
  uuid           text PRIMARY KEY,
  name           text,
  is_placeholder boolean NOT NULL,
  type_name      text,
  parent_uuid    text,
  data           jsonb NOT NULL
);
CREATE INDEX starmap_parent_idx ON scdata.starmap (parent_uuid);

-- Upstream reuses one uuid for many positions (asteroid clusters, mining
-- bases), so rows are keyed by their position in the file, not by uuid.
CREATE TABLE scdata.starmap_positions (
  idx         integer PRIMARY KEY,
  uuid        text,
  name        text,
  type        text,
  system      text,
  parent_uuid text,
  hidden      boolean,
  qt_valid    boolean,
  x           double precision,
  y           double precision,
  z           double precision
);
CREATE INDEX starmap_positions_uuid_idx ON scdata.starmap_positions (uuid);

CREATE TABLE scdata.starmap_connections (
  entry_uuid   text NOT NULL,
  exit_uuid    text NOT NULL,
  entry_system text,
  exit_system  text,
  fuel_cost    double precision,
  PRIMARY KEY (entry_uuid, exit_uuid)
);

CREATE TABLE scdata.tags (
  uuid        text PRIMARY KEY,
  name        text,
  parent_uuid text
);

CREATE TABLE scdata.labels (
  key   text PRIMARY KEY,
  value text
);
`,
  },
  {
    id: '003_sync_request',
    sql: `
-- "Sync now" requests from the web app. The worker picks up the oldest
-- unhandled one on its next run and does a full forced re-check.
CREATE TABLE scdata_raw.sync_request (
  id           bigserial PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now(),
  requested_by text,
  handled_at   timestamptz,
  run_id       bigint
);
CREATE INDEX sync_request_pending_idx ON scdata_raw.sync_request (id) WHERE handled_at IS NULL;
`,
  },
];
