/**
 * Minimal, dependency-free .env reader/writer.
 *
 * Design goals (from the task requirements):
 *  - Create or update .env without ever deleting existing values.
 *  - Keep .env out of git and provide a secret-free .env.example.
 *  - Never print secret values.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Absolute path to the repository root (one level above scripts/).
 * Can be overridden with VEO_PROJECT_ROOT (used by tests).
 *
 * fileURLToPath() is required for correctness across platforms: using a file
 * URL's `.pathname` directly yields `/C:/repo/...` on Windows (an invalid
 * native path) and leaves `%20` etc. percent-encoded everywhere.
 */
export const ROOT =
  process.env.VEO_PROJECT_ROOT ?? path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const ENV_PATH = path.join(ROOT, ".env");
export const ENV_EXAMPLE_PATH = path.join(ROOT, ".env.example");
export const GITIGNORE_PATH = path.join(ROOT, ".gitignore");

/**
 * Parse .env text into a plain key/value object. Supports `KEY=value`,
 * `export KEY=value`, `#` comments and optional single/double quotes.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

/**
 * Read and parse the project's .env, or return {} if it does not exist.
 * @returns {Record<string, string>}
 */
export function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  return parseEnv(fs.readFileSync(ENV_PATH, "utf8"));
}

/**
 * Load the project's .env into process.env without overwriting variables that
 * are already set in the real environment.
 */
export function loadEnv() {
  const values = readEnv();
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return values;
}

function formatValue(value) {
  // Quote when the value contains characters that would break a bare line
  // (spaces, quotes, `#`, backslashes as in Windows paths, etc.).
  if (/[\s#"'\\]/.test(value)) {
    return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }
  return value;
}

/**
 * Upsert the given key/value pairs into .env, preserving every other line,
 * comment and existing value. Only the provided keys are touched.
 *
 * @param {Record<string, string>} updates
 */
export function upsertEnv(updates) {
  const original = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const lines = original === "" ? [] : original.split(/\r?\n/);
  const remaining = { ...updates };

  const nextLines = lines.map((line) => {
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match && Object.prototype.hasOwnProperty.call(remaining, match[1])) {
      const key = match[1];
      const value = remaining[key];
      delete remaining[key];
      return `${key}=${formatValue(value)}`;
    }
    return line;
  });

  // Trim a single trailing empty line so appends stay tidy.
  while (nextLines.length && nextLines[nextLines.length - 1] === "") {
    nextLines.pop();
  }
  for (const [key, value] of Object.entries(remaining)) {
    nextLines.push(`${key}=${formatValue(value)}`);
  }

  fs.writeFileSync(ENV_PATH, nextLines.join("\n") + "\n", { mode: 0o600 });
}

/**
 * Write .env.example listing ONLY variable names (no values, no secrets),
 * grouped into commented sections so regenerating it keeps the explanations
 * a reader needs (e.g. which VibePost key is expected).
 *
 * @param {{comment?: string[], keys: string[]}[]} sections
 */
export function writeEnvExample(sections) {
  const lines = [
    "# Copy this file to .env and fill in the values, or run `npm run setup`.",
    "# Do NOT put real secrets here — .env.example is committed to git.",
    "",
  ];
  sections.forEach((section, index) => {
    if (index > 0) lines.push("");
    for (const line of section.comment ?? []) lines.push(`# ${line}`);
    for (const key of section.keys) lines.push(`${key}=`);
  });
  fs.writeFileSync(ENV_EXAMPLE_PATH, lines.join("\n") + "\n");
}

/**
 * Ensure .env (and variants) are git-ignored while keeping .env.example tracked.
 */
export function ensureGitignore() {
  const wanted = [".env", ".env.*", "!.env.example"];
  let content = fs.existsSync(GITIGNORE_PATH) ? fs.readFileSync(GITIGNORE_PATH, "utf8") : "";
  const existing = new Set(content.split(/\r?\n/).map((l) => l.trim()));
  const missing = wanted.filter((entry) => !existing.has(entry));
  if (missing.length === 0) return;

  if (content !== "" && !content.endsWith("\n")) content += "\n";
  content += "\n# Google Veo automation secrets\n" + missing.join("\n") + "\n";
  fs.writeFileSync(GITIGNORE_PATH, content);
}
