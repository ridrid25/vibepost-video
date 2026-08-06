/**
 * Video "polish" step (ffmpeg): turns a raw Veo clip into a finished vertical
 * reel ready to post — speed-up, hook caption, subtitles and a quiet music bed.
 *
 * Applied automatically after generation. Every stage is optional/tunable; a
 * missing font or music file degrades gracefully rather than failing the run.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { findFont, wrapText } from "./assemble.mjs";

// fileURLToPath, not `.pathname`: on Windows the latter yields "/C:/repo/..."
// and path.resolve turns that into "C:\C:\repo\..." — the music bed then never
// resolves and the bed is silently dropped from every reel.
const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
/** Bundled royalty-free background track (synthesised, no copyright). */
export const DEFAULT_MUSIC = path.join(ROOT, "scripts", "assets", "music-bed.mp3");

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`${bin} exited ${code}:\n${err.trim().split("\n").slice(-6).join("\n")}`));
    });
  });
}

function escDrawtextPath(p) {
  // drawtext fontfile/textfile paths need ':' and '\' escaped inside the filter.
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

/**
 * Polish a single clip into the finished reel.
 *
 * @param {object} o
 * @param {string} o.input           Raw clip path.
 * @param {string} o.output          Finished output path (.mp4).
 * @param {number} [o.speed=1.25]    Playback speed (video + audio, kept in sync).
 * @param {string} [o.hook]          Short caption over the first seconds (top).
 * @param {number} [o.hookDuration=3] Seconds the hook stays (pre-speed timeline).
 * @param {string} [o.subtitle]      Spoken line burned as captions (bottom).
 * @param {string|null} [o.music]    Music file, or null to disable. Default bed.
 * @param {number} [o.musicVolume=0.15] Music level under the voice.
 * @param {number} [o.width=720]
 * @param {number} [o.height=1280]
 * @returns {Promise<{output: string}>}
 */
export async function polishVideo({
  input,
  output,
  speed = 1.25,
  hook,
  hookDuration = 3,
  subtitle,
  music = DEFAULT_MUSIC,
  musicVolume = 0.42,
  height = 1280,
}) {
  if (!fs.existsSync(input)) throw new Error(`Клип не найден: ${input}`);
  const font = findFont();
  // Раньше при отсутствии шрифта текст молча не рисовался, и ролик уходил
  // в канал без титров. Молчать тут нельзя: лучше остановиться.
  if ((hook || subtitle) && !font) {
    throw new Error("Не найден шрифт для титров — проверь FONT_CANDIDATES в assemble.mjs");
  }
  const useMusic = music && fs.existsSync(music);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "veo-polish-"));

  try {
    // Video chain: speed change, then optional hook (top) and subtitle (bottom).
    // Overlay timings are on the sped-up timeline.
    const vparts = [`setpts=PTS/${speed}`];
    if (hook && font) {
      const hookFile = path.join(scratch, "hook.txt");
      fs.writeFileSync(hookFile, wrapText(hook, 18));
      vparts.push(
        `drawtext=fontfile='${escDrawtextPath(font)}':textfile='${escDrawtextPath(hookFile)}':` +
          `fontcolor=white:fontsize=${Math.round(height * 0.045)}:box=1:boxcolor=black@0.55:` +
          `boxborderw=18:x=(w-text_w)/2:y=h*0.05:enable='lt(t,${hookDuration / speed})'`,
      );
    }
    if (subtitle && font) {
      const subFile = path.join(scratch, "sub.txt");
      fs.writeFileSync(subFile, wrapText(subtitle, 18));
      vparts.push(
        `drawtext=fontfile='${escDrawtextPath(font)}':textfile='${escDrawtextPath(subFile)}':` +
          `fontcolor=white:fontsize=${Math.round(height * 0.036)}:box=1:boxcolor=black@0.6:` +
          `boxborderw=16:line_spacing=8:x=(w-text_w)/2:y=h*0.72:enable='gt(t,0.3)'`,
      );
    }

    const filter = [`[0:v]${vparts.join(",")}[v]`, `[0:a]atempo=${speed}[voice]`];
    if (useMusic) {
      filter.push(`[1:a]volume=${musicVolume}[m]`);
      filter.push(`[voice][m]amix=inputs=2:duration=first:dropout_transition=0[a]`);
    }

    const args = ["-y", "-i", input];
    if (useMusic) args.push("-stream_loop", "-1", "-i", music);
    args.push(
      "-filter_complex",
      filter.join(";"),
      "-map",
      "[v]",
      "-map",
      useMusic ? "[a]" : "[voice]",
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
    return { output };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
