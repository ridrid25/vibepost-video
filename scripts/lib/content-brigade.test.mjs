import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFastCycleContext,
  computeAverageWatchRatio,
  computeEngagementRates,
  computeViewsVelocity,
  diffMaterialVariables,
  evaluateExperiment,
  median,
  newcombeDifferenceInterval,
  safeRate,
  wilsonInterval,
} from "./content-brigade.mjs";

const eligibleRateExperiment = (overrides = {}) => ({
  experiment_id: "experiment-1",
  primary_metric: "share_rate",
  metric_kind: "rate",
  direction: "increase",
  checkpoint: "24h",
  mde: 0.01,
  reached_checkpoint: true,
  comparison_kind: "explicit_control",
  reference_video_count: 1,
  control_sample: { successes: 40, trials: 1000 },
  variant_sample: { successes: 80, trials: 1000 },
  control_parameters: { hook_type: "question", topic: "credit" },
  variant_parameters: { hook_type: "conflict", topic: "credit" },
  sources_compatible: true,
  technical_valid: true,
  interventions: [],
  ...overrides,
});

test("safeRate preserves missing values and rejects zero denominator", () => {
  assert.equal(safeRate(null, 10), null);
  assert.equal(safeRate(1, 0), null);
  assert.equal(safeRate(2, 10), 0.2);
});

test("public and extended engagement are never silently mixed", () => {
  const withoutSaves = computeEngagementRates({ views: 100, likes: 10, comments: 2, shares: 3 });
  assert.equal(withoutSaves.engagement_public, 0.15);
  assert.equal(withoutSaves.engagement_extended, null);
  assert.equal(withoutSaves.save_rate, null);

  const withSaves = computeEngagementRates({ views: 100, likes: 10, comments: 2, shares: 3, saves: 5 });
  assert.equal(withSaves.engagement_public, 0.15);
  assert.equal(withSaves.engagement_extended, 0.2);
});

test("average watch ratio may exceed one because of replays", () => {
  assert.equal(computeAverageWatchRatio({ average_watch_time_seconds: 12 }, 10), 1.2);
});

test("negative view velocity is a data anomaly", () => {
  assert.deepEqual(computeViewsVelocity(
    { views: 200, collected_at: "2026-08-15T00:00:00Z" },
    { views: 190, collected_at: "2026-08-15T01:00:00Z" },
  ), { value: null, status: "DATA_ANOMALY" });
});

test("median handles odd, even and missing values", () => {
  assert.equal(median([1, 9, 3]), 3);
  assert.equal(median([1, 2, 9, 4]), 3);
  assert.equal(median([null, undefined]), null);
});

test("Wilson/Newcombe intervals are calculated from rate counts", () => {
  const wilson = wilsonInterval(80, 1000);
  const difference = newcombeDifferenceInterval(
    { successes: 40, trials: 1000 },
    { successes: 80, trials: 1000 },
  );
  assert.ok(wilson.lower < 0.08 && wilson.upper > 0.08);
  assert.ok(difference.lower > 0);
});

test("experiment at 399 views remains INCONCLUSIVE", () => {
  const result = evaluateExperiment(eligibleRateExperiment({
    variant_sample: { successes: 30, trials: 399 },
  }));
  assert.equal(result.conclusion, "INCONCLUSIVE");
  assert.match(result.limitations.join(" "), /400/);
});

test("eligible effect above MDE is operational PASS with LOW confidence", () => {
  const result = evaluateExperiment(eligibleRateExperiment());
  assert.equal(result.conclusion, "PASS");
  assert.equal(result.confidence, "LOW");
});

test("decrease hypothesis evaluates a negative variant-control effect as beneficial", () => {
  const result = evaluateExperiment(eligibleRateExperiment({
    primary_metric: "retention_drop_second",
    direction: "decrease",
    mde: 0.05,
    control_sample: { successes: 200, trials: 1000 },
    variant_sample: { successes: 100, trials: 1000 },
  }));
  assert.equal(result.conclusion, "PASS");
  assert.ok(result.evidence[0].beneficial_effect_ci.lower >= 0.05);
});

test("two material changes make the experiment INCONCLUSIVE", () => {
  const result = evaluateExperiment(eligibleRateExperiment({
    variant_parameters: { hook_type: "conflict", topic: "debt", pacing_profile: "fast" },
    control_parameters: { hook_type: "question", topic: "credit", pacing_profile: "steady" },
  }));
  assert.equal(result.conclusion, "INCONCLUSIVE");
});

test("material variable diff is explicit", () => {
  assert.deepEqual(diffMaterialVariables(
    { topic: "credit", hook_type: "question", duration_bin: "8-10" },
    { topic: "credit", hook_type: "conflict", duration_bin: "8-10" },
  ), ["hook_type"]);
});

test("caller-supplied CI and unknown material change cannot manufacture PASS", () => {
  const result = evaluateExperiment(eligibleRateExperiment({
    effect_ci: { lower: 0.9, upper: 1 },
    material_changes: ["not_a_material_variable"],
    variant_parameters: { hook_type: "question", topic: "credit" },
  }));
  assert.equal(result.conclusion, "INCONCLUSIVE");
  assert.match(result.limitations.join(" "), /exactly one material variable/);
});

test("tiny control sample keeps a rate experiment INCONCLUSIVE", () => {
  const result = evaluateExperiment(eligibleRateExperiment({
    control_sample: { successes: 1, trials: 11 },
  }));
  assert.equal(result.conclusion, "INCONCLUSIVE");
  assert.match(result.limitations.join(" "), /control views below/);
});

test("FAST context refuses to invent a hypothesis without data", () => {
  const context = buildFastCycleContext();
  assert.equal(context.previous_lesson.status, "UNKNOWN");
  assert.equal(context.hypothesis, "NO STRONG HYPOTHESIS");
  assert.equal(context.critic_verdict, "REVISE");
});

test("FAST context cannot approve missing hook, script or production prompt", () => {
  const context = buildFastCycleContext({ memory: { critic_verdict: "APPROVE" } });
  assert.equal(context.critic_verdict, "REVISE");
});

test("FAST context rejects empty prompt sections and unsupported hypotheses", () => {
  const emptyPrompt = Object.fromEntries([
    "objective", "hook", "character", "scene", "action_timeline", "camera",
    "pacing", "emotion", "punchline", "loop", "visual_style", "constraints",
    "experiment_variable",
  ].map((key) => [key, null]));
  const checks = Object.fromEntries([
    "first_second_clear", "reason_to_continue", "no_extra_scenes", "punch_clear",
    "works_without_sound", "hypothesis_aligned", "single_variable", "no_contradictions",
    "action_starts_immediately", "movement_unambiguous", "lessons_applied",
    "failed_patterns_avoided", "visual_style_preserved", "not_overloaded",
  ].map((key) => [key, true]));
  const context = buildFastCycleContext({
    memory: {
      next_hypothesis: "arbitrary claim",
      hypothesis_status: "CONFIRMED",
      hypothesis_evidence_ids: ["fake"],
      selected_hook: "hook",
      script: "script",
      gemini_production_prompt: emptyPrompt,
      critic_review: { verdict: "APPROVE", checks },
    },
  });
  assert.equal(context.hypothesis, "NO STRONG HYPOTHESIS");
  assert.equal(context.critic_verdict, "REVISE");
});

test("FAST hypothesis evidence must bind to the evaluated experiment", () => {
  const previousResult = evaluateExperiment(eligibleRateExperiment());
  const context = buildFastCycleContext({
    previousResult,
    memory: {
      next_hypothesis: "fabricated unrelated claim",
      hypothesis_status: "HYPOTHESIS",
      hypothesis_evidence_ids: ["fake"],
    },
  });
  assert.equal(context.hypothesis, "NO STRONG HYPOTHESIS");
  assert.deepEqual(context.previous_lesson.evidence_ids, ["experiment-1"]);
});
