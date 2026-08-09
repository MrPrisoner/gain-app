// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
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
    ignores: ["node_modules/**", "dist/**", "build/**", "coverage/**", ".svelte-kit/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
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
    // Type-aware rules, for source only. They need a program, and the config files
    // at the repo root are not in tsconfig's include.
    files: ["src/**/*.ts", "tests/**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Tests build deliberately malformed contracts to provoke validation errors,
    // and read rows back out of SQLite, which better-sqlite3 types as `unknown`.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
    },
  },
);
