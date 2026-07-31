/**
 * Idea generation via a Gemini text model.
 *
 * Text generation runs on the flash models, which are available on the free
 * tier — proposing ideas costs nothing. Only the video step (Veo) is billed,
 * and it never runs on text the owner has not approved.
 *
 * Structured output (responseSchema) is used so the result is a parseable
 * array rather than prose we would have to scrape.
 */
import { redact } from "./secret.mjs";

/** Free-tier flash model; overridable with GEMINI_TEXT_MODEL. */
export const DEFAULT_TEXT_MODEL = "gemini-3.6-flash";

/** House style of the series, kept in one place so ideas stay on-brand. */
const STYLE = `Серия «Уличная экономика»: мультяшные 3D-ролики в стиле Pixar,
вертикаль 9:16, около 8 секунд. Формат — «уличное интервью»: зверю подносят
маленький микрофон, он смотрит деадпан прямо в камеру и спокойно, устало
говорит одну реплику про экономику. Юмор ироничный, чёрный, но не злой.
Обязателен панч в конце реплики — неожиданный поворот в последнем предложении.`;

const SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      slug: {
        type: "STRING",
        description: "Латиницей, вида 'pigeon-mortgage': животное и тема через дефис.",
      },
      animal: { type: "STRING", description: "Животное по-русски, например «голубь»." },
      topic: { type: "STRING", description: "Экономическая тема по-русски, например «ипотека»." },
      text: {
        type: "STRING",
        description:
          "Реплика зверя по-русски, 1-2 предложения, максимум 140 символов, с панчем в конце.",
      },
      hook: {
        type: "STRING",
        description:
          "Хук-вопрос по-русски КАПСОМ, до 34 символов, например «ГДЕ ЖИВЁТ СРЕДНИЙ КЛАСС?».",
      },
      prompt: {
        type: "STRING",
        description:
          "Промпт для видеомодели на английском: вертикаль 9:16, Pixar-подобный 3D, зверь с " +
          "микрофоном, деадпан в камеру, действие на панче, описание света и фона.",
      },
    },
    required: ["slug", "animal", "topic", "text", "hook", "prompt"],
  },
};

/**
 * Turn a raw API failure into something actionable. The SDK surfaces Google's
 * error as a JSON blob, which tells a non-developer nothing — and the most
 * common cause by far is the wrong string pasted as the key.
 */
function explainApiError(error, apiKey) {
  const raw = redact(error?.message ?? String(error), [apiKey]);
  if (/401|UNAUTHENTICATED|ACCESS_TOKEN_TYPE_UNSUPPORTED/i.test(raw)) {
    return (
      "Google не принял ключ (401).\n" +
      "Скорее всего в .env лежит не API-ключ, а что-то другое, скопированное со страницы.\n" +
      "Возьмите ключ заново: https://aistudio.google.com/apikey → щёлкнуть по строке ключа\n" +
      "в колонке Key → скопировать значение целиком → выполнить `npm run setup`."
    );
  }
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(raw)) {
    return "Исчерпан бесплатный лимит запросов. Подождите немного и повторите.";
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network|timeout/i.test(raw)) {
    return "Не удалось связаться с Google API (сеть или таймаут). Проверьте подключение.";
  }
  return raw;
}

/**
 * Ask Gemini for fresh concepts.
 *
 * @param {object} o
 * @param {string} o.apiKey
 * @param {number} [o.count=5]      How many concepts to propose.
 * @param {string[]} [o.avoid]      Animals/topics already used, to avoid repeats.
 * @param {string} [o.brief]        Extra steer from the owner, free text.
 * @param {string} [o.model]
 * @returns {Promise<Array<{slug,animal,topic,text,hook,prompt}>>}
 */
export async function proposeIdeas({ apiKey, count = 5, avoid = [], brief, model }) {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const parts = [
    STYLE,
    `Придумай ${count} новых концептов для этой серии.`,
    avoid.length
      ? `Уже использовано, не повторяй ни зверей, ни темы: ${avoid.join(", ")}.`
      : "",
    brief ? `Дополнительное пожелание владелицы: ${brief}` : "",
    "Реплики должны быть по-настоящему смешными и звучать как живая устная речь, " +
      "без канцелярита и без объяснения шутки.",
  ].filter(Boolean);

  let response;
  try {
    response = await ai.models.generateContent({
      model: model || process.env.GEMINI_TEXT_MODEL || DEFAULT_TEXT_MODEL,
      contents: parts.join("\n\n"),
      config: { responseMimeType: "application/json", responseSchema: SCHEMA },
    });
  } catch (error) {
    throw new Error(explainApiError(error, apiKey));
  }

  const raw = response.text;
  if (!raw) throw new Error("Gemini вернул пустой ответ.");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Gemini вернул не JSON — попробуйте ещё раз.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Gemini не предложил ни одной идеи.");
  }
  return parsed;
}
