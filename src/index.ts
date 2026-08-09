/**
 * GAIN — phase 1: the pure round-trip core.
 *
 * Contract parser, diff engine, export generator and prompt templates — pure
 * functions over plain data, no I/O, no UI, no database. The clock is injected
 * wherever time matters.
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
