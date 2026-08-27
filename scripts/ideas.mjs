#!/usr/bin/env node
/**
 * Propose reel ideas and let the owner approve them one by one.
 *
 *   npm run ideas                          # предложить 5 новых идей
 *   npm run ideas -- --count 8             # предложить 8
 *   npm run ideas -- --brief "про отпуск"  # с пожеланием по теме
 *   npm run ideas -- --review              # только разобрать отложенные
 *
 * This is the approval gate required by CLAUDE.md: nothing is generated from
 * text the owner has not read. The script only calls the free text model —
 * no video, no billing. Approved ideas land in `ideas/*.json` and are picked
 * up later by `npm run reels`.
 */
import { loadEnv } from "./lib/env.mjs";
import { pathToFileURL } from "node:url";
import { ask, askChoice } from "./lib/prompt.mjs";
import { proposeIdeas } from "./lib/gemini.mjs";
import { addIdeas, loadIdeas, updateIdea, approvedPending } from "./lib/ideas.mjs";
import { logSafeError } from "./lib/secret.mjs";

export function parseArgs(argv) {
  const args = { count: 5, brief: undefined, review: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--count") args.count = Number.parseInt(argv[++i], 10) || args.count;
    else if (token === "--brief") args.brief = argv[++i];
    else if (token === "--review") args.review = true;
    else if (token.startsWith("--count=")) args.count = Number.parseInt(token.slice(8), 10) || args.count;
    else if (token.startsWith("--brief=")) args.brief = token.slice(8);
  }
  return args;
}

const LINE = "─".repeat(64);

/** Show one idea in full so the owner judges the actual text, not a summary. */
function show(idea, position, total) {
  process.stdout.write(`\n${LINE}\n`);
  process.stdout.write(`[${position}/${total}]  ${idea.animal} / ${idea.topic}\n`);
  process.stdout.write(`${LINE}\n`);
  process.stdout.write(`ХУК:     ${idea.hook}\n`);
  process.stdout.write(`РЕПЛИКА: ${idea.text}\n\n`);
  process.stdout.write(`ПРОМПТ:  ${idea.prompt}\n`);
}

const DECISIONS = [
  { value: "approve", label: "утвердить — пойдёт в генерацию" },
  { value: "rewrite", label: "переписать реплику и хук, потом утвердить" },
  { value: "later", label: "отложить — вернуться к ней потом" },
  { value: "reject", label: "выбросить" },
];

/**
 * Walk the owner through each idea. Returns the ideas worth storing:
 * approved ones and postponed ones. Rejected ideas are simply dropped.
 */
async function review(ideas) {
  const keep = [];
  for (let i = 0; i < ideas.length; i++) {
    const idea = { ...ideas[i] };
    show(idea, i + 1, ideas.length);

    const decision = await askChoice("\nЧто делаем?", DECISIONS, "approve");

    if (decision === "reject") {
      process.stdout.write("Выброшено.\n");
      continue;
    }
    if (decision === "later") {
      keep.push({ ...idea, approved: false });
      process.stdout.write("Отложено — появится при следующем `npm run ideas -- --review`.\n");
      continue;
    }
    if (decision === "rewrite") {
      idea.text = await ask(`\nРеплика [Enter — оставить]:\n> `, { fallback: idea.text });
      idea.hook = await ask(`Хук [Enter — оставить]:\n> `, { fallback: idea.hook });
      process.stdout.write("\nИтог:\n");
      process.stdout.write(`ХУК:     ${idea.hook}\n`);
      process.stdout.write(`РЕПЛИКА: ${idea.text}\n`);
    }
    keep.push({ ...idea, approved: true });
    process.stdout.write("Утверждено.\n");
  }
  return keep;
}

export async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));

  if (args.review) {
    // Re-open everything previously postponed, and write decisions back in place.
    const pending = loadIdeas().filter((idea) => !idea.approved && !idea.video);
    if (pending.length === 0) {
      process.stdout.write("Отложенных идей нет. Запустите `npm run ideas` за новыми.\n");
      return;
    }
    const decided = await review(pending);
    for (const idea of decided) {
      updateIdea(idea.slug, {
        text: idea.text,
        hook: idea.hook,
        approved: idea.approved,
        ...(idea.approved ? { approvedAt: new Date().toISOString() } : {}),
      });
    }
    summary();
    return;
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY не задан. Сначала выполните: npm run setup");
  }

  // Feed everything already used back in, so proposals stay fresh.
  const used = loadIdeas().flatMap((idea) => [idea.animal, idea.topic].filter(Boolean));
  process.stdout.write(`Прошу Gemini предложить ${args.count} идей...\n`);
  const proposed = await proposeIdeas({
    apiKey,
    count: args.count,
    avoid: [...new Set(used)],
    brief: args.brief,
  });

  process.stdout.write(
    `\nПредложено: ${proposed.length}. Смотрим по одной — ничего не генерируется, пока вы не утвердите.\n`,
  );
  const keep = await review(proposed);
  if (keep.length === 0) {
    process.stdout.write("\nНичего не сохранено.\n");
    return;
  }
  const { file } = addIdeas(keep);
  process.stdout.write(`\nСохранено в ${file}\n`);
  summary();
}

function summary() {
  const ready = approvedPending();
  process.stdout.write(`Утверждено и ждёт генерации: ${ready.length}\n`);
  if (ready.length > 0) {
    for (const idea of ready) process.stdout.write(`  • ${idea.slug} — ${idea.text}\n`);
    process.stdout.write("\nДальше: npm run reels\n");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    logSafeError(error?.message ?? error, [process.env.GOOGLE_API_KEY]);
    process.exitCode = 1;
  });
}
