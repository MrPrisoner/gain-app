/**
 * The GAIN plan contract — Zod implementation of `docs/CONTRACT.md` (spec v1).
 *
 * `docs/CONTRACT.md` is authoritative; where this file and the spec disagree, the spec
 * wins. Contract changes touch three places together: `docs/CONTRACT.md`, this file,
 * and `fixtures/plans/home-dumbbell-v1.md`.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** CONTRACT §4: slugs are lowercase, hyphenated ASCII. */
const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const slug = z.string().regex(SLUG_REGEX, {
  error:
    "must be a slug — lowercase ASCII letters and digits separated by single hyphens, e.g. `supported-one-arm-row`",
});

const nonEmptyString = z.string().min(1, { error: "must be a non-empty string" });

/**
 * CONTRACT §4: ranges are `[min, max]`; any field accepting a range also accepts a
 * bare integer meaning "exactly this".
 */
function intOrRange(what: string, min: number) {
  const base = z.number().int().min(min);
  return z.union([
    base,
    z.tuple([base, base]).refine(([lo, hi]) => lo <= hi, {
      error: `${what}: in a [min, max] range, min must be less than or equal to max`,
    }),
  ]);
}

const repsValue = intOrRange("reps", 1);
const setsValue = intOrRange("sets", 1);
const durationValue = intOrRange("duration_sec", 1);
const restValue = intOrRange("rest_sec", 0);

/** An integer or `[min, max]` range, as accepted by reps/sets/duration_sec/rest_sec. */
export type IntOrRange = number | [number, number];

// ---------------------------------------------------------------------------
// loads
// ---------------------------------------------------------------------------

const loadConfig = z.strictObject({
  ref: nonEmptyString,
  label: nonEmptyString,
  default_kg: z.number().positive().optional(),
  is_bodyweight: z.boolean().optional(),
  note: nonEmptyString.optional(),
});

export type LoadConfig = z.infer<typeof loadConfig>;

// ---------------------------------------------------------------------------
// exercises — the catalogue
// ---------------------------------------------------------------------------

const exerciseDef = z.strictObject({
  id: slug,
  name: nonEmptyString.optional(),
  type: z.enum(["reps", "time"]).optional(),
  per_side: z.boolean().optional(),
  load: nonEmptyString.optional(),
  rest_sec: restValue.optional(),
  note: nonEmptyString.optional(),
  conditional: z.boolean().optional(),
  condition: nonEmptyString.optional(),
  substitutes: z.array(slug).optional(),
});

export type ExerciseDef = z.infer<typeof exerciseDef>;

/**
 * CONTRACT §3, name derivation: hyphens become spaces, first letter capitalised.
 * `goblet-squat` → "Goblet squat".
 */
export function deriveExerciseName(id: string): string {
  const spaced = id.replaceAll("-", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ---------------------------------------------------------------------------
// sessions → blocks → prescriptions
// ---------------------------------------------------------------------------

const prescription = z.strictObject({
  id: slug,
  sets: setsValue.optional(),
  reps: repsValue.optional(),
  duration_sec: durationValue.optional(),
  load: nonEmptyString.optional(),
  rest_sec: restValue.optional(),
  note: nonEmptyString.optional(),
  conditional: z.boolean().optional(),
  condition: nonEmptyString.optional(),
  substitutes: z.array(slug).optional(),
});

export type Prescription = z.infer<typeof prescription>;

const block = z
  .strictObject({
    key: nonEmptyString,
    name: nonEmptyString,
    type: z.enum(["sequence", "rounds"]).optional(),
    rounds: z.number().int().min(1).optional(),
    rest_sec: restValue.optional(),
    tracking: z.enum(["full", "checkoff"]).optional(),
    note: nonEmptyString.optional(),
    exercises: z
      .array(prescription)
      .min(1, { error: "a block must contain at least one exercise" }),
  })
  .superRefine((b, ctx) => {
    const isRounds = b.type === "rounds";

    if (isRounds && b.rounds === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["rounds"],
        message: "`rounds` is required when `type: rounds`",
      });
    }
    if (!isRounds && b.rounds !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["rounds"],
        message: "`rounds` is only valid on `type: rounds` blocks",
      });
    }
    if (!isRounds && b.rest_sec !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["rest_sec"],
        message:
          "block-level `rest_sec` is only valid on `type: rounds` blocks — rest between straight sets is a property of the movement and belongs on the catalogue entry",
      });
    }
    if (isRounds) {
      b.exercises.forEach((ex, i) => {
        if (ex.sets !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["exercises", i, "sets"],
            message:
              "`sets` is invalid inside a `type: rounds` block — `rounds` is the only multiplier there",
          });
        }
      });
    }
  });

export type Block = z.infer<typeof block>;

const session = z.strictObject({
  key: nonEmptyString,
  name: nonEmptyString,
  order: z.number().int().min(1),
  note: nonEmptyString.optional(),
  blocks: z.array(block).min(1, { error: "a session must contain at least one block" }),
});

export type Session = z.infer<typeof session>;

// ---------------------------------------------------------------------------
// metrics
// ---------------------------------------------------------------------------

const metricType = z.enum(["number", "scale", "enum", "text", "bool"]);
const promptWhen = z.enum(["start", "end", "next_morning"]);

export type MetricScope = "set" | "exercise" | "session";

function metricDef(scope: MetricScope) {
  return z
    .strictObject({
      key: nonEmptyString,
      label: nonEmptyString,
      type: metricType,
      min: z.number().optional(),
      max: z.number().optional(),
      options: z.array(nonEmptyString).optional(),
      optional: z.boolean().optional(),
      prompt_when: promptWhen.optional(),
    })
    .superRefine((m, ctx) => {
      const numeric = m.type === "number" || m.type === "scale";

      if (numeric) {
        if (m.min === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["min"],
            message: `\`min\` is required for metric type \`${m.type}\``,
          });
        }
        if (m.max === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["max"],
            message: `\`max\` is required for metric type \`${m.type}\``,
          });
        }
        if (m.min !== undefined && m.max !== undefined && m.min > m.max) {
          ctx.addIssue({
            code: "custom",
            path: ["max"],
            message: "`max` must be greater than or equal to `min`",
          });
        }
        if (m.options !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["options"],
            message: `\`options\` only applies to metric type \`enum\`, not \`${m.type}\``,
          });
        }
      }

      if (m.type === "enum") {
        if (m.options === undefined || m.options.length === 0) {
          ctx.addIssue({
            code: "custom",
            path: ["options"],
            message: "metric type `enum` requires a non-empty `options` list",
          });
        }
        if (m.min !== undefined || m.max !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["min"],
            message: "`min`/`max` only apply to metric types `number` and `scale`, not `enum`",
          });
        }
      }

      if (m.type === "text" || m.type === "bool") {
        if (m.min !== undefined || m.max !== undefined || m.options !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["type"],
            message: `\`min\`, \`max\` and \`options\` do not apply to metric type \`${m.type}\``,
          });
        }
      }

      if (scope !== "session" && m.prompt_when !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["prompt_when"],
          message:
            "`prompt_when` applies to session-scope metrics only — a `set` metric is prompted with each set and an `exercise` metric once per exercise",
        });
      }
    });
}

export type MetricDef = z.infer<ReturnType<typeof metricDef>>;

const metrics = z.strictObject({
  set: z.array(metricDef("set")).optional(),
  exercise: z.array(metricDef("exercise")).optional(),
  session: z.array(metricDef("session")).optional(),
});

export type Metrics = z.infer<typeof metrics>;

// ---------------------------------------------------------------------------
// scheduling, progression, safety
// ---------------------------------------------------------------------------

const scheduling = z.strictObject({
  sequence: z.array(nonEmptyString).optional(),
  drop_order: z.array(nonEmptyString).optional(),
  rules: z.array(nonEmptyString).optional(),
});

export type Scheduling = z.infer<typeof scheduling>;

/**
 * CONTRACT §3: scheduling/progression/safety are "optional and largely free-text".
 * progression therefore accepts additional keys beyond the ones shaped here (the
 * fixture uses `hold_load_when` and `reduce_load_when`, which the spec's example does
 * not show but its free-text clause covers).
 */
const effortWeek = z.looseObject({
  week: z.number().int().min(1),
  rir: intOrRange("rir", 0).optional(),
  focus: z.string().optional(),
});

const progression = z.looseObject({
  model: z.enum(["double_progression", "linear", "none"]).optional(),
  effort_target: z.string().optional(),
  effort_by_week: z.array(effortWeek).optional(),
  increase_load_when: z.array(z.string()).optional(),
  hold_load_when: z.array(z.string()).optional(),
  reduce_load_when: z.array(z.string()).optional(),
});

export type Progression = z.infer<typeof progression>;

const symptomLevel = z.looseObject({
  level: z.enum(["green", "yellow", "red"]),
  label: z.string(),
  action: z.enum(["continue", "modify", "stop"]),
  modifications: z.array(z.string()).optional(),
});

const safety = z.looseObject({
  symptom_framework: z.array(symptomLevel).optional(),
  escalation: z.string().optional(),
});

export type Safety = z.infer<typeof safety>;

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

const plan = z
  .strictObject({
    slug,
    name: nonEmptyString,
    version: z.number().int().min(1),
    based_on_version: z.number().int().min(1).nullable(),
    block_length_weeks: z.number().int().min(1).optional(),
    session_target_min: z.number().int().min(1).optional(),
    changelog: z.array(nonEmptyString).optional(),
  })
  .superRefine((p, ctx) => {
    if (p.version > 1 && (p.changelog === undefined || p.changelog.length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["changelog"],
        message:
          "`changelog` is required (and non-empty) when `version` is above 1 — one line per substantive change, in user-facing terms",
      });
    }
    if (p.version > 1 && p.based_on_version === null) {
      ctx.addIssue({
        code: "custom",
        path: ["based_on_version"],
        message:
          "`based_on_version` cannot be null when `version` is above 1 — a revision must name the version it was built from, so logs stay bound to a real lineage. Use `1` for a first plan and leave `based_on_version: null` there.",
      });
    }
  });

export type Plan = z.infer<typeof plan>;

// ---------------------------------------------------------------------------
// The contract block
// ---------------------------------------------------------------------------

const TOP_LEVEL_KEYS = [
  "schema_version",
  "plan",
  "loads",
  "exercises",
  "sessions",
  "metrics",
  "scheduling",
  "progression",
  "safety",
] as const;

/**
 * AGENTS.md: the contract key is `plan`, and synonyms are not accepted. A revising AI
 * will reach for `program`, `routine` or `workout` — reject them loudly rather than
 * coercing them, and never reintroduce them as aliases.
 */
const PLAN_SYNONYMS: Record<string, string> = {
  program: "plan",
  programme: "plan",
  routine: "plan",
  workout: "plan",
  plan_id: "plan.slug",
  plan_version: "plan.version",
};

/**
 * The same discipline as `PLAN_SYNONYMS`, for the progression block. `progression` is a
 * `looseObject` on purpose — CONTRACT §3 calls these fields "largely free-text" and real
 * plans carry extras like `notes` and `future_progressions` — but that tolerance is
 * exactly what let a plan write `keep_load_when` and have it silently swallowed. Reject
 * the known synonyms by name; let genuinely new keys through.
 */
const PROGRESSION_SYNONYMS: Record<string, string> = {
  keep_load_when: "hold_load_when",
  maintain_load_when: "hold_load_when",
  add_load_when: "increase_load_when",
  raise_load_when: "increase_load_when",
  decrease_load_when: "reduce_load_when",
  lower_load_when: "reduce_load_when",
};

/**
 * `plan` is optional in the shape and required by refinement: that way the synonym
 * check below runs even when the AI wrote `program:` instead of `plan:` (the base
 * parse succeeds, and the refinement reports the real mistake rather than a bare
 * "plan is required").
 */
const contractBase = z.looseObject({
  schema_version: z.literal(1, { error: "must be the number 1 — this is contract v1" }),
  plan: plan.optional(),
  loads: z.array(loadConfig).min(1, { error: "declare at least one load configuration" }),
  exercises: z.array(exerciseDef).min(1, { error: "declare at least one exercise" }),
  sessions: z.array(session).min(1, { error: "declare at least one session" }),
  metrics: metrics.optional(),
  scheduling: scheduling.optional(),
  progression: progression.optional(),
  safety: safety.optional(),
});

export const contractSchema = contractBase.superRefine((c, ctx) => {
  // -- Top-level key discipline: synonyms rejected loudly, unknown keys rejected.
  let synonymSeen = false;
  for (const key of Object.keys(c)) {
    const synonym = PLAN_SYNONYMS[key];
    if (synonym !== undefined) {
      synonymSeen = true;
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `the contract key is \`${synonym}\`, not \`${key}\` — GAIN does not accept synonyms; rename this key to \`${synonym}\``,
      });
    } else if (!(TOP_LEVEL_KEYS as readonly string[]).includes(key)) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `unknown top-level key \`${key}\` — allowed keys: ${TOP_LEVEL_KEYS.map((k) => `\`${k}\``).join(", ")}`,
      });
    }
  }

  if (c.plan === undefined && !synonymSeen) {
    ctx.addIssue({
      code: "custom",
      path: ["plan"],
      message: "`plan` is required — plan identity, version and changelog live here (CONTRACT §3)",
    });
  }

  // -- loads: unique refs.
  const loadRefs = new Set<string>();
  c.loads.forEach((l, i) => {
    if (loadRefs.has(l.ref)) {
      ctx.addIssue({
        code: "custom",
        path: ["loads", i, "ref"],
        message: `duplicate load ref \`${l.ref}\` — each load configuration needs a unique \`ref\``,
      });
    }
    loadRefs.add(l.ref);
  });

  // -- catalogue: unique ids, then resolve references against the full catalogue.
  const catalogue = new Map<string, number>();
  c.exercises.forEach((ex, i) => {
    if (catalogue.has(ex.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["exercises", i, "id"],
        message: `duplicate exercise id \`${ex.id}\` — every movement is declared exactly once in the catalogue`,
      });
    } else {
      catalogue.set(ex.id, i);
    }
  });

  const checkLoadRef = (
    load: string | undefined,
    path: (string | number)[],
    where: string,
  ): void => {
    if (load !== undefined && !loadRefs.has(load)) {
      ctx.addIssue({
        code: "custom",
        path,
        message: `\`load\` references \`${load}\`, which is not declared in \`loads\` (declared refs: ${[...loadRefs].map((r) => `\`${r}\``).join(", ") || "none"}) — ${where}`,
      });
    }
  };

  const checkSubstitutes = (
    substitutes: string[] | undefined,
    basePath: (string | number)[],
  ): void => {
    substitutes?.forEach((s, j) => {
      if (!catalogue.has(s)) {
        ctx.addIssue({
          code: "custom",
          path: [...basePath, j],
          message: `substitute \`${s}\` is not declared in the \`exercises\` catalogue — declare it there, even if no session prescribes it directly`,
        });
      }
    });
  };

  c.exercises.forEach((ex, i) => {
    checkLoadRef(ex.load, ["exercises", i, "load"], "add it to `loads` or fix the ref");
    checkSubstitutes(ex.substitutes, ["exercises", i, "substitutes"]);
  });

  // -- sessions: unique keys, unique block keys, prescriptions resolve.
  const sessionKeys = new Set<string>();
  c.sessions.forEach((s, i) => {
    if (sessionKeys.has(s.key)) {
      ctx.addIssue({
        code: "custom",
        path: ["sessions", i, "key"],
        message: `duplicate session key \`${s.key}\` — session keys are stable identifiers and must be unique`,
      });
    }
    sessionKeys.add(s.key);

    const blockKeys = new Set<string>();
    s.blocks.forEach((b, j) => {
      if (blockKeys.has(b.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["sessions", i, "blocks", j, "key"],
          message: `duplicate block key \`${b.key}\` within session \`${s.key}\``,
        });
      }
      blockKeys.add(b.key);

      b.exercises.forEach((ex, k) => {
        const base = ["sessions", i, "blocks", j, "exercises", k] as (string | number)[];
        const defIndex = catalogue.get(ex.id);

        if (defIndex === undefined) {
          ctx.addIssue({
            code: "custom",
            path: [...base, "id"],
            message: `\`${ex.id}\` is not declared in the \`exercises\` catalogue — every prescribed movement must exist there`,
          });
        } else {
          const def = c.exercises[defIndex];
          if (def) {
            const type = def.type ?? "reps";
            if (type === "reps") {
              if (ex.reps === undefined) {
                ctx.addIssue({
                  code: "custom",
                  path: [...base, "reps"],
                  message: `\`reps\` is required — the catalogue declares \`${ex.id}\` as type \`reps\` (the default)`,
                });
              }
              if (ex.duration_sec !== undefined) {
                ctx.addIssue({
                  code: "custom",
                  path: [...base, "duration_sec"],
                  message: `\`duration_sec\` is only for type \`time\` exercises — the catalogue declares \`${ex.id}\` as type \`reps\``,
                });
              }
            } else {
              if (ex.duration_sec === undefined) {
                ctx.addIssue({
                  code: "custom",
                  path: [...base, "duration_sec"],
                  message: `\`duration_sec\` is required — the catalogue declares \`${ex.id}\` as type \`time\``,
                });
              }
              if (ex.reps !== undefined) {
                ctx.addIssue({
                  code: "custom",
                  path: [...base, "reps"],
                  message: `\`reps\` is only for type \`reps\` exercises — the catalogue declares \`${ex.id}\` as type \`time\``,
                });
              }
            }
          }
        }

        checkLoadRef(ex.load, [...base, "load"], "add it to `loads` or fix the ref");
        checkSubstitutes(ex.substitutes, [...base, "substitutes"]);
      });
    });
  });

  // -- metrics: keys unique within their scope.
  for (const scope of ["set", "exercise", "session"] as const) {
    const list = c.metrics?.[scope];
    if (!list) continue;
    const seen = new Set<string>();
    list.forEach((m, i) => {
      if (seen.has(m.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["metrics", scope, i, "key"],
          message: `duplicate metric key \`${m.key}\` in scope \`${scope}\` — keys are unique within their scope`,
        });
      }
      seen.add(m.key);
    });
  }

  // -- scheduling: references must resolve to declared session keys.
  const checkSessionRefs = (keys: string[] | undefined, field: "sequence" | "drop_order"): void => {
    keys?.forEach((key, i) => {
      if (!sessionKeys.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["scheduling", field, i],
          message: `\`${key}\` is not a declared session \`key\` (declared: ${[...sessionKeys].map((k) => `\`${k}\``).join(", ") || "none"})`,
        });
      }
    });
  };
  checkSessionRefs(c.scheduling?.sequence, "sequence");
  checkSessionRefs(c.scheduling?.drop_order, "drop_order");

  // -- progression: known synonyms rejected by name (see PROGRESSION_SYNONYMS).
  for (const [wrong, right] of Object.entries(PROGRESSION_SYNONYMS)) {
    if (c.progression !== undefined && wrong in c.progression) {
      ctx.addIssue({
        code: "custom",
        path: ["progression", wrong],
        message: `\`${wrong}\` is not a contract key — use \`${right}\`. The two mean the same thing, and only \`${right}\` is read.`,
      });
    }
  }
});

/**
 * A fully validated GAIN plan contract — the parsed contents of a `gain-plan` block.
 *
 * Declared by hand rather than inferred: the schema is a `looseObject` (unknown keys
 * pass through so the refinement can reject synonyms loudly), and zod v4's loose-object
 * output type carries an index signature that collapses `Omit` into `{}`. The
 * refinement rejects any contract without a `plan`, so `plan` is non-optional here.
 */
export type GainContract = {
  schema_version: 1;
  plan: Plan;
  loads: LoadConfig[];
  exercises: ExerciseDef[];
  sessions: Session[];
  metrics?: Metrics;
  scheduling?: Scheduling;
  progression?: Progression;
  safety?: Safety;
};
