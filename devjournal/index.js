const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { ObjectId } = require("mongodb");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { connect } = require("./db"); 
const { generateSearchParams, parseCrashLogToEntry } = require("./gemini");

const mongoUri = process.env.MONGO_URI;
const dbName = process.env.DB_NAME || "tracediary";
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "localhost";
const TOKEN_SECRET = process.env.TOKEN_SECRET;

if (!mongoUri) {
  console.error("FATAL ERROR: MONGO_URI is not defined in .env");
  process.exit(1);
}

if (!TOKEN_SECRET) {
  console.error("FATAL ERROR: TOKEN_SECRET is not defined in .env");
  process.exit(1);
}

// JWT Token Generation Helper[cite: 1]
const generateAccessToken = (id, email, role) => {
  return jwt.sign({ user_id: id, email, role }, TOKEN_SECRET, {
    expiresIn: "2h",
  });
};

// JWT Verification Middleware[cite: 1]
const verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  jwt.verify(token, TOKEN_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token" });
    }
    req.user = user;
    next();
  });
};

const app = express();

app.use(express.json());
app.use(cors());

// Health Check
app.get("/", (req, res) => {
  res.json({
    message: "TraceDiary RESTful API is live",
    database: dbName,
    docs: "/entries",
  });
});

async function main() {
  try {
    const db = await connect(mongoUri, dbName);
    console.log(`Connected to MongoDB: ${dbName}`);

    // ==========================================
    // 1. AUTHENTICATION & USERS
    // ==========================================

    // Register User (Password Hashing via bcrypt)
    app.post("/users", async (req, res) => {
      try {
        const { email, password, fullName } = req.body;
        if (!email || !password) {
          return res
            .status(400)
            .json({ error: "Email and password are required" });
        }

        const existingUser = await db.collection("users").findOne({ email });
        if (existingUser) {
          return res
            .status(400)
            .json({ error: "User already exists with this email" });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const result = await db.collection("users").insertOne({
          email,
          password: hashedPassword,
          fullName: fullName || email.split("@")[0],
          role: "developer",
          createdAt: new Date(),
        });

        res.status(201).json({
          message: "User registered successfully",
          userId: result.insertedId,
        });
      } catch (error) {
        console.error("Error creating user:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Login User (JWT Issue)
    app.post("/login", async (req, res) => {
      try {
        const { email, password } = req.body;
        if (!email || !password) {
          return res
            .status(400)
            .json({ error: "Email and password are required" });
        }

        const user = await db.collection("users").findOne({ email });
        if (!user) {
          return res.status(401).json({ error: "Invalid email or password" });
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
          return res.status(401).json({ error: "Invalid email or password" });
        }

        const accessToken = generateAccessToken(
          user._id,
          user.email,
          user.role,
        );
        res.json({
          message: "Login successful",
          accessToken,
          user: {
            id: user._id,
            email: user.email,
            role: user.role,
          },
        });
      } catch (error) {
        console.error("Error logging in:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Protected Current User Route
    app.get("/profile", verifyToken, async (req, res) => {
      res.json({
        message: "Protected user profile retrieved successfully",
        user: req.user,
      });
    });

    // ==========================================
    // 2. REFERENCED ENTITIES (Environments)
    // ==========================================
    app.get("/environments", async (req, res) => {
      try {
        const environments = await db
          .collection("environments")
          .find({})
          .toArray();
        res.json({ environments });
      } catch (error) {
        console.error("Error fetching environments:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // ==========================================
    // 3. MAIN RESOURCE CRUD (Entries)[cite: 8, 9]
    // ==========================================

    // Read All & Search with Query Parameters[cite: 1, 9]
    app.get("/entries", async (req, res) => {
      try {
        const { environment, severity, tag, q } = req.query;
        const query = {};

        if (environment) {
          query["environment.name"] = { $regex: environment, $options: "i" };
        }
        if (severity) {
          query.severity = { $regex: `^${severity}$`, $options: "i" };
        }
        if (tag) {
          query.tags = {
            $in: tag.split(",").map((t) => t.trim().toLowerCase()),
          };
        }
        if (q) {
          query.$or = [
            { title: { $regex: q, $options: "i" } },
            { symptom: { $regex: q, $options: "i" } },
            { rootCause: { $regex: q, $options: "i" } },
            { fix: { $regex: q, $options: "i" } },
          ];
        }

        const entries = await db
          .collection("entries")
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.json({ count: entries.length, entries });
      } catch (error) {
        console.error("Error fetching entries:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Read Single Entry by ID[cite: 1, 9]
    app.get("/entries/:id", async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid ObjectId format" });
        }

        const entry = await db
          .collection("entries")
          .findOne({ _id: new ObjectId(id) });
        if (!entry) {
          return res
            .status(404)
            .json({ error: "Troubleshooting entry not found" });
        }

        res.json(entry);
      } catch (error) {
        console.error("Error fetching entry:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Create New Entry (Protected with verifyToken)
    app.post("/entries", verifyToken, async (req, res) => {
      try {
        const {
          title,
          symptom,
          tried,
          rootCause,
          fix,
          lesson,
          severity,
          tags,
          environmentName,
        } = req.body;

        if (!title || !symptom || !rootCause || !fix || !environmentName) {
          return res.status(400).json({
            error:
              "Missing required fields: title, symptom, rootCause, fix, environmentName",
          });
        }

        // Validate referenced environment document[cite: 1, 9]
        const envDoc = await db.collection("environments").findOne({
          name: { $regex: `^${environmentName}$`, $options: "i" },
        });

        if (!envDoc) {
          return res
            .status(400)
            .json({ error: `Environment '${environmentName}' does not exist` });
        }

        const newEntry = {
          title,
          symptom,
          tried: tried || "",
          rootCause,
          fix,
          lesson: lesson || "",
          severity: severity || "Medium",
          tags: Array.isArray(tags) ? tags.map((t) => t.toLowerCase()) : [],
          createdAt: new Date(),
          environment: {
            _id: envDoc._id,
            name: envDoc.name,
            platform: envDoc.platform,
          },
          auditTrail: [
            {
              attemptId: new ObjectId(),
              actionTaken: "Initial incident recorded",
              outcome: "Logged for investigation",
              timestamp: new Date(),
              recordedBy: req.user.email,
            },
          ],
        };

        const result = await db.collection("entries").insertOne(newEntry);
        res.status(201).json({
          message: "Troubleshooting entry created successfully",
          entryId: result.insertedId,
        });
      } catch (error) {
        console.error("Error creating entry:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Update Entry by ID (Protected)[cite: 1, 9]
    app.put("/entries/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid ObjectId format" });
        }

        const {
          title,
          symptom,
          tried,
          rootCause,
          fix,
          lesson,
          severity,
          tags,
          environmentName,
        } = req.body;

        const updateFields = {
          updatedAt: new Date(),
        };

        if (title) updateFields.title = title;
        if (symptom) updateFields.symptom = symptom;
        if (tried !== undefined) updateFields.tried = tried;
        if (rootCause) updateFields.rootCause = rootCause;
        if (fix) updateFields.fix = fix;
        if (lesson !== undefined) updateFields.lesson = lesson;
        if (severity) updateFields.severity = severity;
        if (tags) updateFields.tags = tags.map((t) => t.toLowerCase());

        // Validate environment change if provided[cite: 1, 9]
        if (environmentName) {
          const envDoc = await db.collection("environments").findOne({
            name: { $regex: `^${environmentName}$`, $options: "i" },
          });
          if (!envDoc) {
            return res
              .status(400)
              .json({ error: `Environment '${environmentName}' not found` });
          }
          updateFields.environment = {
            _id: envDoc._id,
            name: envDoc.name,
            platform: envDoc.platform,
          };
        }

        const result = await db
          .collection("entries")
          .updateOne({ _id: new ObjectId(id) }, { $set: updateFields });

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: "Entry not found" });
        }

        res.json({ message: "Entry updated successfully" });
      } catch (error) {
        console.error("Error updating entry:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Delete Entry by ID (Protected)[cite: 1, 9]
    app.delete("/entries/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid ObjectId format" });
        }

        const result = await db
          .collection("entries")
          .deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) {
          return res.status(404).json({ error: "Entry not found" });
        }

        res.json({ message: "Entry deleted successfully" });
      } catch (error) {
        console.error("Error deleting entry:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // ==============================================================
    // 4. EMBEDDED SUBDOCUMENT CRUD (auditTrail inside entries)
    // ==============================================================

    // Add Audit Log Attempt to Entry[cite: 1, 9]
    app.post("/entries/:id/audits", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { actionTaken, outcome } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid entry ID" });
        }
        if (!actionTaken || !outcome) {
          return res
            .status(400)
            .json({ error: "actionTaken and outcome are required" });
        }

        const newAudit = {
          attemptId: new ObjectId(),
          actionTaken,
          outcome,
          timestamp: new Date(),
          recordedBy: req.user.email,
        };

        const result = await db
          .collection("entries")
          .updateOne(
            { _id: new ObjectId(id) },
            { $push: { auditTrail: newAudit } },
          );

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: "Entry not found" });
        }

        res.status(201).json({
          message: "Audit attempt appended successfully",
          audit: newAudit,
        });
      } catch (error) {
        console.error("Error pushing audit record:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Delete Specific Audit Attempt from Entry[cite: 1, 9]
    app.delete(
      "/entries/:id/audits/:attemptId",
      verifyToken,
      async (req, res) => {
        try {
          const { id, attemptId } = req.params;

          if (!ObjectId.isValid(id) || !ObjectId.isValid(attemptId)) {
            return res.status(400).json({ error: "Invalid ID parameters" });
          }

          const result = await db
            .collection("entries")
            .updateOne(
              { _id: new ObjectId(id) },
              { $pull: { auditTrail: { attemptId: new ObjectId(attemptId) } } },
            );

          if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Entry not found" });
          }
          if (result.modifiedCount === 0) {
            return res.status(404).json({ error: "Audit record not found" });
          }

          res.json({ message: "Audit attempt removed successfully" });
        } catch (error) {
          console.error("Error removing audit record:", error);
          res.status(500).json({ error: "Internal server error" });
        }
      },
    );

    // ==========================================
    // 5. GENERATIVE AI ENDPOINTS[cite: 1, 9]
    // ==========================================

    // AI Natural Language Search Query Translation[cite: 1, 9]
    app.get("/ai/entries", async (req, res) => {
      try {
        const { q } = req.query;
        if (!q) {
          return res
            .status(400)
            .json({ error: "Query parameter 'q' is required" });
        }

        const availableEnvironments = await db
          .collection("environments")
          .distinct("name");
        const availableSeverities = ["Critical", "High", "Medium", "Low"];
        const availableTags = await db.collection("entries").distinct("tags");

        const searchParams = await generateSearchParams(
          q,
          availableEnvironments,
          availableSeverities,
          availableTags,
        );

        const mongoCriteria = {};

        if (searchParams.environments && searchParams.environments.length > 0) {
          mongoCriteria["environment.name"] = {
            $in: searchParams.environments,
          };
        }

        if (searchParams.severities && searchParams.severities.length > 0) {
          mongoCriteria.severity = { $in: searchParams.severities };
        }

        if (searchParams.tags && searchParams.tags.length > 0) {
          mongoCriteria.tags = { $in: searchParams.tags };
        }

        if (searchParams.keywords && searchParams.keywords.trim() !== "") {
          mongoCriteria.$or = [
            { title: { $regex: searchParams.keywords, $options: "i" } },
            { symptom: { $regex: searchParams.keywords, $options: "i" } },
          ];
        }

        const entries = await db
          .collection("entries")
          .find(mongoCriteria)
          .toArray();

        res.json({
          query: q,
          inferredFilters: searchParams,
          resultsCount: entries.length,
          entries,
        });
      } catch (error) {
        console.error("AI Search Error:", error);
        res.status(500).json({ error: "AI search processing failed" });
      }
    });

    // AI Automated Log Triage & Structured Entry Generation[cite: 1, 9]
    app.post("/ai/entries", verifyToken, async (req, res) => {
      try {
        const { logText } = req.body;
        if (!logText) {
          return res
            .status(400)
            .json({ error: "Field 'logText' is required in request body" });
        }

        const environments = await db
          .collection("environments")
          .find({})
          .toArray();
        const parsedData = await parseCrashLogToEntry(logText, environments);

        const matchedEnv =
          environments.find(
            (e) =>
              e.name.toLowerCase() === parsedData.environmentName.toLowerCase(),
          ) || environments[0];

        const newEntry = {
          title: parsedData.title,
          symptom: parsedData.symptom,
          tried: "Automated stack trace parsed via Gemini LLM",
          rootCause: parsedData.rootCause,
          fix: parsedData.fix,
          lesson: parsedData.lesson,
          severity: parsedData.severity,
          tags: parsedData.tags.map((t) => t.toLowerCase()),
          createdAt: new Date(),
          environment: {
            _id: matchedEnv._id,
            name: matchedEnv.name,
            platform: matchedEnv.platform,
          },
          auditTrail: [
            {
              attemptId: new ObjectId(),
              actionTaken: "AI Diagnostic Analysis",
              outcome: "Extracted root cause and suggested remediation",
              timestamp: new Date(),
              recordedBy: req.user.email,
            },
          ],
        };

        const result = await db.collection("entries").insertOne(newEntry);

        res.status(201).json({
          message: "AI triage completed and troubleshooting log created",
          entryId: result.insertedId,
          entry: newEntry,
        });
      } catch (error) {
        console.error("AI Entry Creation Error:", error);
        res.status(500).json({ error: "Failed to parse log with AI" });
      }
    });

    // ==========================================
    // 6. GLOBAL ERROR HANDLER[cite: 1]
    // ==========================================
    app.use((err, req, res, next) => {
      console.error(err.stack);
      res.status(500).json({ error: "Something broke!" });
    });

    app.listen(PORT, HOST, () => {
      console.log(`TraceDiary server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start application:", err);
    process.exit(1);
  }
}

main();
