// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import svelte from "eslint-plugin-svelte";
import tseslint from "typescript-eslint";

/**
 * Literal control characters in source are invisible in every editor and turn the
 * file binary as far as git is concerned — a file with no reviewable diff is a file
 * nobody reviews. Three NUL bytes lived in `src/lib/export/bundle.ts` through a whole
 * commit with prettier, eslint and tsc all reporting clean. Write `\u0000` instead.
 */
const noControlCharacters = {
  meta: {
    type: /** @type {const} */ ("problem"),
    docs: { description: "Disallow literal control characters in source text" },
    messages: {
      found:
        "Literal control character U+{{code}} at line {{line}}. Write it as an escape (e.g. `\\u0000`) — a raw control character makes git treat this file as binary.",
    },
    schema: [],
  },
  /** @param {import("eslint").Rule.RuleContext} context */
  create(context) {
    return {
      Program() {
        const text = context.sourceCode.getText();
        // Everything below U+0020 except tab, newline and carriage return, plus DEL.
        // Matching control characters is the whole point of this rule.
        // eslint-disable-next-line no-control-regex
        const pattern = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const index = match.index;
          const code = text.charCodeAt(index).toString(16).toUpperCase().padStart(4, "0");
          context.report({
            loc: context.sourceCode.getLocFromIndex(index),
            messageId: "found",
            data: { code, line: String(context.sourceCode.getLocFromIndex(index).line) },
          });
        }
      },
    };
  },
};

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "coverage/**",
      ".svelte-kit/**",
      "static/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs["flat/recommended"],
  prettier,
  // Svelte's prettier-compat set must come after `prettier` so it only turns
  // the svelte-specific stylistic rules back off, never the core ones on.
  ...svelte.configs["flat/prettier"],
  {
    // TypeScript inside <script lang="ts"> blocks, plus the browser globals a
    // component legitimately reaches for (timers, clipboard, document).
    files: ["**/*.svelte"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { parser: tseslint.parser },
    },
    rules: {
      // GAIN deploys at the domain root — no `paths.base`, no parameterised
      // routes (ARCHITECTURE §3) — so a root-relative href is already the
      // resolved URL and `resolve()` from $app/paths would be a no-op.
      "svelte/no-navigation-without-resolve": ["error", { ignoreLinks: true }],
    },
  },
  {
    plugins: { gain: { rules: { "no-control-characters": noControlCharacters } } },
    rules: {
      // A phase-1 core is pure functions over plain data; console output is almost
      // always accidental.
      "no-console": "error",
      "gain/no-control-characters": "error",
    },
  },
  {
    // Type-aware rules, for everything tsconfig's `include` covers. They need a
    // program, so the glob and that `include` have to stay in step — the root config
    // files outside it cannot be linted this way.
    //
    // `src/service-worker.ts` is excluded here and picked up by its own block below:
    // SvelteKit's generated `.svelte-kit/tsconfig.json` deliberately excludes it from
    // the main app project (its WebWorker global scope conflicts with the app's DOM
    // lib), so `projectService` cannot find it in this project.
    files: ["src/**/*.ts", "tests/**/*.ts", "e2e/**/*.ts", "playwright.config.ts"],
    ignores: ["src/service-worker.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // The service worker's own project (`tsconfig.worker.json`) — see that file's
    // comment for why it exists separately.
    files: ["src/service-worker.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.worker.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Tests build deliberately malformed contracts to provoke validation errors,
    // and read rows back out of SQLite, which better-sqlite3 types as `unknown`.
    // `e2e/**` is deliberately *not* in here: it reads rows back too, but does it
    // through explicit casts that the type-aware ruleset accepts as written.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
    },
  },
  {
    // The phase-1 no-console rule stands for the pure core; the server layer logs
    // deliberately — the startup origin/redirect-URI line is a §14 mitigation.
    files: ["src/lib/server/**/*.ts", "src/hooks.server.ts"],
    rules: { "no-console": "off" },
  },
  {
    // SvelteKit control flow throws `redirect()` and `error()` results, which
    // are not Error objects — that is the framework's idiom, not a bug.
    files: ["src/hooks.server.ts", "src/routes/**/*.ts"],
    rules: { "@typescript-eslint/only-throw-error": "off" },
  },
);
