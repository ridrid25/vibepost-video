#!/usr/bin/env node
/**
 * Interactive setup for the Google Veo automation.
 *
 *   npm run setup
 *
 * Walks through the required secrets/settings, writes .env (without deleting
 * existing values), keeps .env out of git, creates a secret-free .env.example
 * and finishes with a safe verification test. The API key is never echoed to
 * the screen and never printed anywhere.
 */
import fs from "node:fs";
import path from "node:path";

import { ask, askHidden, askChoice } from "./lib/prompt.mjs";
import { readEnv, upsertEnv, writeEnvExample, ensureGitignore, ROOT } from "./lib/env.mjs";
import {
  ENV_EXAMPLE_SECTIONS,
  VEO_MODELS,
  DEFAULT_MODEL,
  DEFAULT_OUTPUT_DIR,
  DEFAULT_RESOLUTION,
  DEFAULT_ASPECT,
} from "./lib/veo.mjs";
import { redact, logSafeError } from "./lib/secret.mjs";

async function main() {
  const existing = readEnv();

  process.stdout.write("\n=== Настройка генерации видео через Google Veo ===\n\n");

  // 1. API key (hidden). Keep existing value if the user just presses Enter.
  const hasKey = Boolean(existing.GOOGLE_API_KEY);
  const keyPrompt = hasKey
    ? "GOOGLE_API_KEY (Enter — оставить текущий): "
    : "GOOGLE_API_KEY (ввод скрыт): ";
  const apiKey = await askHidden(keyPrompt, {
    fallback: existing.GOOGLE_API_KEY ?? "",
  });
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY обязателен. Настройка прервана.");
  }

  // 2. Output folder for finished videos.
  const outputDir = await ask(
    `Папка для готовых видео [${existing.VIDEO_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR}]: `,
    { fallback: existing.VIDEO_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR },
  );

  // 3. Veo model selection.
  const model = await askChoice("\nМодель Veo:", VEO_MODELS, existing.VEO_MODEL ?? DEFAULT_MODEL);

  // 4. Verify BEFORE writing anything. A key Google rejects must not end up in
  // .env — otherwise every later command fails with a confusing 401 and the
  // bad value sits there looking configured.
  await verify({ apiKey, outputDir, model });

  // 5. Persist. upsertEnv keeps every other existing value intact.
  upsertEnv({
    GOOGLE_API_KEY: apiKey,
    VIDEO_OUTPUT_DIR: outputDir,
    VEO_MODEL: model,
    VEO_RESOLUTION: existing.VEO_RESOLUTION ?? DEFAULT_RESOLUTION,
    VEO_ASPECT: existing.VEO_ASPECT ?? DEFAULT_ASPECT,
  });
  ensureGitignore();
  writeEnvExample(ENV_EXAMPLE_SECTIONS);

  process.stdout.write("\n.env обновлён, .env.example создан, .env добавлен в .gitignore.\n");
  process.stdout.write(`Выбранная модель: ${model}\n`);

  process.stdout.write("\nНастройка завершена\n");
}

/**
 * Confirm the settings actually work without leaking the key:
 *  - the output folder exists / can be created and is writable;
 *  - the API key is accepted by Google (a cheap models.list call).
 */
async function verify({ apiKey, outputDir }) {
  process.stdout.write("Проверка настроек...\n");

  // Output folder must be creatable and writable.
  const absOut = path.isAbsolute(outputDir) ? outputDir : path.join(ROOT, outputDir);
  fs.mkdirSync(absOut, { recursive: true });
  const probe = path.join(absOut, ".veo-write-test");
  fs.writeFileSync(probe, "ok");
  fs.rmSync(probe);

  // Validate the API key with a lightweight request. AbortController keeps the
  // check from hanging if the network is unavailable.
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    // list() performs the first HTTP request as it resolves, so awaiting it is
    // enough to confirm the key is accepted. Touch the page to be explicit.
    const pager = await ai.models.list({ config: { abortSignal: controller.signal } });
    void pager.page;
  } catch (error) {
    // Redact before rethrowing so the key can never surface in the message.
    throw new Error(sanitizeVerifyError(error, apiKey));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Describe what was pasted WITHOUT revealing it, so a wrong paste is obvious.
 * Copying the wrong string off the AI Studio page is the common failure, and a
 * bare 401 gives the user nothing to act on.
 */
function describeKeyShape(apiKey) {
  const key = String(apiKey ?? "");
  const facts = [`Вставлено символов: ${key.length}.`];
  if (key.startsWith("AQ.")) {
    facts.push("Начинается на «AQ.» — это токен сессии Google, а не API-ключ.");
  } else if (key.length < 20) {
    facts.push("Слишком коротко для ключа — похоже на обрезанный текст из таблицы.");
  }
  if (/\s/.test(key)) facts.push("Внутри есть пробел или перенос строки — скопировалось лишнее.");
  return facts.join("\n") + "\n";
}

function sanitizeVerifyError(error, apiKey) {
  const message = redact(error?.message ?? String(error), [apiKey]);
  if (/401|403|API key|permission|unauthenticated|invalid/i.test(message)) {
    return (
      "API-ключ отклонён Google — в .env ничего не записано.\n" +
      describeKeyShape(apiKey) +
      "Ключ берётся так: https://aistudio.google.com/apikey → щёлкнуть по строке\n" +
      "ключа в колонке Key → скопировать значение целиком из открывшегося окна.\n" +
      "Обрезанный текст вида «...bJpg» из таблицы не подходит — это не сам ключ."
    );
  }
  if (/abort|timeout|ENOTFOUND|ECONNREFUSED|network|fetch failed/i.test(message)) {
    return "Не удалось связаться с Google API (сеть/таймаут). Проверьте подключение и повторите настройку.";
  }
  return `Проверка не пройдена: ${message}`;
}

main().catch((error) => {
  // Final safety net: strip the key from anything on the way out.
  logSafeError(error?.message ?? error, [readEnv().GOOGLE_API_KEY]);
  process.exitCode = 1;
});
