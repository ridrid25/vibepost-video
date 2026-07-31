/**
 * Video assembly engine (ffmpeg).
 *
 * Takes N generated clips and stitches them into a single vertical (9:16) reel:
 *  - normalises every clip to the same size/fps/audio so they concatenate cleanly;
 *  - concatenates them in order;
 *  - optionally overlays a "hook" caption over the first seconds;
 *  - optionally mixes in background music.
 *
 * Requires ffmpeg + ffprobe on PATH. No network, no API key — this stage can be
 * built and tested entirely on placeholder clips.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
];

/** First existing font file with broad (incl. Cyrillic) coverage, or null. */
export function findFont() {
  return FONT_CANDIDATES.find((f) => fs.existsSync(f)) ?? null;
}

/** Run ffmpeg/ffprobe, resolving stdout or rejecting with a trimmed stderr. */
function run(bin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else {
        // Keep only the tail of ffmpeg's noisy stderr for a readable error.
        const tail = err.trim().split("\n").slice(-6).join("\n");
        reject(new Error(`${bin} exited ${code}:\n${tail}`));
      }
    });
  });
}

/** True if the file has at least one audio stream. */
export async function hasAudio(file) {
  const out = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a",
    "-show_entries",
    "stream=index",
    "-of",
    "csv=p=0",
    file,
  ]);
  return out.length > 0;
}

/** Duration of a media file in seconds (float). */
export async function duration(file) {
  const out = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    file,
  ]);
  return Number.parseFloat(out) || 0;
}

/**
 * Normalise one clip to a fixed WxH / fps, h264 + stereo aac. Clips without an
 * audio track get silence so concatenation never desyncs.
 */
async function normalizeClip(input, output, { width, height, fps }) {
  const withAudio = await hasAudio(input);
  const args = ["-y", "-i", input];
  if (!withAudio) {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
  }
  const vf =
    `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},setsar=1,fps=${fps},format=yuv420p`;
  args.push(
    "-filter_complex",
    `[0:v]${vf}[v]`,
    "-map",
    "[v]",
    "-map",
    withAudio ? "0:a:0" : "1:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-b:a",
    "128k",
    "-shortest",
    output,
  );
  await run("ffmpeg", args);
}

/** Wrap text to at most `maxChars` per line, breaking on spaces. */
export function wrapText(text, maxChars) {
  const words = text.trim().split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line === "") line = word;
    else if ((line + " " + word).length <= maxChars) line += " " + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/** Write the (word-wrapped) hook caption to a file for drawtext's textfile=. */
function writeHookFile(dir, text, maxChars) {
  const p = path.join(dir, "hook.txt");
  fs.writeFileSync(p, wrapText(text, maxChars));
  return p;
}

/**
 * Assemble clips into one vertical video.
 *
 * @param {object} opts
 * @param {string[]} opts.clips     Ordered input video paths (>= 1).
 * @param {string}   opts.output    Final output path (.mp4).
 * @param {number}   [opts.width=720]
 * @param {number}   [opts.height=1280]
 * @param {number}   [opts.fps=30]
 * @param {string}   [opts.music]   Background music path (looped, ducked under).
 * @param {number}   [opts.musicVolume=0.25]
 * @param {string}   [opts.hook]    Caption shown over the first seconds.
 * @param {number}   [opts.hookDuration=3]
 * @param {string}   [opts.workDir] Scratch dir (defaults to a temp dir).
 * @returns {Promise<{output: string, clips: number, durationSec: number}>}
 */
export async function assembleVideo({
  clips,
  output,
  width = 720,
  height = 1280,
  fps = 30,
  music,
  musicVolume = 0.25,
  hook,
  hookDuration = 3,
  workDir,
}) {
  if (!Array.isArray(clips) || clips.length === 0) {
    throw new Error("assembleVideo: нужен хотя бы один клип.");
  }
  for (const c of clips) {
    if (!fs.existsSync(c)) throw new Error(`Клип не найден: ${c}`);
  }

  const scratch = workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "veo-assemble-"));
  const ownScratch = !workDir;
  fs.mkdirSync(scratch, { recursive: true });

  try {
    // 1. Normalise each clip to a common format.
    const normalized = [];
    for (let i = 0; i < clips.length; i++) {
      const dst = path.join(scratch, `clip_${String(i).padStart(3, "0")}.mp4`);
      await normalizeClip(clips[i], dst, { width, height, fps });
      normalized.push(dst);
    }

    // 2. Concatenate (stream copy — all inputs share one format now).
    const listPath = path.join(scratch, "concat.txt");
    fs.writeFileSync(
      listPath,
      normalized.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n",
    );
    const montage = path.join(scratch, "montage.mp4");
    await run("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      montage,
    ]);

    // 3. Optional post pass: hook caption and/or background music.
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    if (!hook && !music) {
      fs.copyFileSync(montage, output);
    } else {
      const args = ["-y", "-i", montage];
      if (music) args.push("-stream_loop", "-1", "-i", music);

      // Video chain: optional hook caption over the first hookDuration seconds.
      let vLabel = "0:v";
      const filters = [];
      if (hook) {
        const font = findFont();
        // ~16 chars/line keeps the caption inside a 720px-wide frame at this size.
        const hookFile = writeHookFile(scratch, hook, 16);
        const draw =
          `drawtext=` +
          (font ? `fontfile='${font}':` : "") +
          `textfile='${hookFile}':` +
          `fontcolor=white:fontsize=${Math.round(height * 0.045)}:` +
          `box=1:boxcolor=black@0.55:boxborderw=22:` +
          `x=(w-text_w)/2:y=h*0.14:` +
          `line_spacing=12:enable='lt(t,${hookDuration})'`;
        filters.push(`[0:v]${draw}[v]`);
        vLabel = "v";
      }

      // Audio chain: mix looped music (ducked) under the original audio.
      let aLabel = "0:a";
      if (music) {
        filters.push(
          `[1:a]volume=${musicVolume}[m]`,
          `[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]`,
        );
        aLabel = "a";
      }

      if (filters.length) args.push("-filter_complex", filters.join(";"));
      // Map either the raw stream (no filter applied) or the filtered label.
      const vMap = vLabel === "0:v" ? "0:v" : "[v]";
      const aMap = aLabel === "0:a" ? "0:a" : "[a]";
      args.push(
        "-map",
        vMap,
        "-map",
        aMap,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-b:a",
        "128k",
        "-shortest",
        output,
      );
      await run("ffmpeg", args);
    }

    const durationSec = await duration(output);
    return { output, clips: clips.length, durationSec };
  } finally {
    if (ownScratch) fs.rmSync(scratch, { recursive: true, force: true });
  }
}
