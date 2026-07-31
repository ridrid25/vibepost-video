#!/usr/bin/env node
/**
 * One-time Telegram linker.
 *
 *   npm run telegram:link
 *
 * Reads TELEGRAM_BOT_TOKEN from .env, finds the chat of whoever last messaged
 * the bot, and saves TELEGRAM_CHAT_ID back to .env. After this, every generated
 * video is delivered to that chat automatically. The token is never printed.
 */
import { loadEnv, upsertEnv } from "./lib/env.mjs";
import { detectChatId } from "./lib/telegram.mjs";
import { logSafeError } from "./lib/secret.mjs";

async function main() {
  loadEnv();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN не задан в .env. Добавьте строку TELEGRAM_BOT_TOKEN=... и повторите.",
    );
  }

  const found = await detectChatId(token);
  if (!found) {
    process.stdout.write(
      "Не вижу ни одного сообщения боту. Откройте своего бота в Telegram, " +
        "напишите ему любое сообщение (например «привет») и запустите команду снова.\n",
    );
    process.exitCode = 1;
  }

  upsertEnv({ TELEGRAM_CHAT_ID: String(found.id) });
  process.stdout.write(
    `Готово! Telegram подключён${found.name ? ` (${found.name})` : ""}. ` +
      "Теперь готовые видео будут приходить тебе в чат автоматически.\n",
  );
}

main().catch((error) => {
  logSafeError(error?.message ?? error, [process.env.TELEGRAM_BOT_TOKEN]);
  process.exitCode = 1;
});
