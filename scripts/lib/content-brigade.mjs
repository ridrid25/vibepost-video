/**
 * Content Brigade v2 analytics primitives.
 *
 * This module is deliberately deterministic and contains no creative guesses.
 * Missing values stay null, tiny samples stay INCONCLUSIVE, and technical
 * production lessons are not promoted to TikTok audience lessons.
 */

export const DEFAULT_ANALYTICS_POLICY = Object.freeze({
  minViewsForRateDecision: 400,
  minCohortVideos: 10,
  descriptiveCohortMin: 5,
  requiredMaterialChanges: 1,
});

export const MATERIAL_VARIABLES = Object.freeze([
  "topic",
  "content_format",
  "duration_bin",
  "character_id",
  "visual_style_id",
  "hook_type",
  "pacing_profile",
  "punch_type",
  "loop_type",
  "camera_profile",
  "prompt_framework_version",
]);

const finite = (value) => typeof value === "number" && Number.isFinite(value);

export function safeRate(numerator, denominator) {
  if (!finite(numerator) || !finite(denominator) || numerator < 0 || denominator <= 0) return null;
  return numerator / denominator;
}

export function computeEngagementRates(snapshot = {}) {
  const { views, likes, comments, shares, saves } = snapshot;
  const publicComponents = [likes, comments, shares];
  const publicReady = publicComponents.every(finite);
  return {
    like_rate: safeRate(likes, views),
    comment_rate: safeRate(comments, views),
    share_rate: safeRate(shares, views),
    save_rate: safeRate(saves, views),
    engagement_public: publicReady
      ? safeRate(publicComponents.reduce((sum, value) => sum + value, 0), views)
      : null,
    engagement_extended: publicReady && finite(saves)
      ? safeRate(publicComponents.reduce((sum, value) => sum + value, saves), views)
      : null,
  };
}

export function computeAverageWatchRatio(studio = {}, durationSeconds) {
  return safeRate(studio.average_watch_time_seconds, durationSeconds);
}

export function computeViewsVelocity(previous = {}, current = {}) {
  if (!finite(previous.views) || !finite(current.views)) return null;
  const t1 = new Date(previous.collected_at).getTime();
  const t2 = new Date(current.collected_at).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2) || t2 <= t1) return null;
  const delta = current.views - previous.views;
  if (delta < 0) return { value: null, status: "DATA_ANOMALY" };
  return { value: delta / ((t2 - t1) / 3_600_000), status: "OK" };
}

export function median(values) {
  if (!Array.isArray(values)) return null;
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function relativeToMedian(value, cohortValues) {
  const cohortMedian = median(cohortValues);
  if (!finite(value) || !finite(cohortMedian) || cohortMedian === 0) return null;
  const ratio = value / cohortMedian;
  return { cohort_median: cohortMedian, ratio, relative_change_percent: (ratio - 1) * 100 };
}

export function diffMaterialVariables(control = {}, variant = {}) {
  return MATERIAL_VARIABLES.filter((key) => control[key] !== variant[key]);
}

export function wilsonInterval(successes, trials, z = 1.959963984540054) {
  if (!Number.isInteger(successes) || !Number.isInteger(trials) ||
      successes < 0 || trials <= 0 || successes > trials || !finite(z) || z <= 0) {
    return null;
  }
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) / trials) + (z2 / (4 * trials * trials))) /
    denominator;
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

export function newcombeDifferenceInterval(control, variant) {
  const controlInterval = wilsonInterval(control?.successes, control?.trials);
  const variantInterval = wilsonInterval(variant?.successes, variant?.trials);
  if (!controlInterval || !variantInterval) return null;
  const controlRate = control.successes / control.trials;
  const variantRate = variant.successes / variant.trials;
  const difference = variantRate - controlRate;
  return {
    // Newcombe hybrid-score interval (method 10); raw effect is always
    // variant - control.
    lower: Math.max(-1, difference - Math.sqrt(
      (variantRate - variantInterval.lower) ** 2 +
      (controlInterval.upper - controlRate) ** 2,
    )),
    upper: Math.min(1, difference + Math.sqrt(
      (variantInterval.upper - variantRate) ** 2 +
      (controlRate - controlInterval.lower) ** 2,
    )),
  };
}

function validRateSample(sample) {
  return Number.isInteger(sample?.successes) && Number.isInteger(sample?.trials) &&
    sample.successes >= 0 && sample.trials > 0 && sample.successes <= sample.trials;
}

export function evaluateDataGates(input = {}, policy = DEFAULT_ANALYTICS_POLICY) {
  const limitations = [];
  if (!input.primary_metric) limitations.push("primary_metric is missing");
  if (typeof input.experiment_id !== "string" || !input.experiment_id.trim()) {
    limitations.push("experiment_id is missing");
  }
  if (!input.direction) limitations.push("direction is missing");
  else if (!["increase", "decrease"].includes(input.direction)) {
    limitations.push("direction must be increase or decrease");
  }
  if (!input.checkpoint) limitations.push("checkpoint is missing");
  if (!finite(input.mde) || input.mde <= 0) limitations.push("MDE must be positive");
  if (input.reached_checkpoint !== true) limitations.push("checkpoint not reached");
  if (input.metric_kind !== "rate") limitations.push("only rate experiments are currently implemented");
  if (!validRateSample(input.variant_sample)) limitations.push("variant rate sample is invalid");
  if (!validRateSample(input.control_sample)) limitations.push("control rate sample is invalid");
  if (validRateSample(input.variant_sample) &&
      input.variant_sample.trials < policy.minViewsForRateDecision) {
    limitations.push(`variant views below ${policy.minViewsForRateDecision}`);
  }
  if (validRateSample(input.control_sample) &&
      input.control_sample.trials < policy.minViewsForRateDecision) {
    limitations.push(`control views below ${policy.minViewsForRateDecision}`);
  }
  if (input.comparison_kind !== "explicit_control" &&
      (!Number.isInteger(input.reference_video_count) ||
      input.reference_video_count < policy.minCohortVideos)) {
    limitations.push(`reference cohort below ${policy.minCohortVideos}`);
  }
  const materialChanges = diffMaterialVariables(input.control_parameters, input.variant_parameters);
  if (!input.control_parameters || !input.variant_parameters ||
      materialChanges.length !== policy.requiredMaterialChanges) {
    limitations.push("experiment must change exactly one material variable");
  }
  if (input.sources_compatible !== true) limitations.push("metric sources/components are incompatible");
  if (input.technical_valid !== true) limitations.push("video did not technically implement the prompt");
  if (Array.isArray(input.interventions) && input.interventions.length) {
    limitations.push(`external interventions: ${input.interventions.join(", ")}`);
  }
  return { eligible: limitations.length === 0, limitations, material_changes: materialChanges };
}

export function evaluateExperiment(input = {}, policy = DEFAULT_ANALYTICS_POLICY) {
  const gates = evaluateDataGates(input, policy);
  const sampleSize = {
    audience_sample_size: validRateSample(input.variant_sample) ? input.variant_sample.trials : null,
    control_sample_size: validRateSample(input.control_sample) ? input.control_sample.trials : null,
    reference_video_count: Number.isInteger(input.reference_video_count)
      ? input.reference_video_count
      : null,
  };
  if (!gates.eligible) {
    return {
      conclusion: "INCONCLUSIVE",
      evidence: [],
      confidence: "LOW",
      sample_size: sampleSize,
      limitations: gates.limitations,
    };
  }

  const rawEffect = newcombeDifferenceInterval(input.control_sample, input.variant_sample);
  if (!rawEffect) {
    return {
      conclusion: "INCONCLUSIVE",
      evidence: [],
      confidence: "LOW",
      sample_size: sampleSize,
      limitations: ["effect confidence interval could not be calculated"],
    };
  }
  // effect_ci is always variant - control. Convert it to a positive
  // "beneficial effect" before applying MDE so decrease hypotheses (for
  // example early drop-off) are evaluated in the intended direction.
  const beneficialEffect = input.direction === "decrease"
    ? { lower: -rawEffect.upper, upper: -rawEffect.lower }
    : { lower: rawEffect.lower, upper: rawEffect.upper };
  const conclusion = beneficialEffect.lower >= input.mde
    ? "PASS"
    : beneficialEffect.upper < input.mde
    ? "FAIL"
    : "INCONCLUSIVE";
  return {
    conclusion,
    evidence: [{
      evidence_id: input.experiment_id,
      primary_metric: input.primary_metric,
      checkpoint: input.checkpoint,
      effect_ci: rawEffect,
      beneficial_effect_ci: beneficialEffect,
      direction: input.direction,
      mde: input.mde,
      changed_variable: gates.material_changes[0],
      control_rate: safeRate(input.control_sample.successes, input.control_sample.trials),
      variant_rate: safeRate(input.variant_sample.successes, input.variant_sample.trials),
    }],
    // One observational experiment never creates a confirmed causal rule.
    confidence: "LOW",
    sample_size: sampleSize,
    limitations: conclusion === "INCONCLUSIVE" ? ["effect interval crosses MDE"] : [],
  };
}

export function buildFastCycleContext({ previousResult, memory = {} } = {}) {
  const usableLesson = previousResult?.conclusion && previousResult.conclusion !== "INCONCLUSIVE";
  const hypothesisEvidence = Array.isArray(memory.hypothesis_evidence_ids)
    ? memory.hypothesis_evidence_ids.filter((id) => typeof id === "string" && id.trim())
    : [];
  const knownEvidenceIds = usableLesson
    ? previousResult.evidence?.map((item) => item.evidence_id).filter(Boolean) ?? []
    : [];
  const evidenceBound = hypothesisEvidence.length > 0 &&
    hypothesisEvidence.every((id) => knownEvidenceIds.includes(id));
  // One local evaluated experiment can only support a HYPOTHESIS. Promotion
  // is reserved for the future persistent Learning Memory.
  const hypothesisStatusValid = memory.hypothesis_status === "HYPOTHESIS";
  const hypothesis = usableLesson && hypothesisStatusValid && evidenceBound &&
      typeof memory.next_hypothesis === "string" && memory.next_hypothesis.trim()
    ? memory.next_hypothesis.trim()
    : "NO STRONG HYPOTHESIS";
  const prompt = memory.gemini_production_prompt;
  const requiredPromptSections = [
    "objective", "hook", "character", "scene", "action_timeline", "camera",
    "pacing", "emotion", "punchline", "loop", "visual_style", "constraints",
    "experiment_variable",
  ];
  const meaningful = (value) => {
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0 && value.every(meaningful);
    if (value && typeof value === "object") {
      const values = Object.values(value);
      return values.length > 0 && values.every(meaningful);
    }
    return typeof value === "number" || typeof value === "boolean";
  };
  const artifactsComplete = typeof memory.selected_hook === "string" &&
    memory.selected_hook.trim().length > 0 &&
    typeof memory.script === "string" && memory.script.trim().length > 0 &&
    prompt && typeof prompt === "object" && !Array.isArray(prompt) &&
    requiredPromptSections.every((key) => Object.hasOwn(prompt, key) && meaningful(prompt[key]));
  const criticChecks = memory.critic_review?.checks;
  const requiredCriticChecks = [
    "first_second_clear", "reason_to_continue", "no_extra_scenes", "punch_clear",
    "works_without_sound", "hypothesis_aligned", "single_variable", "no_contradictions",
    "action_starts_immediately", "movement_unambiguous", "lessons_applied",
    "failed_patterns_avoided", "visual_style_preserved", "not_overloaded",
  ];
  const criticComplete = memory.critic_review?.verdict === "APPROVE" &&
    criticChecks && requiredCriticChecks.every((key) => criticChecks[key] === true);
  const criticVerdict = criticComplete && artifactsComplete
    ? "APPROVE"
    : "REVISE";
  return {
    previous_lesson: usableLesson
      ? {
          status: "HYPOTHESIS",
          text: "Single-result observation; requires independent confirmation.",
          evidence_ids: knownEvidenceIds,
          limitations: previousResult.limitations ?? [],
        }
      : {
          status: previousResult ? "INCONCLUSIVE" : "UNKNOWN",
          text: previousResult ? "Данных недостаточно для нового Lesson." : "TikTok results are not connected yet.",
          evidence_ids: [],
          limitations: previousResult?.limitations ?? ["No live TikTok metrics"],
        },
    hypothesis,
    experiment_variable: memory.experiment_variable ?? null,
    selected_hook: memory.selected_hook ?? null,
    script: memory.script ?? null,
    gemini_production_prompt: prompt ?? null,
    critic_verdict: criticVerdict,
    confidence: usableLesson ? previousResult.confidence : "LOW",
  };
}
