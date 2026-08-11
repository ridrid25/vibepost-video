/**
 * Delivery of a finished reel to wherever the owner wants it.
 *
 *  - Telegram — lands on her phone straight away, for a quick look.
 *  - VibePost — arrives as a DRAFT. The scheduler never posts it until she
 *    picks the channel and the time herself. This is the publishing route for
 *    the series, so it is a first-class part of the pipeline, not an extra.
 *
 * Both are optional and enabled purely by the presence of their keys in .env.
 * Delivery is best-effort by design: a network failure must never destroy a
 * reel that was expensive to generate — the file is already on disk either way.
 */
import { redact } from "./secret.mjs";

/**
 * @param {object} o
 * @param {string} o.filePath        Finished mp4.
 * @param {string} o.name            Short slug, used as the VibePost name.
 * @param {string} [o.caption]       Post caption.
 * @param {(line: string) => void} [o.log]
 * @returns {Promise<{telegram: boolean, vibepost: boolean}>} what actually went out
 */
export async function deliverReel({ filePath, name, caption, log = () => {} }) {
  const result = { telegram: false, vibepost: false };

  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.TELEGRAM_CHAT_ID;
  if (tgToken && tgChat) {
    try {
      const { sendVideo } = await import("./telegram.mjs");
      await sendVideo({ token: tgToken, chatId: tgChat, filePath, caption });
      result.telegram = true;
      log("отправлено в Telegram ✓");
    } catch (error) {
      log(`Telegram не отправлен: ${redact(error?.message ?? String(error), [tgToken])}`);
    }
  }

  const ingestUrl = process.env.VIBEPOST_INGEST_URL;
  const vpSecret = process.env.VIBEPOST_INGEST_SECRET;
  // VIBEPOST_KEY held the service_role key back when ingest-video authorised by
  // JWT. It now checks its own X-Ingest-Secret header, so the old variable no
  // longer works — and silently doing nothing is exactly how this stayed broken
  // unnoticed. Say it out loud instead.
  if (ingestUrl && !vpSecret && process.env.VIBEPOST_KEY) {
    log(
      "VibePost не отправлен: в .env остался VIBEPOST_KEY, а нужен " +
        "VIBEPOST_INGEST_SECRET (это другое значение — секрет приёмника, не service_role-ключ)",
    );
  }
  if (ingestUrl && vpSecret) {
    try {
      const { sendToVibePost } = await import("./vibepost.mjs");
      // The reel lands in «Входящие» as status='new': she previews it, picks a
      // caption in the bot and schedules it herself. Nothing auto-publishes.
      await sendToVibePost({ ingestUrl, secret: vpSecret, filePath, name, caption });
      result.vibepost = true;
      log("отправлено в VibePost (Входящие) ✓");
    } catch (error) {
      log(`VibePost не отправлен: ${redact(error?.message ?? String(error), [vpSecret])}`);
    }
  }

  if (!tgToken && !ingestUrl) log("доставка не настроена — ролик только на диске");
  return result;
}
