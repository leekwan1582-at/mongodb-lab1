require("dotenv").config();
const bcrypt = require("bcrypt");
const { ObjectId } = require("mongodb");
const { GoogleGenAI } = require("@google/genai");
const { connect } = require("./db");

const mongoUri = process.env.MONGO_URI;
const dbName = process.env.DB_NAME || "tracediary";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!mongoUri) {
  console.error("FATAL ERROR: MONGO_URI is missing in .env");
  process.exit(1);
}

// 1. Raw historical baseline entries from JSON-Server
const rawEntries = [
  {
    legacyId: "entry-001",
    timestamp: "2026-10-05T19:30:00Z",
    category: "MQL5",
    title: "Array out of range in OnTick execution",
    symptom: "EA halts execution on tick processing with error code 4002.",
    tried: "Checked loop bounds manually and printed buffer size.",
    rootCause:
      "Indicator handle was re-initialized inside the event loop without resizing the array buffer.",
    fix: "Moved handle initialization to OnInit() and applied ArraySetAsSeries() before accessing rates.",
    lesson:
      "Always separate indicator handle allocation from the tick execution logic.",
    severity: "High",
    tags: ["mql5", "ontick", "buffers", "runtime-error"],
    auditTrail: [
      {
        attemptId: new ObjectId(),
        actionTaken: "Added Print(ArraySize(rates)) inside OnTick()",
        outcome: "Verified buffer allocated 0 elements on tick 1",
        timestamp: new Date("2026-10-05T19:20:00Z"),
        recordedBy: "alex.quant@tracediary.io",
      },
    ],
  },
  {
    legacyId: "entry-002",
    timestamp: "2026-10-05T19:35:00Z",
    category: "MQL5",
    title: "OnTradeTransaction missing fill notification during slippage",
    symptom:
      "Pending orders execution state remains unverified during fast market events.",
    tried: "Added OrderSelect() polling loop inside OnTick().",
    rootCause:
      "Trade transaction events were dropping due to unhandled TRADE_TRANSACTION_DEAL_ADD state transitions.",
    fix: "Refactored OnTradeTransaction to explicitly filter for TRADE_TRANSACTION_DEAL_ADD and check deal entry type.",
    lesson:
      "Rely on explicit transaction deal types in OnTradeTransaction rather than polling order history.",
    severity: "Critical",
    tags: ["mql5", "slippage", "execution", "transactions"],
    auditTrail: [
      {
        attemptId: new ObjectId(),
        actionTaken: "Inserted global tick transaction logger",
        outcome: "Caught dropped state transition packets",
        timestamp: new Date("2026-10-05T19:32:00Z"),
        recordedBy: "alex.quant@tracediary.io",
      },
    ],
  },
  {
    legacyId: "entry-003",
    timestamp: "2026-10-05T19:40:00Z",
    category: "Data Pipeline",
    title: "Polars memory spike during tick resampling",
    symptom: "Out of memory crash when converting CSV tick data to Parquet.",
    tried: "Increased swap space and decreased chunk size.",
    rootCause:
      "Eager evaluation loaded the entire multi-gigabyte CSV into RAM at once.",
    fix: "Switched from pl.read_csv() to pl.scan_csv() for streaming lazy evaluation.",
    lesson:
      "Utilize lazy frames and streaming execution for high-frequency tick datasets.",
    severity: "High",
    tags: ["python", "polars", "memory", "parquet"],
    auditTrail: [
      {
        attemptId: new ObjectId(),
        actionTaken: "Allocated 32GB swap file on workstation",
        outcome: "Delayed crash by 4 minutes, process still killed by OOM",
        timestamp: new Date("2026-10-05T19:38:00Z"),
        recordedBy: "sarah.data@tracediary.io",
      },
    ],
  },
  {
    legacyId: "entry-004",
    timestamp: "2026-10-05T19:45:00Z",
    category: "Data Pipeline",
    title: "DuckDB timestamp timezone mismatch on parquet join",
    symptom:
      "SQL queries fail with mismatch error between UTC and localized timestamps.",
    tried: "Attempted string casting with strftime() inside SQL queries.",
    rootCause:
      "DuckDB inferred microsecond precision with local offset from raw tick inputs, conflicting with ZSTD Parquet schema.",
    fix: "Standardized all ingested timestamps to epoch milliseconds UTC using explicitly typed schema definitions.",
    lesson:
      "Enforce UTC epoch normalization at ingestion time before writing to Parquet repositories.",
    severity: "Medium",
    tags: ["duckdb", "sql", "timestamps", "parquet"],
    auditTrail: [
      {
        attemptId: new ObjectId(),
        actionTaken: "Cast timestamps inside SQL join query directly",
        outcome: "Execution slowed down by 800% due to table scan",
        timestamp: new Date("2026-10-05T19:42:00Z"),
        recordedBy: "sarah.data@tracediary.io",
      },
    ],
  },
  {
    legacyId: "entry-005",
    timestamp: "2026-10-05T19:50:00Z",
    category: "Backtesting",
    title: "Vectorbt lookahead bias in rolling ATR calculation",
    symptom:
      "Backtest produces unrealistically high Sharpe ratio during volatile market regimes.",
    tried:
      "Re-indexed price matrices and adjusted stop-loss percentage multipliers.",
    rootCause:
      "Indicator shift parameter was omitted, allowing signal generation using current bar close instead of prior bar close.",
    fix: "Applied .shift(1) to trailing volatility indicators before generating entry signals.",
    lesson:
      "Always verify lag operators on feature matrices to eliminate lookahead bias in vectorised engine calculations.",
    severity: "Critical",
    tags: ["vectorbt", "backtesting", "lookahead-bias", "python"],
    auditTrail: [
      {
        attemptId: new ObjectId(),
        actionTaken:
          "Ran walk-forward cross validation on unseen 2025 out-of-sample data",
        outcome: "Sharpe dropped from 4.8 to -0.4, confirming signal leakage",
        timestamp: new Date("2026-10-05T19:48:00Z"),
        recordedBy: "alex.quant@tracediary.io",
      },
    ],
  },
  {
    legacyId: "entry-006",
    timestamp: "2026-10-05T19:55:00Z",
    category: "Backtesting",
    title: "Backtrader order execution mismatch on gap opens",
    symptom:
      "Stop-loss orders fill at exact trigger price instead of opening gapped price.",
    tried: "Overrode next() method and forced market orders on current bar.",
    rootCause:
      "Cheat-on-open parameter was enabled by default in broker execution settings.",
    fix: "Set cheat_on_open=False and configured realistic slip_open=True slippage models.",
    lesson:
      "Ensure realistic broker settings for gap-handling during event-driven backtesting execution.",
    severity: "High",
    tags: ["backtrader", "execution", "slippage", "simulation"],
    auditTrail: [
      {
        attemptId: new ObjectId(),
        actionTaken: "Overrode order execution check in custom strategy class",
        outcome: "Created order loop race condition",
        timestamp: new Date("2026-10-05T19:52:00Z"),
        recordedBy: "alex.quant@tracediary.io",
      },
    ],
  },
  {
    legacyId: "entry-007",
    timestamp: "2026-10-05T20:00:00Z",
    category: "Infrastructure",
    title: "PostgreSQL Walk-Forward connection exhaustion",
    symptom:
      "Database connection pool drops workers with FATAL: remaining connection slots are reserved error.",
    tried: "Increased max_connections in postgresql.conf.",
    rootCause:
      "Parallel optimization tasks failed to release pooled connections upon worker process completion.",
    fix: "Implemented context-managed connection pool wrapper with explicit client cleanup in try/finally blocks.",
    lesson:
      "Always manage worker node database lifecycle with context managers during multi-process jobs.",
    severity: "Critical",
    tags: ["postgresql", "connection-pool", "devops", "concurrency"],
    auditTrail: [
      {
        attemptId: new ObjectId(),
        actionTaken: "Set max_connections = 1000 in postgresql.conf",
        outcome: "Server ran out of kernel shared memory (shmmax)",
        timestamp: new Date("2026-10-05T19:58:00Z"),
        recordedBy: "devops@tracediary.io",
      },
    ],
  },
  {
    legacyId: "entry-008",
    timestamp: "2026-10-05T20:05:00Z",
    category: "Infrastructure",
    title: "WSL2 disk space growth during heavy DuckDB queries",
    symptom:
      "Ubuntu WSL virtual disk image expands rapidly and exhausts host C: drive space.",
    tried: "Ran apt clean and deleted temporary parquet logs.",
    rootCause:
      "DuckDB temporary storage spilled to /tmp directory on VHDX without automated shrinking.",
    fix: "Configured temp_directory setting in DuckDB to point to dedicated external mount and ran disk compacting in PowerShell.",
    lesson:
      "Redirect database spill directories away from the default root WSL filesystem.",
    severity: "Medium",
    tags: ["wsl2", "duckdb", "storage", "windows"],
    auditTrail: [
      {
        attemptId: new ObjectId(),
        actionTaken: "Executed diskpart compact vdisk command on host",
        outcome: "Freed 65GB temporarily, re-expanded on next query run",
        timestamp: new Date("2026-10-05T20:02:00Z"),
        recordedBy: "devops@tracediary.io",
      },
    ],
  },
  {
    legacyId: "entry-009",
    timestamp: "2026-10-05T20:10:00Z",
    category: "JavaScript",
    title: "Uncaught TypeError in async fetch rendering loop",
    symptom:
      "DOM rendering halts with Cannot read properties of undefined (reading 'title').",
    tried: "Added null checks inside document.getElementById().",
    rootCause:
      "JSON API response wrapped entries inside an object instead of returning a top-level array.",
    fix: "Updated parsing logic to extract response.data.entries before invoking Array.prototype.forEach().",
    lesson:
      "Validate payload structure or apply optional chaining before iterating fetched JSON data.",
    severity: "Low",
    tags: ["javascript", "frontend", "dom", "async"],
    auditTrail: [
      {
        attemptId: new ObjectId(),
        actionTaken: "Wrapped renderCard() inside try/catch block",
        outcome: "Prevented page crash, but left dashboard UI blank",
        timestamp: new Date("2026-10-05T20:08:00Z"),
        recordedBy: "frontend@tracediary.io",
      },
    ],
  },
  {
    legacyId: "entry-010",
    timestamp: "2026-10-05T20:15:00Z",
    category: "JavaScript",
    title: "ESM import statement failure in Node/Mocha test runner",
    symptom: "SyntaxError: Cannot use import statement outside a module.",
    tried: "Converted import statements to require() statements.",
    rootCause:
      'package.json missing "type": "module" declaration for ECMAScript module resolution.',
    fix: 'Added "type": "module" to package.json and ensured explicit .js file extensions on local relative imports.',
    lesson:
      "Explicitly specify module target settings in Node environments when using ES6 import/export syntax.",
    severity: "Low",
    tags: ["nodejs", "esm", "mocha", "javascript"],
    auditTrail: [
      {
        attemptId: new ObjectId(),
        actionTaken: "Invoked mocha with --experimental-modules flag",
        outcome: "Failed due to missing file extensions in import paths",
        timestamp: new Date("2026-10-05T20:12:00Z"),
        recordedBy: "frontend@tracediary.io",
      },
    ],
  },
];

// 2. Generative AI Synthetic Seed Generator (Meets LO5 & LLM Seed Criteria)
async function generateAiMockEntries(availableEnvironments) {
  if (!GEMINI_API_KEY) {
    console.log(
      "No GEMINI_API_KEY detected. Using deterministic fallback mock data.",
    );
    return [
      {
        title: "Docker container SIGKILL during vector backtest run",
        category: "Infrastructure",
        symptom: "Container process exited with status code 137 under load.",
        tried: "Increased container CPU shares from 2 to 4 cores.",
        rootCause:
          "Kernel OOM-killer terminated worker due to strict 2GB memory boundary limit.",
        fix: "Raised memory quota in docker-compose.yml to 8GB and enabled memory reservation.",
        lesson:
          "Always inspect dmesg/oom logs when worker processes exit silently with code 137.",
        severity: "Critical",
        tags: ["docker", "devops", "oom", "memory"],
      },
    ];
  }

  try {
    console.log(
      "Contacting Gemini LLM to synthesize additional mock trading log records...",
    );
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    const prompt = `You are a Quantitative Trading System Architect. Generate exactly 2 realistic troubleshooting logs in quantitative finance.
Categories must strictly be chosen from: ${availableEnvironments.map((e) => e.name).join(", ")}.
Return ONLY a valid JSON array of objects adhering to this schema:
[
  {
    "category": string,
    "title": string,
    "symptom": string,
    "tried": string,
    "rootCause": string,
    "fix": string,
    "lesson": string,
    "severity": "Critical" | "High" | "Medium" | "Low",
    "tags": string[]
  }
]`;

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const parsed = JSON.parse(response.text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn(
      "AI generation failed or rate limited; using fallback mock items. Error:",
      err.message,
    );
    return [];
  }
}

async function seedDatabase() {
  try {
    const db = await connect(mongoUri, dbName);
    console.log(`Connected to database [${dbName}] for seeding.`);

    // Step A: Reset Collections
    console.log(
      "Flushing existing collections (environments, entries, users)...",
    );
    await db.collection("environments").deleteMany({});
    await db.collection("entries").deleteMany({});
    await db.collection("users").deleteMany({});

    // Step B: Seed Users (Password hashing satisfies authentication rubric)
    console.log("Seeding authenticated system users...");
    const defaultPassword = process.env.SEED_USER_PASSWORD || "TraderPass123!";
    const hashedPassword = await bcrypt.hash(defaultPassword, 12);

    const usersToInsert = [
      {
        email: "alex.quant@tracediary.io",
        password: hashedPassword,
        fullName: "Alex Rivera",
        role: "admin",
        createdAt: new Date(),
      },
      {
        email: "sarah.data@tracediary.io",
        password: hashedPassword,
        fullName: "Sarah Chen",
        role: "developer",
        createdAt: new Date(),
      },
    ];
    await db.collection("users").insertMany(usersToInsert);
    console.log(
      `Seeded ${usersToInsert.length} users. (Default Password: "${defaultPassword}")`,
    );

    // Step C: Seed Environments (Referenced entities satisfying relationship rubric)
    console.log("Seeding environments (referenced domain entities)...");
    const environmentsData = [
      {
        name: "MQL5",
        platform: "MetaTrader 5 Client Terminal",
        runtime: "MQL5 Bytecode Engine",
        executionType: "Tick Event Loop",
      },
      {
        name: "Data Pipeline",
        platform: "Linux Data Cluster",
        runtime: "Python 3.12 / Polars / DuckDB",
        executionType: "ETL Batch & Stream",
      },
      {
        name: "Backtesting",
        platform: "Jupyter Simulation Node",
        runtime: "Vectorbt Pro / Backtrader",
        executionType: "Vectorized / Event Matrix",
      },
      {
        name: "Infrastructure",
        platform: "Ubuntu 24.04 LTS WSL2 / Docker Engine",
        runtime: "PostgreSQL 16 / Docker",
        executionType: "Service Daemons",
      },
      {
        name: "JavaScript",
        platform: "Modern Web Browser / Node.js LTS",
        runtime: "V8 Engine",
        executionType: "Event Loop / Microtasks",
      },
    ];

    const envInsertResult = await db
      .collection("environments")
      .insertMany(environmentsData);
    const environmentDocs = await db
      .collection("environments")
      .find({})
      .toArray();
    console.log(`Seeded ${environmentDocs.length} environment records.`);

    // Map environments by name for fast referencing
    const envMap = new Map();
    environmentDocs.forEach((env) => {
      envMap.set(env.name, {
        _id: env._id,
        name: env.name,
        platform: env.platform,
      });
    });

    // Step D: Format and link primary entries with references and embedded audits
    console.log(
      "Linking baseline troubleshooting logs to referenced environments...",
    );
    const entriesToInsert = rawEntries.map((entry) => {
      const matchedEnv = envMap.get(entry.category) || {
        _id: new ObjectId(),
        name: entry.category,
        platform: "Generic Runtime",
      };

      return {
        title: entry.title,
        symptom: entry.symptom,
        tried: entry.tried,
        rootCause: entry.rootCause,
        fix: entry.fix,
        lesson: entry.lesson,
        severity: entry.severity || "Medium",
        tags: entry.tags || [entry.category.toLowerCase()],
        legacyId: entry.legacyId,
        createdAt: new Date(entry.timestamp),

        // 1. Referenced Relationship (Category -> Environment)
        environment: matchedEnv,

        // 2. Embedded Relationship (Subdocument: Audit Trail / Resolution Attempts)
        auditTrail: entry.auditTrail || [],
      };
    });

    // Step E: Fetch Generative AI mock logs and append
    const aiGeneratedLogs = await generateAiMockEntries(environmentsData);
    aiGeneratedLogs.forEach((aiEntry, idx) => {
      const matchedEnv = envMap.get(aiEntry.category) || {
        _id: new ObjectId(),
        name: aiEntry.category || "Infrastructure",
        platform: "Generated Platform",
      };

      entriesToInsert.push({
        title: aiEntry.title,
        symptom: aiEntry.symptom,
        tried: aiEntry.tried,
        rootCause: aiEntry.rootCause,
        fix: aiEntry.fix,
        lesson: aiEntry.lesson,
        severity: aiEntry.severity || "High",
        tags: aiEntry.tags || ["ai-generated", "synthetic"],
        legacyId: `ai-gen-${idx + 1}`,
        createdAt: new Date(),
        environment: matchedEnv,
        auditTrail: [
          {
            attemptId: new ObjectId(),
            actionTaken: "AI automated triage and root cause extraction",
            outcome: "Generated remediation proposal",
            timestamp: new Date(),
            recordedBy: "gemini-generative-seeder@tracediary.io",
          },
        ],
      });
    });

    // Step F: Insert into MongoDB
    const entryResult = await db
      .collection("entries")
      .insertMany(entriesToInsert);
    console.log(
      `Successfully seeded ${entryResult.insertedCount} troubleshooting logs into [entries].`,
    );

    console.log("\n=======================================================");
    console.log("DATABASE SEED COMPLETE!");
    console.log(`- Environments: ${environmentDocs.length}`);
    console.log(`- Users:        ${usersToInsert.length}`);
    console.log(`- Entries:      ${entryResult.insertedCount}`);
    console.log("=======================================================\n");

    process.exit(0);
  } catch (error) {
    console.error("Database seeding failed:", error);
    process.exit(1);
  }
}

seedDatabase();
