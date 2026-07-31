/**
 * The Veo call itself: submit a prompt, wait for the long-running operation,
 * download the resulting mp4.
 *
 * Shared by `npm run video` (one-off prompt) and `npm run reels` (approved
 * ideas) so the two can never drift apart on timeouts, polling or error
 * handling. THIS IS THE BILLED STEP — callers are responsible for making sure
 * the text was approved first.
 */
import fs from "node:fs";

import { POLL_INTERVAL_MS, DEFAULT_TIMEOUT_MS, DEFAULT_RESOLUTION, DEFAULT_ASPECT } from "./veo.mjs";
import { redact } from "./secret.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} o
 * @param {string} o.apiKey
 * @param {string} o.model
 * @param {string} o.prompt
 * @param {string} o.downloadPath              Where to write the mp4.
 * @param {string} [o.resolution]
 * @param {string} [o.aspectRatio]
 * @param {number} [o.timeoutMs]
 * @param {(line: string) => void} [o.onProgress]
 * @returns {Promise<{operation: string|null, path: string}>}
 */
export async function generateClip({
  apiKey,
  model,
  prompt,
  downloadPath,
  resolution = DEFAULT_RESOLUTION,
  aspectRatio = DEFAULT_ASPECT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onProgress = () => {},
}) {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  let operation = await ai.models.generateVideos({
    model,
    prompt,
    config: { numberOfVideos: 1, resolution, aspectRatio },
  });
  onProgress("Запрос принят, идёт генерация...");

  const deadline = Date.now() + timeoutMs;
  while (!operation.done) {
    if (Date.now() > deadline) {
      throw new Error(`Таймаут: генерация не завершилась за ${Math.round(timeoutMs / 1000)} с.`);
    }
    await sleep(POLL_INTERVAL_MS);
    const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    onProgress(`  ...генерация продолжается (осталось до таймаута ~${left} с)`);
    operation = await ai.operations.getVideosOperation({ operation });
  }

  if (operation.error) {
    throw new Error(redact(JSON.stringify(operation.error), [apiKey]));
  }

  const video = operation.response?.generatedVideos?.[0]?.video;
  if (!video) throw new Error("Veo не вернул видео (пустой результат).");

  onProgress("Генерация завершена, скачиваю MP4...");
  await ai.files.download({ file: video, downloadPath });

  if (!fs.existsSync(downloadPath) || fs.statSync(downloadPath).size === 0) {
    throw new Error("Файл видео не был сохранён корректно.");
  }
  return { operation: operation.name ?? null, path: downloadPath };
}
