/**
 * The per-exercise detail (design spec §5): a readiness headline (full, unwindowed
 * history) plus three windowed charts — load x reps (one chart, reps direct-labeled on
 * every point per spec §9), volume, difficulty distribution. Rendered twice, under
 * "Left"/"Right", for a per_side exercise (spec §2, decision 9).
 */

import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { contractOfVersion, getCurrentVersion, getPlanBySlug } from "$lib/db/read";
import { logsForPlan } from "$lib/db/logs";
import { filterLogsToWindow } from "$lib/export/bundle";
import { exportWindowOptions, resolveExportWindow } from "$lib/export/windows";
import { isoDate } from "$lib/export/summary";
import {
  buildExerciseSeries,
  difficultyDistribution,
  exerciseOccurrences,
  topSetChartPoints,
  volumePoints,
} from "$lib/progress/exercise-series";
import {
  doubleProgressionState,
  formatDoubleProgressionState,
} from "$lib/progress/double-progression";

export const load: PageServerLoad = ({ params, locals, url }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");

  const userDb = getUserDbFor(user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan || plan.archived_at) throw error(404, "No such plan");

  const version = getCurrentVersion(userDb, plan.id);
  if (!version) throw error(409, "That plan has no current version");
  const contract = contractOfVersion(version);

  // Resolved through `exerciseOccurrences` rather than a second walk of the session's
  // blocks: one definition of "the full-tracking occurrence of this exercise in this
  // session", shared with the list this page is reached from and with summary.ts.
  const occurrence = exerciseOccurrences(contract).find(
    (o) => o.sessionKey === params.session && o.exerciseSlug === params.exercise,
  );
  if (!occurrence) throw error(404, "That exercise is not prescribed in this session");
  const resolved = occurrence.resolved;

  const logs = logsForPlan(userDb, plan.id);
  const fullSeries = buildExerciseSeries(logs, params.session, params.exercise);

  const context = {
    versionNo: version.version_no,
    importedAt: version.imported_at,
    blockLengthWeeks: version.block_length_weeks,
    now: new Date(),
  };
  const options = exportWindowOptions(context);
  // `exportWindowOptions` always returns at least `since_version` and `full`, so
  // `options[0]` is never undefined — the assertion documents that invariant rather
  // than papering over a real gap (matches the progress hub's own load function).
  const windowId = url.searchParams.get("window") ?? options[0]!.id;
  const window = resolveExportWindow(windowId, context) ?? options[0]!;
  const windowedSeries = buildExerciseSeries(
    filterLogsToWindow(logs, window),
    params.session,
    params.exercise,
  );

  const target = resolved.type === "time" ? resolved.durationSec : resolved.reps;
  const readiness = doubleProgressionState(
    fullSeries,
    target,
    resolved.sets,
    resolved.type,
    resolved.perSide,
  );

  const sides: ("left" | "right" | undefined)[] = resolved.perSide
    ? ["left", "right"]
    : [undefined];

  const charts = sides.map((side) => {
    // Volume is Σ(weight × reps): meaningless without a load, and there are no reps to
    // multiply on a timed movement (spec §5 skips it for `type: time`).
    const effort = topSetChartPoints(windowedSeries, side, resolved.type);
    const volPoints =
      resolved.type === "reps" && effort.plots === "load"
        ? volumePoints(windowedSeries, side)
        : undefined;
    return {
      side,
      readiness:
        readiness === undefined
          ? undefined
          : formatDoubleProgressionState(readiness[side ?? "none"] ?? { status: "no_data" }),
      // "Load × reps" only when there is a load; otherwise the effort itself is the
      // series, and the heading says which (see topSetChartPoints).
      effortHeading:
        effort.plots === "load"
          ? resolved.type === "time"
            ? "Load × time"
            : "Load × reps"
          : resolved.type === "time"
            ? "Time held"
            : "Reps",
      effortUnit: effort.unit,
      effortLabelUnit: resolved.type === "time" ? "s" : "reps",
      loadReps: effort.points.map((p) => ({
        x: new Date(p.startedAt).getTime(),
        y: p.value,
        label: p.label,
      })),
      volume: volPoints?.map((p) => ({ value: p.volumeKg })),
      volumeDates: volPoints?.map((p) => isoDate(new Date(p.startedAt))),
      difficulty: difficultyDistribution(windowedSeries, side),
    };
  });

  return {
    planSlug: plan.slug,
    sessionName: occurrence.sessionName,
    exerciseName: occurrence.exerciseName,
    windowOptions: options.map((o) => ({ id: o.id, label: o.label })),
    selectedWindow: window.id,
    charts,
  };
};
