/**
 * Optional VibePost delivery: push a finished video into the user's VibePost
 * (scheduled Telegram posting) app so it lands there as a draft she can review
 * and schedule — she always previews before anything goes live.
 *
 * The video is POSTed (multipart) to a VibePost Edge Function that owns the
 * storage upload + `posts` row creation (format='video'). This keeps the
 * VibePost schema on the backend side; the script only needs the function URL
 * and the key. Both are secrets and are redacted from errors.
 *
 * Configure via .env:
 *   VIBEPOST_INGEST_URL=https://<project>.supabase.co/functions/v1/ingest-video
 *   VIBEPOST_KEY=<supabase service_role key — server-to-server, keep secret>
 *
 * Expected Edge Function contract (multipart/form-data):
 *   video        — the mp4 file
 *   name         — short slug, e.g. "01-raccoon-inflation"
 *   caption      — post caption text (optional)
 *   scheduled_at — ISO time to schedule (optional; omitted => draft for review)
 */
import fs from "node:fs";
import path from "node:path";
import { redact } from "./secret.mjs";

/**
 * @param {{ingestUrl: string, key: string, filePath: string, name: string,
 *          caption?: string, scheduledAt?: string}} opts
 */
export async function sendToVibePost({ ingestUrl, key, filePath, name, caption, scheduledAt }) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("video", new Blob([buf], { type: "video/mp4" }), path.basename(filePath));
  form.append("name", name);
  if (caption) form.append("caption", caption);
  if (scheduledAt) form.append("scheduled_at", scheduledAt);

  const res = await fetch(ingestUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      redact(`VibePost ingest не прошёл (${res.status}): ${JSON.stringify(data)}`, [key]),
    );
  }
  return data;
}
