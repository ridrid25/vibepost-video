import {
  computeAverageWatchRatio,
  computeEngagementRates,
  computeViewsVelocity,
  evaluateExperiment,
  median,
} from "./content-brigade.mjs";

const finite = (value) => typeof value === "number" && Number.isFinite(value);

export class ContentBrigadeApi {
  constructor({ url, secret, fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
    if (typeof url !== "string" || !url.trim()) throw new Error("VIBEPOST_BRIGADE_URL is required");
    if (typeof secret !== "string" || !secret) throw new Error("VIBEPOST_BRIGADE_SECRET is required");
    if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");
    const parsed = new URL(url);
    const allowedPaths = new Set(["/functions/v1/content-brigade", "/functions/v1/content-brigade/"]);
    if (parsed.protocol !== "https:" ||
        parsed.hostname !== "rjtyjybwygfkdekdzqbm.supabase.co" ||
        parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash ||
        !allowedPaths.has(parsed.pathname)) {
      throw new Error("VIBEPOST_BRIGADE_URL must be the exact VibePost HTTPS endpoint");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
      throw new Error("Content Brigade timeout must be between 1000 and 60000 ms");
    }
    this.url = parsed.toString();
    this.secret = secret;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(action, payload = {}) {
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Content-Brigade-Secret": this.secret,
      },
      body: JSON.stringify({ action, ...payload }),
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: "error",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Content Brigade API ${response.status}: ${result.error ?? "request_failed"}`);
    }
    return result;
  }

  context() {
    return this.request("context");
  }

  upsertStudioMetrics(metrics) {
    return this.request("upsert_studio_metrics", metrics);
  }

  recordPrompt(record) {
    return this.request("record_prompt", record);
  }

  annotateVideo(record) {
    return this.request("annotate_video", record);
  }

  recordExperiment(record) {
    return this.request("record_experiment", record);
  }

  recordAnalysis(record) {
    return this.request("record_analysis", record);
  }

  recordLesson(record) {
    return this.request("record_lesson", record);
  }

  runCycle() {
    return this.request("run_cycle");
  }
}

function latestByVideo(rows = []) {
  const grouped = new Map();
  for (const row of rows) {
    if (!row?.video_id) continue;
    const current = grouped.get(row.video_id);
    if (!current || new Date(row.collected_at) > new Date(current.collected_at)) {
      grouped.set(row.video_id, row);
    }
  }
  return grouped;
}

function snapshotsByVideo(rows = []) {
  const grouped = new Map();
  for (const row of rows) {
    if (!row?.video_id) continue;
    if (!grouped.has(row.video_id)) grouped.set(row.video_id, []);
    grouped.get(row.video_id).push(row);
  }
  for (const rowsForVideo of grouped.values()) {
    rowsForVideo.sort((a, b) => new Date(a.collected_at) - new Date(b.collected_at));
  }
  return grouped;
}

export function buildAccountAnalytics(context = {}) {
  const videos = Array.isArray(context.videos) ? context.videos : [];
  const snapshots = Array.isArray(context.api_metric_snapshots)
    ? context.api_metric_snapshots : [];
  const studioRows = Array.isArray(context.studio_metrics) ? context.studio_metrics : [];
  const latest = latestByVideo(snapshots);
  const histories = snapshotsByVideo(snapshots);
  const studio = new Map(studioRows.map((row) => [row.video_id, row]));
  const accountViews = videos.map((video) => latest.get(video.id)?.views).filter(finite);
  const accountMedianViews = median(accountViews);

  const records = videos.map((video) => {
    const history = histories.get(video.id) ?? [];
    const current = latest.get(video.id) ?? null;
    const previous = history.length > 1 ? history[history.length - 2] : null;
    const studioMetrics = studio.get(video.id) ?? null;
    const views = current?.views;
    return {
      video,
      latest_api_snapshot: current,
      studio_metrics: studioMetrics,
      calculated: {
        ...computeEngagementRates({ ...current, saves: studioMetrics?.saves }),
        average_watch_ratio: computeAverageWatchRatio(studioMetrics ?? {}, video.duration_seconds),
        views_velocity: previous && current ? computeViewsVelocity(previous, current) : null,
        relative_views_vs_account_median: finite(views) && finite(accountMedianViews) && accountMedianViews > 0
          ? views / accountMedianViews : null,
      },
      sources: {
        views: current ? "api" : null,
        likes: current ? "api" : null,
        comments: current ? "api" : null,
        shares: current ? "api" : null,
        saves: studioMetrics?.saves === null || studioMetrics?.saves === undefined
          ? null : "manual_tiktok_studio",
        retention: studioMetrics?.average_retention_percent === null ||
            studioMetrics?.average_retention_percent === undefined
          ? null : "manual_tiktok_studio",
        calculated: "calculated",
      },
      comparisons: null,
    };
  });

  const recordById = new Map(records.map((record) => [record.video.id, record]));
  const experimentById = new Map((context.experiments ?? []).map((row) => [row.id, row]));
  const cohortViews = (predicate) => records.filter(predicate)
    .map((record) => record.latest_api_snapshot?.views).filter(finite);
  records.forEach((record, index) => {
    const video = record.video;
    const experiment = experimentById.get(video.experiment_id);
    const control = experiment?.control_video_id
      ? recordById.get(experiment.control_video_id) ?? null : null;
    const prior = records[index + 1] ?? null;
    record.comparisons = {
      previous_video: prior ? {
        video_id: prior.video.id,
        views: prior.latest_api_snapshot?.views ?? null,
      } : null,
      same_topic_and_format_median_views: video.topic && video.content_format
        ? median(cohortViews((candidate) => candidate.video.id !== video.id &&
          candidate.video.topic === video.topic &&
          candidate.video.content_format === video.content_format)) : null,
      same_topic_median_views: video.topic
        ? median(cohortViews((candidate) => candidate.video.id !== video.id &&
          candidate.video.topic === video.topic)) : null,
      same_format_median_views: video.content_format
        ? median(cohortViews((candidate) => candidate.video.id !== video.id &&
          candidate.video.content_format === video.content_format)) : null,
      account_median_views: accountMedianViews,
      control_video: control ? {
        video_id: control.video.id,
        views: control.latest_api_snapshot?.views ?? null,
      } : null,
    };
  });

  const promptByVideo = new Map((context.prompt_records ?? []).map((row) => [row.video_id, row]));
  const checkpointHours = { "1h": 1, "6h": 6, "24h": 24, "72h": 72, "7d": 168 };
  const checkpointToleranceHours = { "1h": 0.5, "6h": 0.5, "24h": 1, "72h": 3, "7d": 12 };
  const checkpointSnapshot = (videoId, checkpoint) => {
    const target = checkpointHours[checkpoint];
    const tolerance = checkpointToleranceHours[checkpoint];
    if (!finite(target) || !finite(tolerance)) return null;
    const candidates = (histories.get(videoId) ?? []).filter((snapshot) =>
      finite(snapshot.age_hours) && Math.abs(snapshot.age_hours - target) <= tolerance);
    return candidates.sort((left, right) =>
      Math.abs(left.age_hours - target) - Math.abs(right.age_hours - target))[0] ?? null;
  };
  const parametersFor = (video) => ({
    topic: video.topic ?? null,
    content_format: video.content_format ?? null,
    duration_bin: finite(video.duration_seconds)
      ? `${Math.floor(video.duration_seconds / 5) * 5}-${Math.floor(video.duration_seconds / 5) * 5 + 4}`
      : null,
    character_id: video.character_id ?? null,
    visual_style_id: video.visual_style_id ?? null,
    hook_type: video.hook_type ?? null,
    pacing_profile: video.pacing_profile ?? null,
    punch_type: video.punch_type ?? null,
    loop_type: video.loop_type ?? null,
    camera_profile: video.camera_profile ?? null,
    prompt_framework_version: video.prompt_framework_version ?? null,
  });
  const rateSample = (record, metric, checkpoint) => {
    const snapshot = record?.latest_api_snapshot;
    const views = snapshot?.views;
    if (!finite(views) || !Number.isInteger(views)) return null;
    const targetAge = checkpointHours[checkpoint];
    const tolerance = checkpointToleranceHours[checkpoint];
    const capturedAt = new Date(record?.studio_metrics?.captured_at).getTime();
    const publishedAt = new Date(record?.video?.published_at).getTime();
    const studioAge = (capturedAt - publishedAt) / 3_600_000;
    const alignedSaves = finite(studioAge) && finite(targetAge) && finite(tolerance) &&
        Math.abs(studioAge - targetAge) <= tolerance
      ? record?.studio_metrics?.saves : null;
    const numerator = metric === "like_rate" ? snapshot.likes
      : metric === "comment_rate" ? snapshot.comments
      : metric === "share_rate" ? snapshot.shares
      : metric === "save_rate" ? alignedSaves
      : metric === "engagement_public"
      ? [snapshot.likes, snapshot.comments, snapshot.shares].every(finite)
        ? snapshot.likes + snapshot.comments + snapshot.shares : null
      : null;
    return Number.isInteger(numerator) && numerator >= 0
      ? { successes: numerator, trials: views } : null;
  };
  const experimentEvaluations = [];
  for (const experiment of context.experiments ?? []) {
    const spec = experiment.success_metrics ?? {};
    const control = recordById.get(experiment.control_video_id);
    for (const variant of records.filter((record) => record.video.experiment_id === experiment.id)) {
      const checkpoint = spec.checkpoint;
      const variantCheckpoint = checkpointSnapshot(variant.video.id, checkpoint);
      const controlCheckpoint = control
        ? checkpointSnapshot(control.video.id, checkpoint) : null;
      const evaluation = evaluateExperiment({
        experiment_id: experiment.id,
        primary_metric: spec.primary_metric,
        metric_kind: "rate",
        direction: spec.direction,
        checkpoint,
        mde: spec.mde,
        reached_checkpoint: Boolean(variantCheckpoint && controlCheckpoint),
        comparison_kind: "explicit_control",
        reference_video_count: control ? 1 : 0,
        control_sample: rateSample(control
          ? { ...control, latest_api_snapshot: controlCheckpoint } : null,
          spec.primary_metric, checkpoint),
        variant_sample: rateSample({ ...variant, latest_api_snapshot: variantCheckpoint },
          spec.primary_metric, checkpoint),
        control_parameters: control ? parametersFor(control.video) : null,
        variant_parameters: parametersFor(variant.video),
        sources_compatible: spec.primary_metric === "save_rate"
          ? Boolean(rateSample(control
            ? { ...control, latest_api_snapshot: controlCheckpoint } : null,
            spec.primary_metric, checkpoint) &&
            rateSample({ ...variant, latest_api_snapshot: variantCheckpoint },
              spec.primary_metric, checkpoint))
          : true,
        technical_valid: promptByVideo.get(variant.video.id)?.technical_valid === true,
        interventions: Array.isArray(spec.interventions) ? spec.interventions : [],
      });
      experimentEvaluations.push({
        experiment_id: experiment.id,
        video_id: variant.video.id,
        checkpoint: checkpoint ?? null,
        ...evaluation,
      });
    }
  }

  const latestPublished = records.find((record) => record.latest_api_snapshot) ?? null;
  const latestViews = latestPublished?.latest_api_snapshot?.views;
  const hasStudioRetention = finite(latestPublished?.studio_metrics?.average_retention_percent) ||
    finite(latestPublished?.studio_metrics?.full_watch_percent) ||
    finite(latestPublished?.studio_metrics?.average_watch_time_seconds);
  const limitations = [];
  if (!latestPublished) limitations.push("No synchronized TikTok video metrics");
  if (!finite(latestViews) || latestViews < 400) limitations.push("Latest video has fewer than 400 views");
  if (!hasStudioRetention) limitations.push("TikTok Studio retention metrics are missing");
  if (!latestPublished?.video?.experiment_id) limitations.push("Latest video is not linked to an experiment");

  return {
    account_summary: {
      video_count: videos.length,
      videos_with_api_metrics: latest.size,
      videos_with_studio_metrics: studio.size,
      median_latest_views: accountMedianViews,
    },
    previous_content_review: {
      conclusion: "INCONCLUSIVE",
      main_problem: hasStudioRetention ? "UNKNOWN" : "UNKNOWN",
      evidence: latestPublished ? [{
        video_id: latestPublished.video.id,
        views: latestViews ?? null,
        public_engagement_rate: latestPublished.calculated.engagement_public,
        relative_views_vs_account_median:
          latestPublished.calculated.relative_views_vs_account_median,
      }] : [],
      confidence: "LOW",
      sample_size: { views: finite(latestViews) ? latestViews : null, videos: videos.length },
      limitations,
    },
    videos: records,
    experiment_evaluations: experimentEvaluations,
    memory: {
      hypotheses: context.hypotheses ?? [],
      lessons: context.lessons ?? [],
      current_prompt_framework: context.current_prompt_framework ?? null,
      experiments: context.experiments ?? [],
      analysis_results: context.analysis_results ?? [],
      prompt_records: context.prompt_records ?? [],
    },
  };
}

export async function runLearningCycle(api, context) {
  const analytics = buildAccountAnalytics(context);
  const existingAnalyses = new Set((context.analysis_results ?? []).map((row) =>
    `${row.experiment_id ?? "none"}|${row.video_id}|${row.checkpoint}`));
  const existingLessonEvidence = new Set();
  for (const lesson of context.lessons ?? []) {
    for (const evidence of lesson.evidence ?? []) {
      if (evidence?.experiment_id && evidence?.video_id && evidence?.checkpoint) {
        existingLessonEvidence.add(`${evidence.experiment_id}|${evidence.video_id}|${evidence.checkpoint}`);
      }
    }
  }
  const experiments = new Map((context.experiments ?? []).map((row) => [row.id, row]));
  const persisted = { analyses: 0, hypothesis_lessons: 0 };

  for (const evaluation of analytics.experiment_evaluations) {
    const key = `${evaluation.experiment_id}|${evaluation.video_id}|${evaluation.checkpoint}`;
    let authoritative = (context.analysis_results ?? []).find((row) =>
      `${row.experiment_id ?? "none"}|${row.video_id}|${row.checkpoint}` === key) ?? null;
    if (!existingAnalyses.has(key)) {
      const response = await api.recordAnalysis({
        video_id: evaluation.video_id,
        experiment_id: evaluation.experiment_id,
        checkpoint: evaluation.checkpoint,
      });
      authoritative = response?.analysis_result ?? null;
      existingAnalyses.add(key);
      persisted.analyses++;
    }

    if (authoritative?.conclusion && authoritative.conclusion !== "INCONCLUSIVE" &&
        !existingLessonEvidence.has(key)) {
      const experiment = experiments.get(evaluation.experiment_id);
      await api.recordLesson({
        lesson: `Эксперимент ${evaluation.experiment_id}: ${authoritative.conclusion}. ` +
          "Одиночное наблюдение; требуется независимое подтверждение.",
        category: "HYPOTHESIS",
        status: "HYPOTHESIS",
        confidence: "LOW",
        evidence: [{
          experiment_id: evaluation.experiment_id,
          video_id: evaluation.video_id,
          checkpoint: evaluation.checkpoint,
          conclusion: authoritative.conclusion,
          hypothesis: experiment?.hypothesis ?? null,
        }],
        videos_used: [evaluation.video_id],
        sample_size: authoritative.sample_size ?? evaluation.sample_size,
        applicable_topics: [],
      });
      existingLessonEvidence.add(key);
      persisted.hypothesis_lessons++;
    }
  }

  return {
    analytics,
    persisted,
    next_hypothesis: persisted.hypothesis_lessons > 0
      ? "HYPOTHESIS_RECORDED_REQUIRES_CREATIVE_CYCLE"
      : "NO STRONG HYPOTHESIS",
  };
}
