/**
 * GAIN — phases 1–2: the pure round-trip core plus the storage layer.
 *
 * Phase 1 is pure functions over plain data: contract parser, diff engine,
 * export generator and prompt templates — no I/O, no UI, no database. Phase 2
 * adds the per-user SQLite layer under `./lib/db/`: provisioning, migrations,
 * the import writer and import review. The clock is injected wherever time
 * matters.
 */

export * from "./lib/contract/schema";
export * from "./lib/contract/errors";
export * from "./lib/parse/parser";
export * from "./lib/diff/diff";
export * from "./lib/export/bundle";
export * from "./lib/export/csv";
export * from "./lib/export/summary";
export * from "./lib/templates/render";
export * from "./lib/logs/types";

export * from "./lib/db/schema";
export * from "./lib/db/migrate";
export * from "./lib/db/ulid";
export * from "./lib/db/user-db";
export * from "./lib/db/read";
export * from "./lib/db/import-plan";
export * from "./lib/db/review";
