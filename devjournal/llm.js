require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");
const OpenAI = require("openai");

const PROVIDER = (process.env.LLM_PROVIDER || "gemini").toLowerCase();

// --- Client Initializations ---
let geminiClient = null;
let deepseekClient = null;

if (process.env.GEMINI_API_KEY) {
  geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

if (process.env.DEEPSEEK_API_KEY) {
  deepseekClient = new OpenAI({
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY,
  });
}

function cleanAndParseJSON(rawText) {
  let cleaned = rawText.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned
      .replace(/^```json/, "")
      .replace(/```$/, "")
      .trim();
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```/, "").replace(/```$/, "").trim();
  }
  return JSON.parse(cleaned);
}

// ============================================================
// 1. GENERATE SEARCH PARAMS
// ============================================================

async function generateSearchParams(
  query,
  availableEnvironments,
  availableSeverities,
  availableTags,
) {
  const systemPrompt = `You are an AI search query parser for a Quantitative Developer Troubleshooting Diary (TraceDiary).
Convert the user's natural language diagnostic query into a structured JSON filter object.

Available Environments: ${JSON.stringify(availableEnvironments)}
Available Severities: ${JSON.stringify(availableSeverities)}
Available Tags: ${JSON.stringify(availableTags)}

Expected Output Schema:
{
  "environments": string[],
  "severities": string[],
  "tags": string[],
  "keywords": string
}

Rules:
- Infer environment from runtime names (e.g., "EA" or "MetaTrader" -> "MQL5"; "Pandas" or "Polars" -> "Data Pipeline").
- Infer severity: "urgent" or "crash" -> ["Critical", "High"].
- Return ONLY valid JSON adhering strictly to the schema.`;

  let parsed = null;

  if (PROVIDER === "deepseek") {
    if (!deepseekClient) throw new Error("DEEPSEEK_API_KEY is not configured.");
    const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

    const completion = await deepseekClient.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `User Query: "${query}"` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    parsed = cleanAndParseJSON(completion.choices[0].message.content);
  } else {
    // Default: Gemini
    if (!geminiClient) throw new Error("GEMINI_API_KEY is not configured.");
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    const response = await geminiClient.models.generateContent({
      model,
      contents: `${systemPrompt}\n\nUser Query: "${query}"`,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            environments: { type: "array", items: { type: "string" } },
            severities: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
            keywords: { type: "string" },
          },
          required: ["environments", "severities", "tags", "keywords"],
        },
      },
    });

    parsed = cleanAndParseJSON(response.text);
  }

  return {
    environments: Array.isArray(parsed.environments) ? parsed.environments : [],
    severities: Array.isArray(parsed.severities) ? parsed.severities : [],
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    keywords: typeof parsed.keywords === "string" ? parsed.keywords : "",
  };
}

// ============================================================
// 2. PARSE CRASH LOG TO ENTRY
// ============================================================

async function parseCrashLogToEntry(rawLogText, availableEnvironments) {
  const envNames = availableEnvironments.map((e) => e.name);

  const systemPrompt = `You are an automated triage assistant for algorithmic trading systems.
Analyze the user's raw crash log, terminal output, or diagnostic notes, and extract a structured entry.

Available Environments: ${JSON.stringify(envNames)}

Expected Output Schema:
{
  "environmentName": string,
  "title": string,
  "symptom": string,
  "rootCause": string,
  "fix": string,
  "lesson": string,
  "severity": "Critical" | "High" | "Medium" | "Low",
  "tags": string[]
}

Rules:
- "environmentName" must strictly match one from the Available Environments list.
- Return ONLY valid JSON adhering strictly to the schema.`;

  let parsed = null;

  if (PROVIDER === "deepseek") {
    if (!deepseekClient) throw new Error("DEEPSEEK_API_KEY is not configured.");
    const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

    const completion = await deepseekClient.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Raw Log Text:\n${rawLogText}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    parsed = cleanAndParseJSON(completion.choices[0].message.content);
  } else {
    // Default: Gemini
    if (!geminiClient) throw new Error("GEMINI_API_KEY is not configured.");
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    const response = await geminiClient.models.generateContent({
      model,
      contents: `${systemPrompt}\n\nRaw Log Text:\n${rawLogText}`,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            environmentName: { type: "string" },
            title: { type: "string" },
            symptom: { type: "string" },
            rootCause: { type: "string" },
            fix: { type: "string" },
            lesson: { type: "string" },
            severity: {
              type: "string",
              enum: ["Critical", "High", "Medium", "Low"],
            },
            tags: { type: "array", items: { type: "string" } },
          },
          required: [
            "environmentName",
            "title",
            "symptom",
            "rootCause",
            "fix",
            "lesson",
            "severity",
            "tags",
          ],
        },
      },
    });

    parsed = cleanAndParseJSON(response.text);
  }

  return {
    environmentName: parsed.environmentName || envNames[0] || "Data Pipeline",
    title: parsed.title || "Unclassified Runtime Error",
    symptom: parsed.symptom || rawLogText.slice(0, 150),
    rootCause: parsed.rootCause || "Root cause under active investigation.",
    fix: parsed.fix || "Review system logs and error codes.",
    lesson:
      parsed.lesson || "Implement defensive error handling around boundaries.",
    severity: ["Critical", "High", "Medium", "Low"].includes(parsed.severity)
      ? parsed.severity
      : "High",
    tags:
      Array.isArray(parsed.tags) && parsed.tags.length > 0
        ? parsed.tags.map((t) => String(t).toLowerCase())
        : ["system-log"],
  };
}

module.exports = {
  PROVIDER,
  generateSearchParams,
  parseCrashLogToEntry,
};
