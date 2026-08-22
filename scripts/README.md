# Reel automation (Gemini / Veo)

Turns an idea into a finished vertical reel: text approved by the owner →
video → clean Russian voice-over → delivery to Telegram and VibePost.

Uses the official [`@google/genai`](https://www.npmjs.com/package/@google/genai)
SDK. No manual `.env` editing required.

Русское руководство для владелицы: [`docs/КАК_РАБОТАТЬ.md`](../docs/КАК_РАБОТАТЬ.md).
Ход работ: [`docs/ЭТАПЫ.md`](../docs/ЭТАПЫ.md).

## Billing, up front

**Veo video generation is paid-tier only** — the Gemini API free tier does not
generate video at all. Text generation (ideas, lines, hooks) runs on a flash
model and *is* free.

| Veo 3.1 | 720p | 1080p |
| ------- | ---- | ----- |
| Lite    | $0.05/s | $0.08/s |
| Fast    | $0.10/s | $0.12/s |
| Standard| $0.40/s | $0.60/s |

An 8-second clip on the default Lite/720p is about **$0.40**. `npm run reels`
shows the estimate and waits for a yes before the first charge.

The free alternative: generate the clip by hand in the Gemini app and feed the
file in with `npm run reels -- --source`.

## 1. Setup (interactive — paste your secret here)

```bash
npm run setup
```

It will:

- ask for your `GOOGLE_API_KEY` (input is **hidden** on screen),
- ask for the output folder for finished videos,
- let you choose a Veo model,
- create/update `.env` **without deleting existing values**,
- add `.env` to `.gitignore`,
- regenerate a secret-free `.env.example`,
- run a safe check and print **`Настройка завершена`** or a clear error.

The API key is never printed to the terminal, logs, errors, the README or a
git diff.

## 2. The main workflow

```bash
npm run ideas      # Gemini предлагает концепты, вы утверждаете по одному
npm run reels      # утверждённое превращается в готовые ролики
```

`npm run ideas` calls only the free text model. Each concept is shown in full —
hook, spoken line, video prompt — and you approve, rewrite, postpone or discard
it. Approved ideas are stored in `ideas/YYYY-MM-DD.json` and committed to git.
**Nothing is generated from text you have not approved.**

Options: `--count N`, `--brief "пожелание"`, `--review` (revisit postponed).

`npm run reels` builds only ideas with `"approved": true` that have no video
yet: generate (or take a local clip), dub, add music, hook and subtitles, then
deliver.

Options: `--only <slug>`, `--source <file|dir>`, `--dry-run`, `--yes`.

## 3. One-off video from a prompt

```bash
npm run video -- --prompt "текст промпта" --name "scene-03"
npm run video:file -- prompts/scene-03.txt
```

Each run sends the prompt to the configured Veo model, polls until done,
downloads the MP4, never overwrites an existing video (a numeric suffix or
timestamp is added on collisions), writes a sidecar `*.json` with the prompt,
model, start time and final status, and handles errors and timeouts gracefully.

Add `--hook` and `--subtitle` to burn captions in.

## 4. Dub the first three clips (legacy)

```bash
npm run voiceover
```

Rebuilds the three original clips of the series from their source URLs. New
reels should go through `ideas` → `reels` instead.

## Configuration (`.env`)

| Variable               | Meaning                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| `GOOGLE_API_KEY`       | Google Gemini API key (Veo access). **Secret.**                      |
| `VIDEO_OUTPUT_DIR`     | Folder where `npm run video` saves MP4s + JSON.                      |
| `VEO_MODEL`            | Veo model id (default `veo-3.1-lite-generate-preview`).              |
| `VEO_RESOLUTION`       | Output resolution: `720p` (default) or `1080p`.                      |
| `VEO_ASPECT`           | Aspect ratio: `9:16` (default) or `16:9`.                            |
| `VIDEO_TIMEOUT_MS`     | Optional. Generation timeout in ms (default 600000).                 |
| `GEMINI_TEXT_MODEL`    | Optional. Text model for ideas (default `gemini-3.6-flash`).         |
| `TELEGRAM_BOT_TOKEN`   | Optional. Bot token to auto-deliver finished videos. **Secret.**     |
| `TELEGRAM_CHAT_ID`     | Optional. Target chat; set automatically by `npm run telegram:link`. |
| `VIBEPOST_INGEST_URL`  | Optional. URL of the VibePost `ingest-video` Edge Function.          |
| `VIBEPOST_INGEST_SECRET` | Optional. Dedicated `ingest-video` secret. **Secret.**             |
| `VIBEPOST_BRIGADE_URL` | Content Brigade Edge Function URL; exact VibePost host only.        |
| `VIBEPOST_BRIGADE_SECRET` | Dedicated Content Brigade API secret. **Secret.**                 |
| `VEO_SPEED`            | Optional. Playback speed of `npm run video` output (default `1.25`). |
| `VEO_MUSIC_VOLUME`     | Optional. Background music level, 0–1 (default `0.42`).              |
| `VEO_MUSIC`            | Optional. Set to `off` to disable the background music bed.          |

Core settings are written for you by `npm run setup`. To deliver finished
videos to Telegram: add `TELEGRAM_BOT_TOKEN` to `.env`, message your bot once,
then run `npm run telegram:link` to capture the chat id.

Reels arrive in VibePost as **drafts** — the scheduler never posts them until
they are scheduled by hand.

## Content Brigade v2

Live analytics are read from VibePost through a narrow Edge Function secret;
the Supabase `service_role` key is never stored in this project.

```bash
npm run brigade -- --live
npm run brigade -- --cycle
npm run brigade -- --studio studio-metrics.json
npm run brigade -- --record-prompt prompt-record.json
```

`--live` loads API snapshots, manual Studio values, experiments, Lessons and
the current Prompt Framework. Missing retention remains `null`; a tiny or
uncontrolled sample returns `INCONCLUSIVE`/`UNKNOWN`, never a fabricated Lesson.
`--cycle` calls the same server-authoritative Learning Engine used by pg_cron.
It persists comparable experiment checkpoints and creates at most a
`HYPOTHESIS` Lesson from one result; evidence gates control later promotion.

Required local values are `VIBEPOST_BRIGADE_URL` and the dedicated
`VIBEPOST_BRIGADE_SECRET`. They belong only in `.env`.

These values are optional for normal video production. The scheduled Learning
Engine runs inside Supabase and does not require its secret to be copied to this
computer. Configure them only when a developer needs the manual `--live` or
write commands.

## Notes

- Works on Windows, macOS and Linux (uses only Node's built-in `readline`).
- Requires `ffmpeg` and `ffprobe` in PATH.
- Requires dependencies to be installed first (`bun install` or `npm install`).
