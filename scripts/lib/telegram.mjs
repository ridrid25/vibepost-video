/**
 * Optional Telegram delivery: send finished videos straight to a chat so the
 * user receives them on their phone without touching the server.
 *
 * Uses the Bot API over plain HTTPS (works through the same proxy the rest of
 * the pipeline uses). The bot token is a secret and is always redacted from
 * any error output.
 */
import fs from "node:fs";
import path from "node:path";
import { redact } from "./secret.mjs";

const API = "https://api.telegram.org";

/**
 * Send a video file to a chat.
 * @param {{token: string, chatId: string|number, filePath: string, caption?: string}} opts
 */
export async function sendVideo({ token, chatId, filePath, caption }) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  form.append("video", new Blob([buf], { type: "video/mp4" }), path.basename(filePath));

  const res = await fetch(`${API}/bot${token}/sendVideo`, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(redact(`Telegram sendVideo не прошёл: ${JSON.stringify(data)}`, [token]));
  }
  return data.result;
}

/**
 * Find the chat id of the most recent user who messaged the bot. Used once,
 * during linking, so the user never has to look up their numeric id by hand.
 * @param {string} token
 * @returns {Promise<{id: number, name: string} | null>}
 */
export async function detectChatId(token) {
  const res = await fetch(`${API}/bot${token}/getUpdates`);
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    throw new Error(redact(`Telegram getUpdates не прошёл: ${JSON.stringify(data)}`, [token]));
  }
  const updates = data.result || [];
  for (let i = updates.length - 1; i >= 0; i--) {
    const chat = (updates[i].message || updates[i].channel_post || {}).chat;
    if (chat?.id) return { id: chat.id, name: chat.first_name || chat.title || "" };
  }
  return null;
}
