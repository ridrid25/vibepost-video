#!/usr/bin/env node
/**
 * "Уличная экономика" — бесплатная озвучка первых трёх роликов серии.
 *
 * Исторический скрипт: три ролика уже сгенерированы и лежат по ссылкам, здесь
 * они скачиваются и озвучиваются. Для новых роликов используйте связку
 * `npm run ideas` → `npm run reels` — там тексты сначала согласуются.
 *
 * Голос — БЕСПЛАТНО (Edge TTS), без кредитов и без лимитов.
 *
 * Запуск:
 *   npm run voiceover
 *
 * Требуется:
 *   - Node 18+ (глобальный fetch);
 *   - ffmpeg и ffprobe в PATH (https://ffmpeg.org/download.html);
 *   - интернет (скачивает ролики + синтезирует голос через Edge TTS);
 *   - `npm install` (ставит зависимость msedge-tts).
 *
 * Результат: готовые MP4 в папке ./series-output/.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { dubVideo } from "./lib/dub.mjs";
import { deliverReel } from "./lib/deliver.mjs";
import { loadEnv } from "./lib/env.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT_DIR = path.join(ROOT, "series-output");

/**
 * Серия роликов. videoUrl — картинка от Higgsfield (Kling), text — реплика
 * (её и озвучит Дмитрий, и покажем субтитром). voiceStart — с какой секунды
 * вступает голос. hook — крупная подпись сверху в первые секунды (зацеп).
 */
const SERIES = [
  {
    name: "01-raccoon-inflation",
    videoUrl:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3GpUFCT1HtmzOC0PvBBDtXw98JA/hf_20260723_214336_e71dfe9f-ad47-40c7-9468-2fd45b207ce9.mp4",
    text: "Инфляция? Не знаю… Да я теперь питаюсь как министр — тем, что осталось.",
    voiceStart: 0.4,
    hook: "ЧТО ЕНОТ ДУМАЕТ ОБ ИНФЛЯЦИИ?",
  },
  {
    name: "02-hamster-salary",
    videoUrl:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3GpUFCT1HtmzOC0PvBBDtXw98JA/hf_20260723_215546_76180f9a-c74f-4fb4-96bc-5e9972bc05a8.mp4",
    text: "Работаю без выходных. Колесо, правда, стоит на месте. Как и зарплата.",
    voiceStart: 1.2,
    hook: "КАК ЖИВЁТ ОФИСНЫЙ ПЛАНКТОН?",
  },
  {
    name: "03-cat-banker",
    videoUrl:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3GpUFCT1HtmzOC0PvBBDtXw98JA/hf_20260723_221525_3bf7f029-999b-4280-a257-927c2d39b91d.mp4",
    text: "Ваш вклад в надёжных лапах. В моих. Больше вы меня не увидите.",
    voiceStart: 0.4,
    hook: "КУДА ПРОПАДАЮТ ВКЛАДЫ?",
  },
];

/** Скачать файл по URL в путь dest. */
async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не скачалось (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error(`Пустой файл: ${url}`);
  fs.writeFileSync(dest, buf);
}

async function buildOne(item, scratch) {
  const videoPath = path.join(scratch, `${item.name}.src.mp4`);
  const log = (line) => process.stdout.write(`[${item.name}] ${line}\n`);

  log("скачиваю видео…");
  await download(item.videoUrl, videoPath);

  log("синтезирую голос и собираю…");
  const out = path.join(OUT_DIR, `${item.name}.mp4`);
  const { voiceStart, music } = await dubVideo({
    input: videoPath,
    output: out,
    text: item.text,
    hook: item.hook,
    voiceStart: item.voiceStart,
  });
  log(`готово (голос с ${voiceStart.toFixed(1)}с, музыка ${music ? "вкл" : "выкл"}) → ${out}`);

  await deliverReel({
    filePath: out,
    name: item.name,
    caption: `${item.hook}\n\n${item.text}`,
    log,
  });
  return out;
}

async function main() {
  loadEnv(); // подхватить TELEGRAM_* / VIBEPOST_* из .env (доставка — по желанию)
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "voiceover-"));
  const done = [];
  try {
    for (const item of SERIES) {
      try {
        done.push(await buildOne(item, scratch));
      } catch (e) {
        process.stdout.write(`[${item.name}] ОШИБКА: ${e.message}\n`);
      }
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  process.stdout.write(`\nГотово: ${done.length} из ${SERIES.length}. Папка: ${OUT_DIR}\n`);
  for (const f of done) process.stdout.write(`  • ${path.basename(f)}\n`);
  if (done.length < SERIES.length) process.exitCode = 1;
}

main().catch((e) => {
  process.stderr.write(`Сбой: ${e.message}\n`);
  process.exitCode = 1;
});
