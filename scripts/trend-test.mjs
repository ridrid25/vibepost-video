#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { loadEnv } from "./lib/env.mjs";
import {
  MockReferenceSource,
  YouTubeReferenceSource,
  scoutReferences,
} from "./lib/reference-scout.mjs";
import { buildReferenceDNA } from "./lib/reference-dna.mjs";
import {
  adaptReferenceDNA,
  buildControlBrief,
  buildIdeasCommand,
  formatControlBrief,
  formatExperimentBrief,
} from "./lib/reference-adapter.mjs";

export function parseTrendArgs(argv) {
  const args = { count: 4, dryRun: false, mock: false, reference: undefined };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--dry-run") args.dryRun = true;
    else if (token === "--mock") args.mock = true;
    else if (token === "--reference") args.reference = argv[++i];
    else if (token === "--count") args.count = Number.parseInt(argv[++i], 10);
    else if (token.startsWith("--reference=")) args.reference = token.slice(12);
    else if (token.startsWith("--count=")) args.count = Number.parseInt(token.slice(8), 10);
    else throw new Error(`Unknown option: ${token}`);
  }
  if (!Number.isInteger(args.count) || args.count < 1 || args.count > 10) {
    throw new Error("--count must be an integer from 1 to 10.");
  }
  return args;
}

function printResult(result, write) {
  write(`Status: ${result.status}\n`);
  write(`Mode: ${result.mode}\n`);
  if (result.note) write(`${result.note}\n`);
  if (result.status === "BLOCKED BY CREDENTIAL") return;

  for (let index = 0; index < result.references.length; index++) {
    const reference = result.references[index];
    const dna = result.dna[index];
    const brief = result.briefs[index];
    const text = formatExperimentBrief(brief);
    write(`\n[${index + 1}/${result.references.length}] ${reference.reference_id}\n`);
    write(`Signals: ${JSON.stringify(reference.signals)}\n`);
    write(`Reference DNA: ${JSON.stringify(dna, null, 2)}\n`);
    write(`Experiment Brief: ${text}\n`);
    write(`Ideas command: ${buildIdeasCommand(text)}\n`);
  }

  const controlText = formatControlBrief(result.control);
  write(`\n[CONTROL]\nExperiment Brief: ${controlText}\n`);
  write(`Ideas command: ${buildIdeasCommand(controlText)}\n`);
  write("\nPaid video calls: 0. Automatic posting: 0.\n");
}

export async function runTrendTest({
  argv = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  write = (text) => process.stdout.write(text),
} = {}) {
  const args = parseTrendArgs(argv);
  const useMock = args.mock || args.dryRun || !args.reference;

  if (!useMock && !env.YOUTUBE_API_KEY) {
    const result = {
      status: "BLOCKED BY CREDENTIAL",
      mode: "live",
      note: "YOUTUBE_API_KEY is missing. No live request was attempted; use --mock for the deterministic demo.",
      references: [],
      dna: [],
      briefs: [],
      control: buildControlBrief(),
    };
    printResult(result, write);
    return result;
  }

  const source = useMock
    ? new MockReferenceSource()
    : new YouTubeReferenceSource({ apiKey: env.YOUTUBE_API_KEY, fetchImpl });
  const scouted = await scoutReferences({
    source,
    count: args.count,
    referenceUrl: args.reference,
  });
  const dna = scouted.references.map(buildReferenceDNA);
  const briefs = dna.map((item, index) => adaptReferenceDNA(item, { index }));
  const result = {
    status: scouted.verification,
    mode: useMock ? "mock" : "live",
    note: useMock
      ? (args.reference
          ? "Dry/mock mode did not fetch the supplied URL; deterministic synthetic fixtures were used."
          : undefined)
      : "Live YouTube metadata scout verified. Visual/transcript DNA fields without evidence remain UNKNOWN.",
    references: scouted.references,
    dna,
    briefs,
    control: buildControlBrief(),
    paid_video_calls: 0,
    automatic_posts: 0,
  };
  printResult(result, write);
  return result;
}

async function main() {
  loadEnv();
  const result = await runTrendTest({ argv: process.argv.slice(2), env: process.env });
  if (result.status === "BLOCKED BY CREDENTIAL") process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? error}\n`);
    process.exitCode = 1;
  });
}
