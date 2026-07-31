#!/usr/bin/env node
/**
 * Generate a video with Google Veo and save it as MP4.
 *
 *   npm run video -- --prompt "текст промпта" --name "scene-03"
 *   npm run video:file -- prompts/scene-03.txt
 *
 * Uses the official @google/genai SDK:
 *   ai.models.generateVideos()  -> long-running operation
 *   ai.operations.getVideosOperation()  -> poll until done
 *   ai.files.download()  -> save the MP4
 *
 * Behaviour:
 *  - waits for generation to finish, printing a clear status;
 *  - never overwrites an existing video (adds an incrementing suffix,
 *    falling back to a timestamp);
 *  - writes a sidecar JSON with prompt, model, start time and final status;
 *  - handles API errors and timeouts gracefully;
 *  - never prints the API key anywhere.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadEnv, ROOT } from "./lib/env.mjs";
import { DEFAULT_TIMEOUT_MS, DEFAULT_RESOLUTION, DEFAULT_ASPECT } from "./lib/veo.mjs";
import { generateClip } from "./lib/generate.mjs";
import { redact, logSafeError } from "./lib/secret.mjs";

/**
 * Parse CLI arguments. Supports `--prompt`, `--name`, `--file` and a bare
 * positional path (used by `npm run video:file -- prompts/scene-03.txt`).
 */
export function parseArgs(argv) {
  const args = {
    prompt: undefined,
    name: undefined,
    file: undefined,
    hook: undefined,
    subtitle: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--prompt") args.prompt = argv[++i];
    else if (token === "--name") args.name = argv[++i];
    else if (token === "--file") args.file = argv[++i];
    else if (token === "--hook") args.hook = argv[++i];
    else if (token === "--subtitle") args.subtitle = argv[++i];
    else if (token.startsWith("--prompt=")) args.prompt = token.slice(9);
    else if (token.startsWith("--name=")) args.name = token.slice(7);
    else if (token.startsWith("--file=")) args.file = token.slice(7);
    else if (token.startsWith("--hook=")) args.hook = token.slice(7);
    else if (token.startsWith("--subtitle=")) args.subtitle = token.slice(11);
    else if (!token.startsWith("-") && !args.file) args.file = token; // positional
  }
  return args;
}

/** Turn an arbitrary name into a safe, cross-platform file base name. */
export function sanitizeName(name) {
  const cleaned = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "video";
}

/**
 * Reserve a non-colliding output path ATOMICALLY.
 *
 * Rather than checking existence and then writing (a TOCTOU race where two
 * concurrent runs could pick the same name), we exclusively create an empty
 * placeholder file (`wx` flag fails if it already exists). The winning run owns
 * that name; the download later overwrites the placeholder. Tries `<base>.mp4`,
 * then `<base>-1.mp4`, ... then a timestamped name.
 */
export function resolveOutputPath(dir, base) {
  const tryReserve = (candidate) => {
    try {
      fs.closeSync(fs.openSync(candidate, "wx")); // exclusive create
      return true;
    } catch (err) {
      if (err.code === "EEXIST") return false;
      throw err;
    }
  };

  let candidate = path.join(dir, `${base}.mp4`);
  if (tryReserve(candidate)) return candidate;
  for (let i = 1; i < 1000; i++) {
    candidate = path.join(dir, `${base}-${i}.mp4`);
    if (tryReserve(candidate)) return candidate;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  candidate = path.join(dir, `${base}-${stamp}.mp4`);
  tryReserve(candidate);
  return candidate;
}

async function main() {
  loadEnv(); // populate process.env from .env (does not overwrite real env vars)
  const apiKey = process.env.GOOGLE_API_KEY;
  const model = process.env.VEO_MODEL;
  const outputDirRaw = process.env.VIDEO_OUTPUT_DIR;

  if (!apiKey || !model || !outputDirRaw) {
    throw new Error("Настройки не заданы. Сначала выполните: npm run setup");
  }

  const args = parseArgs(process.argv.slice(2));

  // Resolve the prompt (from --file / positional path, or --prompt).
  let prompt = args.prompt;
  let defaultName = args.name;
  if (args.file) {
    const filePath = path.isAbsolute(args.file) ? args.file : path.join(ROOT, args.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Файл с промптом не найден: ${args.file}`);
    }
    prompt = fs.readFileSync(filePath, "utf8").trim();
    if (!defaultName) defaultName = path.basename(filePath, path.extname(filePath));
  }
  if (!prompt) {
    throw new Error('Не задан промпт. Пример: npm run video -- --prompt "текст" --name "scene-03"');
  }

  const base = sanitizeName(defaultName ?? "video");
  const outputDir = path.isAbsolute(outputDirRaw) ? outputDirRaw : path.join(ROOT, outputDirRaw);
  fs.mkdirSync(outputDir, { recursive: true });

  const timeoutMs = Number.parseInt(process.env.VIDEO_TIMEOUT_MS ?? "", 10) || DEFAULT_TIMEOUT_MS;
  const startedAt = new Date().toISOString();

  process.stdout.write(`Модель: ${model}\n`);
  process.stdout.write(`Имя: ${base}\n`);
  process.stdout.write("Отправляю запрос в Veo...\n");

  let finalStatus = "unknown";
  let outputPath;
  try {
    // Reserve the name up front so the download has a stable destination; a
    // failed run's empty placeholder is cleaned up in the catch below.
    outputPath = resolveOutputPath(outputDir, base);
    const rawPath = outputPath.replace(/\.mp4$/, ".raw.mp4");
    const { operation } = await generateClip({
      apiKey,
      model,
      prompt,
      downloadPath: rawPath,
      resolution: process.env.VEO_RESOLUTION || DEFAULT_RESOLUTION,
      aspectRatio: process.env.VEO_ASPECT || DEFAULT_ASPECT,
      timeoutMs,
      onProgress: (line) => process.stdout.write(`${line}\n`),
    });

    // Polish: speed-up + hook + subtitles + quiet music bed. Best-effort — if
    // ffmpeg polishing fails, fall back to the raw clip so a video still ships.
    try {
      process.stdout.write("Полировка (скорость, хук, субтитры, музыка)...\n");
      const { polishVideo } = await import("./lib/polish.mjs");
      await polishVideo({
        input: rawPath,
        output: outputPath,
        speed: Number(process.env.VEO_SPEED) || 1.25,
        hook: args.hook,
        subtitle: args.subtitle,
        music: process.env.VEO_MUSIC === "off" ? null : undefined,
        musicVolume: Number(process.env.VEO_MUSIC_VOLUME) || 0.42,
      });
      fs.rmSync(rawPath, { force: true });
    } catch (polishError) {
      process.stdout.write(
        "Полировка не удалась, отправляю сырой ролик: " +
          redact(polishError?.message ?? String(polishError), [apiKey]) +
          "\n",
      );
      fs.renameSync(rawPath, outputPath);
    }

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      throw new Error("Файл видео не был сохранён корректно.");
    }

    finalStatus = "success";
    writeSidecar(outputPath, {
      status: finalStatus,
      prompt,
      hook: args.hook ?? null,
      subtitle: args.subtitle ?? null,
      model,
      name: base,
      startedAt,
      finishedAt: new Date().toISOString(),
      operation,
      video: path.basename(outputPath),
    });

    process.stdout.write(`\nГотово: ${outputPath}\n`);

    // Deliver to Telegram (preview on the phone) and VibePost (draft to
    // schedule). Best-effort — a delivery failure never fails the run.
    const { deliverReel } = await import("./lib/deliver.mjs");
    await deliverReel({
      filePath: outputPath,
      name: base,
      caption: args.hook ? `${args.hook}\n\n${args.subtitle ?? ""}`.trim() : `${base} · ${model}`,
      log: (line) => process.stdout.write(`${line}\n`),
    });
  } catch (error) {
    finalStatus = /Таймаут/.test(error?.message ?? "") ? "timeout" : "error";
    // If a name was reserved but the download never produced bytes, remove the
    // empty placeholder so failed runs don't litter zero-byte .mp4 files.
    if (outputPath && fs.existsSync(outputPath) && fs.statSync(outputPath).size === 0) {
      try {
        fs.rmSync(outputPath);
      } catch {
        /* best effort */
      }
    }
    // Record the failure next to where the video would have been. When we never
    // reached reservation, pick a free JSON name without creating an .mp4.
    const failBase = outputPath
      ? outputPath.replace(/\.mp4$/, "")
      : freeSidecarBase(outputDir, base);
    writeSidecar(failBase, {
      status: finalStatus,
      prompt,
      model,
      name: base,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: redact(error?.message ?? String(error), [apiKey]),
    });
    throw error;
  }
}

/** Find a free `<base>.json` path (no side effects) for failure sidecars. */
function freeSidecarBase(dir, base) {
  let candidate = path.join(dir, base);
  if (!fs.existsSync(`${candidate}.json`)) return candidate;
  for (let i = 1; i < 1000; i++) {
    candidate = path.join(dir, `${base}-${i}`);
    if (!fs.existsSync(`${candidate}.json`)) return candidate;
  }
  return path.join(dir, `${base}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
}

/** Write the sidecar JSON next to the video (never contains the API key). */
function writeSidecar(videoPathOrBase, data) {
  const jsonPath = videoPathOrBase.replace(/\.mp4$/, "") + ".json";
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + "\n");
}

// Run only when invoked directly (keeps helpers importable for tests).
// pathToFileURL handles Windows native paths (backslashes, drive letters);
// a plain `file://` + argv[1] concat would never match import.meta.url there.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    logSafeError(error?.message ?? error, [
      process.env.GOOGLE_API_KEY,
      process.env.TELEGRAM_BOT_TOKEN,
    ]);
    process.exitCode = 1;
  });
}
