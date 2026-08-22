import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAccountAnalytics,
  ContentBrigadeApi,
  runLearningCycle,
} from "./content-brigade-supabase.mjs";

test("API uses the narrow secret and never places it in the request body", async () => {
  let captured;
  const api = new ContentBrigadeApi({
    url: "https://rjtyjybwygfkdekdzqbm.supabase.co/functions/v1/content-brigade",
    secret: "narrow-secret",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ videos: [] }), { status: 200 });
    },
  });
  await api.context();
  assert.equal(captured.options.headers["X-Content-Brigade-Secret"], "narrow-secret");
  assert.equal(JSON.parse(captured.options.body).secret, undefined);
  assert.equal(captured.options.redirect, "error");
});

test("API errors expose status and stable server code, not credentials", async () => {
  const api = new ContentBrigadeApi({
    url: "https://rjtyjybwygfkdekdzqbm.supabase.co/functions/v1/content-brigade",
    secret: "must-not-appear",
    fetchImpl: async () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
  });
  await assert.rejects(() => api.context(), (error) => {
    assert.match(error.message, /403: forbidden/);
    assert.doesNotMatch(error.message, /must-not-appear/);
    return true;
  });
});

test("API refuses to send the secret to a wrong host or insecure URL", () => {
  for (const url of [
    "http://rjtyjybwygfkdekdzqbm.supabase.co/functions/v1/content-brigade",
    "https://evil.example/functions/v1/content-brigade",
    "https://rjtyjybwygfkdekdzqbm.supabase.co/functions/v1/content-brigade?next=evil",
  ]) {
    assert.throws(() => new ContentBrigadeApi({ url, secret: "secret" }), /exact VibePost HTTPS/);
  }
});

test("learning writes use explicit actions", async () => {
  const actions = [];
  const api = new ContentBrigadeApi({
    url: "https://rjtyjybwygfkdekdzqbm.supabase.co/functions/v1/content-brigade",
    secret: "secret",
    fetchImpl: async (_url, options) => {
      actions.push(JSON.parse(options.body).action);
      return new Response("{}", { status: 200 });
    },
  });
  await api.recordExperiment({});
  await api.recordAnalysis({});
  await api.recordLesson({});
  await api.annotateVideo({});
  assert.deepEqual(actions, ["record_experiment", "record_analysis", "record_lesson", "annotate_video"]);
});

test("API and Studio metrics keep separate source provenance", () => {
  const analytics = buildAccountAnalytics({
    videos: [{ id: "v1", published_at: "2026-08-15T12:00:00Z", duration_seconds: 10 }],
    api_metric_snapshots: [
      { video_id: "v1", views: 1000, likes: 100, comments: 10, shares: 20,
        collected_at: "2026-08-15T13:00:00Z", source: "api" },
    ],
    studio_metrics: [{ video_id: "v1", saves: 5, average_watch_time_seconds: 8,
      average_retention_percent: 80, source: "manual_tiktok_studio" }],
  });
  const video = analytics.videos[0];
  assert.equal(video.sources.views, "api");
  assert.equal(video.sources.saves, "manual_tiktok_studio");
  assert.equal(video.sources.calculated, "calculated");
  assert.equal(video.calculated.average_watch_ratio, 0.8);
});

test("missing Studio metrics stay null and do not manufacture a conclusion", () => {
  const analytics = buildAccountAnalytics({
    videos: [{ id: "v1", published_at: "2026-08-15T12:00:00Z", duration_seconds: 10 }],
    api_metric_snapshots: [
      { video_id: "v1", views: 11, likes: 2, comments: 0, shares: 0,
        collected_at: "2026-08-15T13:00:00Z", source: "api" },
    ],
  });
  assert.equal(analytics.previous_content_review.conclusion, "INCONCLUSIVE");
  assert.equal(analytics.previous_content_review.main_problem, "UNKNOWN");
  assert.equal(analytics.videos[0].calculated.average_watch_ratio, null);
  assert.equal(analytics.videos[0].sources.retention, null);
});

test("negative views delta is preserved as a data anomaly", () => {
  const analytics = buildAccountAnalytics({
    videos: [{ id: "v1", published_at: "2026-08-15T12:00:00Z" }],
    api_metric_snapshots: [
      { video_id: "v1", views: 200, likes: 1, comments: 0, shares: 0,
        collected_at: "2026-08-15T13:00:00Z", source: "api" },
      { video_id: "v1", views: 190, likes: 1, comments: 0, shares: 0,
        collected_at: "2026-08-15T14:00:00Z", source: "api" },
    ],
  });
  assert.deepEqual(analytics.videos[0].calculated.views_velocity,
    { value: null, status: "DATA_ANOMALY" });
});

test("registered live experiment is compared with its explicit control", () => {
  const common = {
    topic: "credit",
    content_format: "sketch",
    duration_seconds: 10,
    character_id: "hero",
    visual_style_id: "street",
    pacing_profile: "fast",
    punch_type: "visual",
    loop_type: "match-cut",
    camera_profile: "locked",
    prompt_framework_version: "PF-v1",
  };
  const analytics = buildAccountAnalytics({
    videos: [
      { id: "variant", published_at: "2026-08-15T12:00:00Z", experiment_id: "exp-1",
        hook_type: "conflict", ...common },
      { id: "control", published_at: "2026-08-14T12:00:00Z", experiment_id: null,
        hook_type: "question", ...common },
    ],
    api_metric_snapshots: [
      { video_id: "variant", views: 1000, likes: 100, comments: 10, shares: 80,
        age_hours: 24, collected_at: "2026-08-16T12:00:00Z", source: "api" },
      { video_id: "control", views: 1000, likes: 100, comments: 10, shares: 40,
        age_hours: 24, collected_at: "2026-08-15T12:00:00Z", source: "api" },
    ],
    experiments: [{
      id: "exp-1",
      control_video_id: "control",
      success_metrics: { primary_metric: "share_rate", direction: "increase", checkpoint: "24h", mde: 0.01 },
    }],
    prompt_records: [{ video_id: "variant", technical_valid: true }],
  });
  assert.equal(analytics.experiment_evaluations[0].conclusion, "PASS");
  assert.equal(analytics.videos[0].comparisons.control_video.video_id, "control");
  assert.equal(analytics.videos[0].comparisons.previous_video.video_id, "control");
});

test("experiment stays INCONCLUSIVE when control has no comparable checkpoint", () => {
  const analytics = buildAccountAnalytics({
    videos: [
      { id: "variant", experiment_id: "exp-1", published_at: "2026-08-15T00:00:00Z",
        topic: "credit", hook_type: "conflict" },
      { id: "control", published_at: "2026-08-01T00:00:00Z",
        topic: "credit", hook_type: "question" },
    ],
    api_metric_snapshots: [
      { video_id: "variant", views: 1000, likes: 10, comments: 1, shares: 80,
        age_hours: 24, collected_at: "2026-08-16T00:00:00Z" },
      { video_id: "control", views: 1000, likes: 10, comments: 1, shares: 40,
        age_hours: 336, collected_at: "2026-08-15T00:00:00Z" },
    ],
    experiments: [{ id: "exp-1", control_video_id: "control",
      success_metrics: { primary_metric: "share_rate", direction: "increase", checkpoint: "24h", mde: 0.01 } }],
    prompt_records: [{ video_id: "variant", technical_valid: true }],
  });
  assert.equal(analytics.experiment_evaluations[0].conclusion, "INCONCLUSIVE");
  assert.match(analytics.experiment_evaluations[0].limitations.join(" "), /checkpoint not reached/);
});

test("save-rate experiment requires Studio captures aligned to the checkpoint", () => {
  const base = {
    topic: "credit", duration_seconds: 10, hook_type: "question",
    published_at: "2026-08-15T00:00:00Z",
  };
  const context = {
    videos: [
      { id: "variant", experiment_id: "exp-save", ...base, hook_type: "conflict" },
      { id: "control", experiment_id: null, ...base },
    ],
    api_metric_snapshots: [
      { video_id: "variant", views: 1000, likes: 0, comments: 0, shares: 0,
        age_hours: 24, collected_at: "2026-08-16T00:00:00Z" },
      { video_id: "control", views: 1000, likes: 0, comments: 0, shares: 0,
        age_hours: 24, collected_at: "2026-08-16T00:00:00Z" },
    ],
    studio_metrics: [
      { video_id: "variant", saves: 80, captured_at: "2026-08-16T00:10:00Z" },
      { video_id: "control", saves: 40, captured_at: "2026-08-16T00:00:00Z" },
    ],
    experiments: [{ id: "exp-save", control_video_id: "control",
      success_metrics: { primary_metric: "save_rate", direction: "increase", checkpoint: "24h", mde: 0.01 } }],
    prompt_records: [{ video_id: "variant", technical_valid: true }],
  };
  assert.equal(buildAccountAnalytics(context).experiment_evaluations[0].conclusion, "PASS");
  context.studio_metrics[0].captured_at = "2026-08-18T00:00:00Z";
  assert.equal(buildAccountAnalytics(context).experiment_evaluations[0].conclusion, "INCONCLUSIVE");
});

test("learning cycle persists an analysis and only a hypothesis-level lesson", async () => {
  const calls = [];
  const api = {
    recordAnalysis: async (row) => {
      calls.push(["analysis", row]);
      return { analysis_result: {
        conclusion: "PASS",
        sample_size: { audience_sample_size: 1000, control_sample_size: 1000 },
      } };
    },
    recordLesson: async (row) => calls.push(["lesson", row]),
  };
  const common = {
    topic: "credit", content_format: "sketch", duration_seconds: 10,
    character_id: "hero", visual_style_id: "street", pacing_profile: "fast",
    punch_type: "visual", loop_type: "loop", camera_profile: "locked",
    prompt_framework_version: "PF-v1",
  };
  const context = {
    videos: [
      { id: "00000000-0000-4000-8000-000000000001", experiment_id: "00000000-0000-4000-8000-000000000010",
        published_at: "2026-08-15T00:00:00Z", hook_type: "conflict", ...common },
      { id: "00000000-0000-4000-8000-000000000002", experiment_id: null,
        published_at: "2026-08-14T00:00:00Z", hook_type: "question", ...common },
    ],
    api_metric_snapshots: [
      { video_id: "00000000-0000-4000-8000-000000000001", views: 1000, likes: 10, comments: 1, shares: 80,
        age_hours: 24, collected_at: "2026-08-16T00:00:00Z" },
      { video_id: "00000000-0000-4000-8000-000000000002", views: 1000, likes: 10, comments: 1, shares: 40,
        age_hours: 24, collected_at: "2026-08-15T00:00:00Z" },
    ],
    experiments: [{ id: "00000000-0000-4000-8000-000000000010", hypothesis: "hook helps",
      control_video_id: "00000000-0000-4000-8000-000000000002",
      success_metrics: { primary_metric: "share_rate", direction: "increase", checkpoint: "24h", mde: 0.01 } }],
    prompt_records: [{ video_id: "00000000-0000-4000-8000-000000000001", technical_valid: true }],
  };
  const result = await runLearningCycle(api, context);
  assert.deepEqual(calls.map(([kind]) => kind), ["analysis", "lesson"]);
  assert.equal(calls[1][1].status, "HYPOTHESIS");
  assert.equal(calls[1][1].confidence, "LOW");
  assert.equal(result.persisted.analyses, 1);
});
