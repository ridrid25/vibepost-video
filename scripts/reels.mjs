#!/usr/bin/env node
/**
 * Build reels from APPROVED ideas only.
 *
 *   npm run reels                       # сгенерировать всё утверждённое через Veo (платно)
 *   npm run reels -- --dry-run          # показать план и смету, ничего не тратить
 *   npm run reels -- --only pigeon-mortgage
 *   npm run reels -- --source ./gemini  # бесплатный путь: взять готовые ролики с диска
 *   npm run reels -- --yes              # не переспрашивать про оплату
 *
 * Два пути к исходному ролику:
 *   • Veo API — автоматически, но платно (free tier видео не генерирует);
 *   • --source — ролик, сделанный руками в приложении Gemini: бесплатно.
 *     Папка: ищется файл с именем слага. Файл: годится, когда идея одна.
 *
 * Дальше одинаково: чистый русский голос (бесплатно), музыка, хук, субтитры,
 * отправка в Telegram и черновиком в VibePost.
 *
 * Идея без `"approved": true` не берётся никогда — см. CLAUDE.md.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { loadEnv } from "./lib/env.mjs";
import { ask } from "./lib/prompt.mjs";
import { approvedPending, updateIdea, describe } from "./lib/ideas.mjs";
import { dubVideo } from "./lib/dub.mjs";
import { deliverReel } from "./lib/deliver.mjs";
import { generateClip } from "./lib/generate.mjs";
import { DEFAULT_RESOLUTION, DEFAULT_ASPECT, estimateCost, ASSUMED_CLIP_SECONDS } from "./lib/veo.mjs";
import { logSafeError } from "./lib/secret.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT_DIR = path.join(ROOT, "series-output");
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".m4v"];

function parseArgs(argv) {
  const args = { only: undefined, source: undefined, dryRun: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--only") args.only = argv[++i];
    else if (token === "--source") args.source = argv[++i];
    else if (token === "--dry-run") args.dryRun = true;
    else if (token === "--yes" || token === "-y") args.yes = true;
    else if (token.startsWith("--only=")) args.only = token.slice(7);
    else if (token.startsWith("--source=")) args.source = token.slice(9);
  }
  return args;
}

/**
 * Find the local clip for an idea: a directory is searched for `<slug>.<ext>`,
 * a plain file is used as-is. Returns null when there is nothing to use.
 */
function localSource(sourceArg, idea, targetCount) {
  if (!sourceArg) return null;
  const source = path.isAbsolute(sourceArg) ? sourceArg : path.join(ROOT, sourceArg);
  if (!fs.existsSync(source)) throw new Error(`Путь не найден: ${sourceArg}`);

  if (fs.statSync(source).isDirectory()) {
    for (const ext of VIDEO_EXTENSIONS) {
      const candidate = path.join(source, `${idea.slug}${ext}`);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  if (targetCount > 1) {
    throw new Error(
      "--source указывает на один файл, а идей несколько. Добавьте --only <slug> " +
        "или укажите папку с файлами по именам слагов.",
    );
  }
  return source;
}

async function confirmSpend(count, model, resolution) {
  const perClip = estimateCost(model, resolution);
  const total = perClip === null ? null : perClip * count;
  process.stdout.write(`\nМодель: ${model}, ${resolution}\n`);
  if (total === null) {
    process.stdout.write(
      `Цена для этой модели неизвестна — сверьтесь с ai.google.dev/gemini-api/docs/pricing\n`,
    );
  } else {
    process.stdout.write(
      `Смета: ${count} × ~${ASSUMED_CLIP_SECONDS} с ≈ $${total.toFixed(2)} ` +
        `(примерно $${perClip.toFixed(2)} за ролик).\n`,
    );
  }
  process.stdout.write("Veo тарифицируется по факту успешной генерации.\n");
  const answer = await ask("Продолжить? [да/нет]: ");
  return /^(да|д|yes|y)$/i.test(answer.trim());
}

async function buildOne(idea, source, config) {
  const log = (line) => process.stdout.write(`[${idea.slug}] ${line}\n`);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "reels-"));
  try {
    let rawClip = source;
    if (!rawClip) {
      log("генерирую видео через Veo…");
      rawClip = path.join(scratch, `${idea.slug}.raw.mp4`);
      await generateClip({
        apiKey: config.apiKey,
        model: config.model,
        prompt: idea.prompt,
        downloadPath: rawClip,
        resolution: config.resolution,
        aspectRatio: config.aspect,
        timeoutMs: config.timeoutMs,
        onProgress: log,
      });
    } else {
      log(`беру готовый ролик: ${path.basename(rawClip)}`);
    }

    log("синтезирую голос и собираю…");
    const output = path.join(OUT_DIR, `${idea.slug}.mp4`);
    const { voiceStart, music } = await dubVideo({
      input: rawClip,
      output,
      text: idea.text,
      hook: idea.hook,
    });
    log(`готово (голос с ${voiceStart.toFixed(1)}с, музыка ${music ? "вкл" : "выкл"}) → ${output}`);

    updateIdea(idea.slug, { video: path.relative(ROOT, output), builtAt: new Date().toISOString() });

    await deliverReel({
      filePath: output,
      name: idea.slug,
      caption: `${idea.hook}\n\n${idea.text}`,
      prompt: idea.prompt,
      log,
    });
    return output;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));

  let targets = approvedPending();
  if (args.only) targets = targets.filter((idea) => idea.slug === args.only);

  if (targets.length === 0) {
    process.stdout.write(
      args.only
        ? `Утверждённая идея «${args.only}» не найдена (или ролик уже собран).\n`
        : "Нет утверждённых идей, ждущих генерации. Запустите: npm run ideas\n",
    );
    return;
  }

  // Decide, per idea, whether we have a local clip or need a paid Veo call.
  const plan = targets.map((idea) => ({
    idea,
    source: localSource(args.source, idea, targets.length),
  }));
  const needVeo = plan.filter((entry) => !entry.source);

  const config = {
    apiKey: process.env.GOOGLE_API_KEY,
    model: process.env.VEO_MODEL,
    resolution: process.env.VEO_RESOLUTION || DEFAULT_RESOLUTION,
    aspect: process.env.VEO_ASPECT || DEFAULT_ASPECT,
    timeoutMs: Number.parseInt(process.env.VIDEO_TIMEOUT_MS ?? "", 10) || undefined,
  };

  process.stdout.write(`К сборке: ${plan.length}\n`);
  for (const { idea, source } of plan) {
    process.stdout.write(`  • ${describe(idea)} — ${source ? "готовый файл" : "Veo (платно)"}\n`);
  }

  if (needVeo.length > 0) {
    if (!config.apiKey || !config.model) {
      throw new Error(
        "Для генерации через Veo нужны GOOGLE_API_KEY и VEO_MODEL. Выполните `npm run setup` " +
          "или укажите готовые ролики через --source.",
      );
    }
    if (args.dryRun) {
      await confirmSpendPreview(needVeo.length, config);
      return;
    }
    if (!args.yes && !(await confirmSpend(needVeo.length, config.model, config.resolution))) {
      process.stdout.write("Отменено, ничего не потрачено.\n");
      return;
    }
  } else if (args.dryRun) {
    process.stdout.write("\nПлатных вызовов не потребуется — все ролики берутся с диска.\n");
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const done = [];
  for (const { idea, source } of plan) {
    try {
      done.push(await buildOne(idea, source, config));
    } catch (error) {
      process.stdout.write(`[${idea.slug}] ОШИБКА: ${error?.message ?? error}\n`);
    }
  }

  process.stdout.write(`\nГотово: ${done.length} из ${plan.length}. Папка: ${OUT_DIR}\n`);
  for (const file of done) process.stdout.write(`  • ${path.basename(file)}\n`);
  if (done.length < plan.length) process.exitCode = 1;
}

/** Dry-run variant of the estimate: prints the bill, asks nothing. */
async function confirmSpendPreview(count, config) {
  const perClip = estimateCost(config.model, config.resolution);
  process.stdout.write(`\nМодель: ${config.model}, ${config.resolution}\n`);
  process.stdout.write(
    perClip === null
      ? "Цена для этой модели неизвестна — сверьтесь с документацией Gemini API.\n"
      : `Смета: ${count} × ~${ASSUMED_CLIP_SECONDS} с ≈ $${(perClip * count).toFixed(2)}.\n`,
  );
  process.stdout.write("Это сухой прогон — ничего не сгенерировано.\n");
}

main().catch((error) => {
  logSafeError(error?.message ?? error, [
    process.env.GOOGLE_API_KEY,
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.VIBEPOST_INGEST_SECRET,
  ]);
  process.exitCode = 1;
});
