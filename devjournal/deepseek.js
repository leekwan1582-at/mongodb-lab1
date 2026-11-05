require("dotenv").config();
const OpenAI = require("openai");

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.warn("WARNING: DEEPSEEK_API_KEY is not defined in .env");
}

const openai = new OpenAI({
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  apiKey: apiKey,
});

const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

/**
 * Helper to strip markdown fences (```json ... ```) before JSON.parse
 */
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

Expected Output Schema:
{
  "environments": string[], // Subset of Available Environments (OR logic)
  "severities": string[],   // Subset of ["Critical", "High", "Medium", "Low"] (OR logic)
  "tags": string[],         // Matching technical tags (OR logic)
  "keywords": string        // General search terms to match title/symptom (empty string if none)
}

Rules:
- Infer environment from runtime names (e.g., "EA" or "MetaTrader" -> "MQL5"; "Pandas" or "Polars" -> "Data Pipeline").
- Infer severity: "urgent" or "crash" -> ["Critical", "High"].
- If no specific filters apply for a field, return an empty array [] or empty string "".
- Return ONLY valid JSON matching the schema. Do not include markdown codeblocks or conversational text.`;

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `User Query: "${query}"` },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });

  const content = completion.choices[0].message.content;
  const parsed = cleanAndParseJSON(content);

  return {
    environments: Array.isArray(parsed.environments) ? parsed.environments : [],
    severities: Array.isArray(parsed.severities) ? parsed.severities : [],
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    keywords: typeof parsed.keywords === "string" ? parsed.keywords : "",
  };
}

/**
 * Parses raw terminal error logs, stack traces, or developer notes into a structured log entry.
 */
async function parseCrashLogToEntry(rawLogText, availableEnvironments) {
  const envNames = availableEnvironments.map((e) => e.name);

  const systemPrompt = `You are an automated triage assistant for algorithmic trading systems.
Analyze the user's raw crash log, terminal output, or diagnostic notes, and extract a structured entry.

Available Environments: ${JSON.stringify(envNames)}

Expected Output Schema:
{
  "environmentName": string, // EXACT match from Available Environments list
  "title": string,           // Concise summary of the technical bug (under 12 words)
  "symptom": string,         // Observable failure, error codes, or crash symptoms
  "rootCause": string,       // Inferred or stated underlying engineering flaw
  "fix": string,             // Recommended or applied remediation steps
  "lesson": string,          // Architectural take-away or best practice guideline
  "severity": string,        // Must be one of: "Critical", "High", "Medium", "Low"
  "tags": string[]           // 3 to 5 lowercase technical tags (e.g., ["mql5", "memory", "parquet"])
}

Rules:
- "environmentName" must strictly be one of: ${JSON.stringify(envNames)}.
- Return ONLY valid JSON adhering strictly to the schema.`;

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Raw Log Text:\n${rawLogText}` },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const content = completion.choices[0].message.content;
  const parsed = cleanAndParseJSON(content);

  return {
    environmentName: parsed.environmentName || envNames[0] || "Data Pipeline",
    title: parsed.title || "Unclassified Runtime Incident",
    symptom: parsed.symptom || rawLogText.slice(0, 150),
    rootCause:
      parsed.rootCause || "Underlying cause under active investigation.",
    fix: parsed.fix || "Review system logs and parameter bounds.",
    lesson:
      parsed.lesson ||
      "Ensure defensive validation around external dependencies.",
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
  openai,
  MODEL,
  generateSearchParams,
  parseCrashLogToEntry,
};
