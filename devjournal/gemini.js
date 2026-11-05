require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("WARNING: GEMINI_API_KEY is not defined in .env");
}

const ai = new GoogleGenAI({ apiKey });
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

/**
 * Converts a natural language query into structured MongoDB search filters.
 */
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

Rules:
- "environments": Array of matching environment names from the available list (OR logic). Infer from runtime names (e.g., "EA" or "MetaTrader" implies "MQL5"; "Pandas" or "Polars" implies "Data Pipeline").
- "severities": Array of matching severity values ("Critical", "High", "Medium", "Low") from the available list (OR logic). Infer "urgent" or "crash" as "Critical" or "High".
- "tags": Array of strings matching known tags or technical keywords from the query.
- "keywords": General search terms to match against title or symptoms (empty string if none).
- Return ONLY valid JSON adhering strictly to the schema. No markdown formatting or extra text.`;

  const response = await ai.models.generateContent({
    model: MODEL,
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

  return JSON.parse(response.text);
}

/**
 * Parses raw terminal error logs, stack traces, or developer notes into a structured log entry.
 */
async function parseCrashLogToEntry(rawLogText, availableEnvironments) {
  const envNames = availableEnvironments.map((e) => e.name);

  const systemPrompt = `You are an automated triage assistant for algorithmic trading systems.
Analyze the user's raw crash log, terminal output, or diagnostic notes, and extract a structured entry.

Available Environments: ${JSON.stringify(envNames)}

Rules:
- "environmentName": Must match one from the available list that best fits the runtime/stack trace.
- "title": Concise, descriptive summary of the technical bug.
- "symptom": Observable failure, error codes, or crash symptoms.
- "rootCause": Inferred or stated underlying engineering flaw.
- "fix": Recommended or applied remediation steps.
- "lesson": Architectural take-away or best practice guideline.
- "severity": Must be one of: "Critical", "High", "Medium", "Low".
- "tags": 3 to 5 lowercase technical tags (e.g., "mql5", "memory", "parquet", "deadlock").
- Return ONLY valid JSON adhering to the schema.`;

  const response = await ai.models.generateContent({
    model: MODEL,
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

  return JSON.parse(response.text);
}

module.exports = {
  ai,
  MODEL,
  generateSearchParams,
  parseCrashLogToEntry,
};
