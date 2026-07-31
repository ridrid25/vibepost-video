/**
 * Storage for reel ideas and their approval state.
 *
 * The owner's rule: no video is ever generated from text she has not read and
 * approved (see CLAUDE.md). This module is the technical form of that rule —
 * ideas live on disk as plain JSON with an `approved` flag, and the generator
 * only ever looks at approved ones. Nothing here calls a paid API.
 *
 * Layout: one file per day, `ideas/YYYY-MM-DD.json`, holding an array of ideas.
 * Plain JSON on purpose — the owner can open and edit it in any editor without
 * running a script.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";

export const IDEAS_DIR = path.join(ROOT, "ideas");

/**
 * @typedef {object} Idea
 * @property {string}  slug       Latin file-safe name, e.g. "04-pigeon-mortgage".
 * @property {string}  animal     Animal in Russian, for display.
 * @property {string}  topic      Economics topic in Russian, for display.
 * @property {string}  text       The spoken line — voiced and burned as subtitles.
 * @property {string}  hook       Big caption over the first seconds.
 * @property {string}  prompt     Video prompt (English) for Veo / the Gemini app.
 * @property {boolean} approved   Only approved ideas are ever generated.
 * @property {string}  createdAt  ISO timestamp.
 * @property {string=} approvedAt ISO timestamp of the owner's approval.
 * @property {string=} video      Path of the finished reel, once built.
 * @property {string=} builtAt    ISO timestamp of the build.
 */

/** Every `ideas/*.json` file, oldest first. */
export function ideaFiles() {
  if (!fs.existsSync(IDEAS_DIR)) return [];
  return fs
    .readdirSync(IDEAS_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(IDEAS_DIR, name));
}

/** Read one ideas file, tolerating an empty or malformed file. */
function readFile(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** All ideas from all files, flattened. */
export function loadIdeas() {
  return ideaFiles().flatMap(readFile);
}

/** Approved ideas that have not been turned into a video yet. */
export function approvedPending() {
  return loadIdeas().filter((idea) => idea.approved && !idea.video);
}

function writeFile(file, ideas) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ideas, null, 2) + "\n");
}

/**
 * Make a slug unique against everything already stored, so an idea's slug can
 * safely become the video's file name.
 */
function uniqueSlug(slug, taken) {
  const base = slug.trim().replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "reel";
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Append ideas to today's file, assigning unique slugs and default fields.
 * @param {Partial<Idea>[]} incoming
 * @returns {{file: string, ideas: Idea[]}}
 */
export function addIdeas(incoming) {
  const file = path.join(IDEAS_DIR, `${new Date().toISOString().slice(0, 10)}.json`);
  const existing = fs.existsSync(file) ? readFile(file) : [];
  const taken = new Set(loadIdeas().map((idea) => idea.slug));

  const added = incoming.map((idea) => {
    const slug = uniqueSlug(idea.slug ?? "", taken);
    taken.add(slug);
    return {
      slug,
      animal: idea.animal ?? "",
      topic: idea.topic ?? "",
      text: idea.text ?? "",
      hook: idea.hook ?? "",
      prompt: idea.prompt ?? "",
      approved: idea.approved ?? false,
      createdAt: new Date().toISOString(),
      ...(idea.approved ? { approvedAt: new Date().toISOString() } : {}),
    };
  });

  writeFile(file, [...existing, ...added]);
  return { file, ideas: added };
}

/**
 * Patch a stored idea in whichever file holds it.
 * @param {string} slug
 * @param {Partial<Idea>} patch
 * @returns {boolean} whether the idea was found
 */
export function updateIdea(slug, patch) {
  for (const file of ideaFiles()) {
    const ideas = readFile(file);
    const index = ideas.findIndex((idea) => idea.slug === slug);
    if (index === -1) continue;
    ideas[index] = { ...ideas[index], ...patch };
    writeFile(file, ideas);
    return true;
  }
  return false;
}

/** One-line summary for terminal listings. */
export function describe(idea) {
  const state = idea.video ? "готово" : idea.approved ? "утверждено" : "ждёт решения";
  return `${idea.slug} — ${idea.animal || "?"} / ${idea.topic || "?"} [${state}]`;
}
