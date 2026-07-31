/**
 * Secret redaction helpers.
 *
 * The single most important rule of this whole tool: the Google API key must
 * never reach the terminal, a log file, an error message, the README or a git
 * diff. Every string that could conceivably contain a secret is routed through
 * `redact()` before it is printed.
 */

/**
 * Replace every occurrence of each secret value in `input` with `***`.
 * Accepts any value; non-strings are stringified first so it is safe to pass
 * an Error, an object, etc.
 *
 * @param {unknown} input
 * @param {Array<string | undefined | null>} secrets
 * @returns {string}
 */
export function redact(input, secrets = []) {
  let text =
    input instanceof Error
      ? `${input.name}: ${input.message}\n${input.stack ?? ""}`
      : typeof input === "string"
        ? input
        : safeStringify(input);

  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      text = text.split(secret).join("***");
    }
  }
  // Belt-and-braces: also mask anything that looks like a Google API key or a
  // `key=` query parameter, even if we were never handed the value directly.
  text = text.replace(/AIza[0-9A-Za-z_-]{10,}/g, "***");
  text = text.replace(/([?&](?:key|api[_-]?key)=)[^&\s"']+/gi, "$1***");
  return text;
}

/**
 * Print an error to stderr with all known secrets stripped out.
 * @param {unknown} error
 * @param {Array<string | undefined | null>} secrets
 */
export function logSafeError(error, secrets = []) {
  process.stderr.write(redact(error, secrets) + "\n");
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
