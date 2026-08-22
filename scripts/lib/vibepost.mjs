/**
 * Optional VibePost delivery: push a finished video into the user's VibePost
 * (scheduled Telegram posting) app so it lands there as a draft she can review
 * and schedule — she always previews before anything goes live.
 *
 * The video is POSTed (multipart) to a VibePost Edge Function that owns the
 * storage upload + `incoming_videos` row creation. This keeps the VibePost
 * schema on the backend side; the script only needs the function URL and the
 * narrow ingest secret. Both are redacted from errors.
 *
 * Configure via .env:
 *   VIBEPOST_INGEST_URL=https://<project>.supabase.co/functions/v1/ingest-video
 *   VIBEPOST_INGEST_SECRET=<dedicated ingest secret, keep secret>
 *
 * Expected Edge Function contract (multipart/form-data):
 *   file         — the mp4 file
 *   name         — short slug, e.g. "01-raccoon-inflation"
 *   prompt       — production prompt (optional)
 *   source       — source label (optional)
 *   caption      — post caption text (optional)
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { redact } from "./secret.mjs";

const VIBEPOST_INGEST_HOST = "rjtyjybwygfkdekdzqbm.supabase.co";

function validateIngestUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== VIBEPOST_INGEST_HOST ||
    url.pathname !== "/functions/v1/ingest-video" ||
    url.username ||
    url.password
  ) {
    throw new Error("VIBEPOST_INGEST_URL must target the configured VibePost HTTPS ingest endpoint");
  }
  return url.toString();
}

/**
 * @param {{ingestUrl: string, secret: string, filePath: string, name: string,
 *          caption?: string, prompt?: string, source?: string}} opts
 */
export async function sendToVibePost({
  ingestUrl,
  secret,
  filePath,
  name,
  caption,
  prompt,
  source = "content-brigade-v2",
}) {
  const verifiedIngestUrl = validateIngestUrl(ingestUrl);
  const buf = fs.readFileSync(filePath);
  const deliveryId = createHash("sha256").update(name).update("\0").update(buf).digest("hex");
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "video/mp4" }), path.basename(filePath));
  form.append("name", name);
  form.append("delivery_id", deliveryId);
  if (caption) form.append("caption", caption);
  if (prompt) form.append("prompt", prompt);
  if (source) form.append("source", source);

  const res = await fetch(verifiedIngestUrl, {
    method: "POST",
    headers: { "X-Ingest-Secret": secret },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      redact(`VibePost ingest не прошёл (${res.status}): ${JSON.stringify(data)}`, [secret]),
    );
  }
  return data;
}
