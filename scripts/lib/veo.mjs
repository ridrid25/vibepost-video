/**
 * Shared Veo configuration: the environment variable names this tool manages
 * and the list of selectable Veo models.
 *
 * Model IDs verified against the official Gemini API documentation
 * (ai.google.dev/gemini-api/docs/video). Veo 2.0 is deprecated and scheduled
 * for shutdown on 2026-06-30, so the stable Veo 3.1 model is the default.
 */

/**
 * Layout of the generated .env.example: ordered sections with their comments.
 *
 * `npm run setup` REGENERATES .env.example from this list, so every variable
 * the scripts read has to be here — anything missing is silently dropped from
 * the committed file on the next setup run.
 */
export const ENV_EXAMPLE_SECTIONS = [
  {
    keys: [
      "GOOGLE_API_KEY",
      "VIDEO_OUTPUT_DIR",
      "VEO_MODEL",
      "VEO_RESOLUTION",
      "VEO_ASPECT",
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_CHAT_ID",
    ],
  },
  {
    comment: [
      "Автоотправка готовых роликов из `npm run voiceover` (по желанию).",
      "VibePost: URL Edge Function ingest-video и service_role-ключ Supabase.",
      "ВНИМАНИЕ: service_role-ключ мощный — держи .env в секрете (он в .gitignore).",
    ],
    keys: ["VIBEPOST_INGEST_URL", "VIBEPOST_KEY"],
  },
  {
    comment: ["Optional polish knobs (safe defaults if left empty)"],
    keys: ["VEO_SPEED", "VEO_MUSIC_VOLUME", "VEO_MUSIC"],
  },
];

/** Flat list of every variable this tool reads from / writes to .env. */
export const ENV_KEYS = ENV_EXAMPLE_SECTIONS.flatMap((section) => section.keys);

/** Selectable Veo models offered by `npm run setup`. */
export const VEO_MODELS = [
  {
    value: "veo-3.1-lite-generate-preview",
    label: "veo-3.1-lite-generate-preview — Veo 3.1 Lite (самая дешёвая, 9:16, со звуком)",
  },
  {
    value: "veo-3.1-fast-generate-001",
    label: "veo-3.1-fast-generate-001 — Veo 3.1 Fast (быстрее и дешевле стандартной)",
  },
  {
    value: "veo-3.1-generate-001",
    label: "veo-3.1-generate-001 — Veo 3.1 (стабильная, максимальное качество)",
  },
];

export const DEFAULT_MODEL = "veo-3.1-lite-generate-preview";
export const DEFAULT_OUTPUT_DIR = "videos";
export const DEFAULT_RESOLUTION = "720p";
export const DEFAULT_ASPECT = "9:16";

/** Poll interval and overall timeout for a generation job. */
export const POLL_INTERVAL_MS = 10_000;
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Price in USD per second of generated video, from the Gemini API pricing page.
 * Veo is PAID TIER ONLY — the free tier does not generate video at all.
 * Used to show the owner the bill before anything is charged.
 */
export const PRICE_PER_SECOND = {
  "veo-3.1-lite-generate-preview": { "720p": 0.05, "1080p": 0.08 },
  "veo-3.1-fast-generate-001": { "720p": 0.1, "1080p": 0.12 },
  "veo-3.1-generate-001": { "720p": 0.4, "1080p": 0.6 },
};

/** Veo clips in this series run about 8 seconds; used only for the estimate. */
export const ASSUMED_CLIP_SECONDS = 8;

/** Rough cost of one clip, or null when the model/resolution is unknown. */
export function estimateCost(model, resolution, seconds = ASSUMED_CLIP_SECONDS) {
  const perSecond = PRICE_PER_SECOND[model]?.[resolution];
  return perSecond === undefined ? null : perSecond * seconds;
}
