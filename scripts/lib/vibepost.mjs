/**
 * Optional VibePost delivery: push a finished video into the user's VibePost
 * (scheduled Telegram posting) app so it lands in her «Входящие» — she reviews
 * it there, picks a caption in the bot and schedules it herself. Nothing is
 * ever published straight to a channel from here.
 *
 * The video is POSTed (multipart) to the `ingest-video` Edge Function, which
 * owns the storage upload and the `incoming_videos` row. This script only
 * needs the function URL and the ingest secret.
 *
 * Configure via .env:
 *   VIBEPOST_INGEST_URL=https://<project>.supabase.co/functions/v1/ingest-video
 *   VIBEPOST_INGEST_SECRET=<секрет из Vault: vibepost_ingest_secret>
 *
 * The secret is NOT the Supabase service_role key: this endpoint runs with
 * verify_jwt=false and does its own check on the X-Ingest-Secret header. A
 * leaked ingest secret only lets someone drop a draft into «Входящие»; a
 * leaked service_role key would hand over the whole database.
 *
 * Edge Function contract (multipart/form-data) — see the function's README:
 *   file    — the mp4 (the field is `file`, not `video`)
 *   name    — short slug, e.g. "01-raccoon-inflation"
 *   caption — post caption text (optional)
 *   source  — where the reel came from (optional)
 */
import fs from "node:fs";
import path from "node:path";
import { redact } from "./secret.mjs";

/**
 * @param {{ingestUrl: string, secret: string, filePath: string, name: string,
 *          caption?: string, source?: string}} opts
 */
export async function sendToVibePost({ ingestUrl, secret, filePath, name, caption, source }) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "video/mp4" }), path.basename(filePath));
  form.append("name", name);
  if (caption) form.append("caption", caption);
  form.append("source", source || "vibepost-video");

  const res = await fetch(ingestUrl, {
    method: "POST",
    headers: { "X-Ingest-Secret": secret },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 403 here almost always means the secret is wrong or missing, not that
    // the reel is bad — say so, otherwise the log reads like a mystery.
    const hint = res.status === 403
      ? " — приёмник не принял секрет: проверь VIBEPOST_INGEST_SECRET"
      : "";
    throw new Error(
      redact(`VibePost ingest не прошёл (${res.status}): ${JSON.stringify(data)}${hint}`, [secret]),
    );
  }
  return data;
}
