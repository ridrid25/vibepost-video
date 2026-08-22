#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildFastCycleContext, evaluateExperiment } from "./lib/content-brigade.mjs";
import {
  buildAccountAnalytics,
  ContentBrigadeApi,
  runLearningCycle,
} from "./lib/content-brigade-supabase.mjs";
import { loadEnv } from "./lib/env.mjs";

function inputPath(argv) {
  const index = argv.indexOf("--input");
  return index >= 0 ? argv[index + 1] : null;
}

const file = inputPath(process.argv.slice(2));
const argv = process.argv.slice(2);
const payload = file
  ? JSON.parse(fs.readFileSync(path.resolve(file), "utf8"))
  : {};

const liveActions = ["--live", "--cycle", "--studio", "--record-prompt", "--annotate-video", "--record-experiment",
  "--record-analysis", "--record-lesson"];
if (liveActions.some((flag) => argv.includes(flag))) {
  loadEnv();
  const api = new ContentBrigadeApi({
    url: process.env.VIBEPOST_BRIGADE_URL,
    secret: process.env.VIBEPOST_BRIGADE_SECRET,
  });
  const studioIndex = argv.indexOf("--studio");
  const promptIndex = argv.indexOf("--record-prompt");
  const annotationIndex = argv.indexOf("--annotate-video");
  const experimentIndex = argv.indexOf("--record-experiment");
  const analysisIndex = argv.indexOf("--record-analysis");
  const lessonIndex = argv.indexOf("--record-lesson");
  if (studioIndex >= 0) {
    const studio = JSON.parse(fs.readFileSync(path.resolve(argv[studioIndex + 1]), "utf8"));
    process.stdout.write(JSON.stringify(await api.upsertStudioMetrics(studio), null, 2) + "\n");
  } else if (promptIndex >= 0) {
    const prompt = JSON.parse(fs.readFileSync(path.resolve(argv[promptIndex + 1]), "utf8"));
    process.stdout.write(JSON.stringify(await api.recordPrompt(prompt), null, 2) + "\n");
  } else if (annotationIndex >= 0) {
    const annotation = JSON.parse(fs.readFileSync(path.resolve(argv[annotationIndex + 1]), "utf8"));
    process.stdout.write(JSON.stringify(await api.annotateVideo(annotation), null, 2) + "\n");
  } else if (experimentIndex >= 0) {
    const experiment = JSON.parse(fs.readFileSync(path.resolve(argv[experimentIndex + 1]), "utf8"));
    process.stdout.write(JSON.stringify(await api.recordExperiment(experiment), null, 2) + "\n");
  } else if (analysisIndex >= 0) {
    const analysis = JSON.parse(fs.readFileSync(path.resolve(argv[analysisIndex + 1]), "utf8"));
    process.stdout.write(JSON.stringify(await api.recordAnalysis(analysis), null, 2) + "\n");
  } else if (lessonIndex >= 0) {
    const lesson = JSON.parse(fs.readFileSync(path.resolve(argv[lessonIndex + 1]), "utf8"));
    process.stdout.write(JSON.stringify(await api.recordLesson(lesson), null, 2) + "\n");
  } else {
    const result = argv.includes("--cycle")
      ? await api.runCycle()
      : buildAccountAnalytics(await api.context());
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  }
} else {
  const previousResult = payload.experiment
    ? evaluateExperiment(payload.experiment, payload.policy)
    : null;
  const result = buildFastCycleContext({ previousResult, memory: payload.memory });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
