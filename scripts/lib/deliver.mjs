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
 * @param {string} [o.prompt]        Exact production prompt used for the render.
 * @param {(line: string) => void} [o.log]
 * @returns {Promise<{telegram: boolean, vibepost: boolean}>} what actually went out
 */
export async function deliverReel({ filePath, name, caption, prompt, log = () => {} }) {
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
  const ingestSecret = process.env.VIBEPOST_INGEST_SECRET;
  const legacyKey = process.env.VIBEPOST_KEY;
  if (ingestUrl && ingestSecret) {
    try {
      const { sendToVibePost } = await import("./vibepost.mjs");
      await sendToVibePost({
        ingestUrl,
        secret: ingestSecret,
        filePath,
        name,
        caption,
        prompt,
        source: "content-brigade-v2",
      });
      result.vibepost = true;
      log("отправлено в VibePost (черновик) ✓");
    } catch (error) {
      log(`VibePost не отправлен: ${redact(error?.message ?? String(error), [ingestSecret])}`);
    }
  } else if (ingestUrl && legacyKey) {
    log(
      "VibePost не отправлен: VIBEPOST_KEY устарел. " +
        "Задайте отдельный VIBEPOST_INGEST_SECRET; service_role больше не используется.",
    );
  } else if (ingestUrl) {
    log("VibePost не отправлен: задайте VIBEPOST_INGEST_SECRET в .env");
  }

  if (!tgToken && !ingestUrl) log("доставка не настроена — ролик только на диске");
  return result;
}
