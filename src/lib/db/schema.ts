/**
 * The GAIN domain model as SQLite DDL — the reconciled version of ARCHITECTURE §5.
 *
 * Schema-first (ARCHITECTURE §12): this file is the specification for the storage
 * layer. Reconciliation with the exercise catalogue closed the five gaps listed in §5:
 *
 * 1. `version_session` and `version_block` now carry session `name`/`note`/`order`
 *    and block `name`/`note`/`tracking`/`type`/`rounds`/`rest_sec`.
 * 2. `prescription.sets_min`/`sets_max` accept `[min, max]` set ranges.
 * 3. Notes live at both levels: `version_exercise.note` (catalogue) and
 *    `prescription.note` (occurrence; NULL means "inherit the catalogue note").
 * 4. `load_config.note` exists.
 * 5. Movement-level properties (`type`, `per_side`, `conditional`, `condition`,
 *    `substitutes`) live in `version_exercise` — the per-version catalogue table —
 *    not on prescription rows. Prescriptions carry nullable overrides where the
 *    contract allows them.
 *
 * One further reconciliation: `plan_version.source_md` became `source_path`. The
 * verbatim document lives on disk at `plans/<plan.slug>/v<N>.md` (ARCHITECTURE §3),
 * export Section 1 copies it from there (§11), and the DB never holds a second copy.
 *
 * Timestamps are ISO-8601 TEXT, stored UTC. IDs are ULIDs unless noted.
 */

export type Migration = {
  version: number;
  name: string;
  sql: string;
};

const MIGRATION_001 = `
-- ---------------------------------------------------------------------------
-- Plan identity and versions
-- ---------------------------------------------------------------------------

CREATE TABLE plan (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,      -- plan.slug, stable across all versions
  name          TEXT NOT NULL,             -- latest plan.name
  created_at    TEXT NOT NULL,
  archived_at   TEXT
);

CREATE TABLE plan_version (
  id                  TEXT PRIMARY KEY,
  plan_id             TEXT NOT NULL REFERENCES plan(id),
  version_no          INTEGER NOT NULL,
  based_on_version    INTEGER,
  source_path         TEXT NOT NULL,       -- verbatim source_md on disk, relative to the user dir
  context_md          TEXT NOT NULL,       -- verbatim, for diffing and the never-paraphrase guarantee
  contract_json       TEXT NOT NULL,       -- the validated contract, serialized
  changelog_json      TEXT,                -- plan.changelog array
  block_length_weeks  INTEGER,
  session_target_min  INTEGER,
  scheduling_json     TEXT,                -- free-text except sequence, which drives suggested-next
  progression_json    TEXT,
  safety_json         TEXT,
  imported_at         TEXT NOT NULL,
  is_current          INTEGER NOT NULL DEFAULT 0,
  UNIQUE (plan_id, version_no)
);

-- ---------------------------------------------------------------------------
-- The catalogue: stable identity + per-version movement properties
-- ---------------------------------------------------------------------------

-- One row per movement per plan. Stable across versions — charts join here.
CREATE TABLE exercise_def (
  id                  TEXT PRIMARY KEY,
  plan_id             TEXT NOT NULL REFERENCES plan(id),
  slug                TEXT NOT NULL,       -- STABLE ACROSS VERSIONS
  name                TEXT NOT NULL,       -- latest known display name
  first_seen_version  INTEGER NOT NULL,
  last_seen_version   INTEGER NOT NULL,
  UNIQUE (plan_id, slug)
);

-- The catalogue as of one version: what the movement IS (gap 5's home).
CREATE TABLE version_exercise (
  plan_version_id   TEXT NOT NULL REFERENCES plan_version(id),
  exercise_def_id   TEXT NOT NULL REFERENCES exercise_def(id),
  name              TEXT,                  -- explicit override; NULL = derived from slug
  type              TEXT NOT NULL DEFAULT 'reps' CHECK (type IN ('reps', 'time')),
  per_side          INTEGER NOT NULL DEFAULT 0,
  load_ref          TEXT,                  -- default load ref
  rest_min_s        INTEGER,               -- default rest range
  rest_max_s        INTEGER,
  note              TEXT,                  -- persistent guidance (gap 3, catalogue level)
  conditional       INTEGER NOT NULL DEFAULT 0,
  condition_text    TEXT,
  substitutes_json  TEXT,                  -- array of catalogue slugs
  PRIMARY KEY (plan_version_id, exercise_def_id)
);

-- ---------------------------------------------------------------------------
-- Sessions → blocks → prescriptions, per version
-- ---------------------------------------------------------------------------

CREATE TABLE version_session (
  plan_version_id  TEXT NOT NULL REFERENCES plan_version(id),
  key              TEXT NOT NULL,          -- stable session key, e.g. 'A'
  name             TEXT NOT NULL,
  order_no         INTEGER NOT NULL,
  note             TEXT,
  PRIMARY KEY (plan_version_id, key)
);

CREATE TABLE version_block (
  plan_version_id  TEXT NOT NULL,
  session_key      TEXT NOT NULL,
  key              TEXT NOT NULL,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'sequence' CHECK (type IN ('sequence', 'rounds')),
  rounds           INTEGER,                -- required when type = 'rounds'
  rest_min_s       INTEGER,                -- rounds blocks only: rest BETWEEN rounds
  rest_max_s       INTEGER,
  tracking         TEXT NOT NULL DEFAULT 'full' CHECK (tracking IN ('full', 'checkoff')),
  note             TEXT,
  order_no         INTEGER NOT NULL,
  PRIMARY KEY (plan_version_id, session_key, key),
  FOREIGN KEY (plan_version_id, session_key)
    REFERENCES version_session(plan_version_id, key)
);

-- One occurrence of a movement in a block: reference + targets for this occasion.
CREATE TABLE prescription (
  id               TEXT PRIMARY KEY,
  plan_version_id  TEXT NOT NULL REFERENCES plan_version(id),
  session_key      TEXT NOT NULL,
  block_key        TEXT NOT NULL,
  exercise_def_id  TEXT NOT NULL REFERENCES exercise_def(id),
  order_no         INTEGER NOT NULL,
  sets_min         INTEGER,                -- NULL = default 1 (gap 2: ranged sets)
  sets_max         INTEGER,
  reps_min         INTEGER,
  reps_max         INTEGER,
  duration_min_s   INTEGER,
  duration_max_s   INTEGER,
  load_ref         TEXT,                   -- NULL = catalogue default
  rest_min_s       INTEGER,                -- NULL = catalogue default
  rest_max_s       INTEGER,
  note             TEXT,                   -- NULL = catalogue note applies (gap 3)
  conditional      INTEGER,                -- NULL = catalogue value applies
  condition_text   TEXT,                   -- NULL = catalogue value applies
  substitutes_json TEXT,                   -- NULL = catalogue list applies
  FOREIGN KEY (plan_version_id, session_key, block_key)
    REFERENCES version_block(plan_version_id, session_key, key)
);

-- ---------------------------------------------------------------------------
-- Loads and metrics, per version
-- ---------------------------------------------------------------------------

CREATE TABLE load_config (
  plan_version_id  TEXT NOT NULL REFERENCES plan_version(id),
  ref              TEXT NOT NULL,
  label            TEXT NOT NULL,
  default_kg       REAL,
  is_bodyweight    INTEGER NOT NULL DEFAULT 0,
  note             TEXT,                   -- gap 4
  PRIMARY KEY (plan_version_id, ref)
);

CREATE TABLE metric_def (
  plan_version_id  TEXT NOT NULL REFERENCES plan_version(id),
  scope            TEXT NOT NULL CHECK (scope IN ('set', 'exercise', 'session')),
  key              TEXT NOT NULL,          -- stable identifier, unique within scope
  label            TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('number', 'scale', 'enum', 'text', 'bool')),
  min              REAL,
  max              REAL,
  options_json     TEXT,
  prompt_when      TEXT CHECK (prompt_when IN ('start', 'end', 'next_morning')),
  optional         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (plan_version_id, scope, key)
);

-- ---------------------------------------------------------------------------
-- Training logs — identity and logging as in §5, aligned with the phase-1 types
-- ---------------------------------------------------------------------------

CREATE TABLE workout (
  id               TEXT PRIMARY KEY,
  plan_version_id  TEXT NOT NULL REFERENCES plan_version(id),
  session_key      TEXT NOT NULL,
  started_at       TEXT NOT NULL,
  completed_at     TEXT,
  status           TEXT NOT NULL CHECK (status IN ('completed', 'partial', 'stopped')),
  note             TEXT,
  client_id        TEXT UNIQUE             -- offline-sync idempotency
);

CREATE TABLE set_log (
  id               TEXT PRIMARY KEY,
  workout_id       TEXT NOT NULL REFERENCES workout(id),
  exercise_def_id  TEXT NOT NULL REFERENCES exercise_def(id),
  set_no           INTEGER NOT NULL,
  side             TEXT CHECK (side IN ('left', 'right')),
  reps             INTEGER,
  weight_kg        REAL,
  duration_s       INTEGER,
  difficulty       TEXT CHECK (difficulty IN ('easy', 'medium', 'hard')),
  client_id        TEXT UNIQUE
);

CREATE TABLE metric_value (
  id               TEXT PRIMARY KEY,
  scope            TEXT NOT NULL CHECK (scope IN ('set', 'exercise', 'session')),
  set_log_id       TEXT REFERENCES set_log(id),       -- scope = 'set'
  workout_id       TEXT REFERENCES workout(id),       -- scope = 'exercise' | 'session'
  exercise_def_id  TEXT REFERENCES exercise_def(id),  -- scope = 'exercise'
  metric_key       TEXT NOT NULL,
  value_num        REAL,
  value_text       TEXT
);

CREATE TABLE deviation (
  id                        TEXT PRIMARY KEY,
  workout_id                TEXT NOT NULL REFERENCES workout(id),
  exercise_def_id           TEXT NOT NULL REFERENCES exercise_def(id),
  kind                      TEXT NOT NULL
    CHECK (kind IN ('skip', 'substitute', 'add_set', 'drop_set', 'stop_red_flag')),
  reason_code               TEXT,
  note                      TEXT,
  substitute_exercise_slug  TEXT,
  client_id                 TEXT UNIQUE
);

CREATE TABLE activity (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,             -- free-form slug, user's own vocabulary
  occurred_at   TEXT NOT NULL,
  duration_min  INTEGER,
  intensity     TEXT,
  note          TEXT,
  client_id     TEXT UNIQUE
);

-- ---------------------------------------------------------------------------
-- AI instruction templates (seeded at provisioning, user-editable)
-- ---------------------------------------------------------------------------

CREATE TABLE ai_template (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  body_md     TEXT NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_plan_version_plan        ON plan_version(plan_id);
CREATE INDEX idx_prescription_version     ON prescription(plan_version_id);
CREATE INDEX idx_version_exercise_version ON version_exercise(plan_version_id);
CREATE INDEX idx_workout_version          ON workout(plan_version_id);
CREATE INDEX idx_set_log_workout          ON set_log(workout_id);
CREATE INDEX idx_metric_value_workout     ON metric_value(workout_id);
CREATE INDEX idx_metric_value_set_log     ON metric_value(set_log_id);
CREATE INDEX idx_deviation_workout        ON deviation(workout_id);
`;

/** Ordered list of migrations; applied once each, tracked in `_gain_migration`. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "domain-model-v1", sql: MIGRATION_001 },
];
