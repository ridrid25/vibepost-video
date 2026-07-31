/**
 * Tiny cross-platform interactive prompt helpers built on Node's readline.
 * Works on Windows, macOS and Linux without any third-party dependency.
 */
import readline from "node:readline";

/**
 * Ask a question and return the trimmed answer. If the user just presses Enter
 * and a `fallback` is given, the fallback is returned.
 *
 * @param {string} query
 * @param {{ fallback?: string }} [options]
 * @returns {Promise<string>}
 */
export function ask(query, { fallback } = {}) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      const value = answer.trim();
      resolve(value === "" && fallback !== undefined ? fallback : value);
    });
  });
}

/**
 * Ask for a secret without echoing keystrokes to the screen.
 *
 * The prompt itself IS printed (so the user sees what is being asked), but every
 * keystroke and the final value stay invisible. We let readline render the
 * prompt via question(), then mute all further output so nothing typed is shown.
 * Muting after question() — rather than suppressing everything up front — is what
 * keeps the prompt visible while still hiding the input. Works on Windows and
 * POSIX terminals.
 *
 * @param {string} query
 * @param {{ fallback?: string }} [options]
 * @returns {Promise<string>}
 */
export function askHidden(query, { fallback } = {}) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  let muted = false;
  const write = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (str) => {
    // Before muting, let the prompt render; after, drop all keystroke echo.
    if (!muted) write(str);
  };
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      process.stdout.write("\n");
      const value = answer.trim();
      resolve(value === "" && fallback !== undefined ? fallback : value);
    });
    // question() has now synchronously rendered the prompt; hide everything after.
    muted = true;
  });
}

/**
 * Present a numbered menu and return the chosen value.
 *
 * @param {string} title
 * @param {Array<{ value: string, label: string }>} choices
 * @param {string} [defaultValue]
 * @returns {Promise<string>}
 */
export async function askChoice(title, choices, defaultValue) {
  const defaultIndex = Math.max(
    0,
    choices.findIndex((c) => c.value === defaultValue),
  );
  process.stdout.write(title + "\n");
  choices.forEach((choice, i) => {
    const marker = i === defaultIndex ? " (по умолчанию)" : "";
    process.stdout.write(`  ${i + 1}) ${choice.label}${marker}\n`);
  });

  // Loop until a valid selection (or Enter for the default) is given.
  for (;;) {
    const raw = await ask(`Выбор [1-${choices.length}] (Enter — по умолчанию): `);
    if (raw === "") return choices[defaultIndex].value;
    const n = Number.parseInt(raw, 10);
    if (Number.isInteger(n) && n >= 1 && n <= choices.length) {
      return choices[n - 1].value;
    }
    process.stdout.write("Некорректный выбор, попробуйте ещё раз.\n");
  }
}
