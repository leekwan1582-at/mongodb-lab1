// index.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { connect } = require("./db");
const { ObjectId } = require("mongodb");

const mongoUri = process.env.MONGO_URI;
const dbName = "recipe_book";
const PORT = process.env.PORT || 3000;

// Fail fast if required environment variables are missing.
if (!mongoUri) {
  console.error("FATAL ERROR: MONGO_URI is not defined in .env");
  process.exit(1);
}

if (!process.env.TOKEN_SECRET) {
  console.error("FATAL ERROR: TOKEN_SECRET is not defined in .env");
  process.exit(1);
}

// -----------------------------
// Gemini
// -----------------------------

const app = express();

// -----------------------------
// Middleware
// -----------------------------
app.use(express.json());
app.use(cors());

// -----------------------------
// Helpers
// -----------------------------
function generateAccessToken(id, email) {
  return jwt.sign(
    {
      user_id: id,
      email,
    },
    process.env.TOKEN_SECRET,
    { expiresIn: "1h" }
  );
}

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.TOKEN_SECRET, (error, user) => {
    if (error) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    req.user = user;
    next();
  });
}

function isValidObjectId(id) {
  return ObjectId.isValid(id);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function buildRecipeFromRequest(db, body) {
  const {
    name,
    cuisine,
    prepTime,
    cookTime,
    servings,
    ingredients,
    instructions,
    tags,
  } = body;

  if (!name || !cuisine || !ingredients || !instructions || !tags) {
    throw createHttpError(400, "Missing required fields");
  }

  if (!Array.isArray(tags) || tags.length === 0) {
    throw createHttpError(400, "Tags must be a non-empty array");
  }

  const cuisineDoc = await db.collection("cuisines").findOne({ name: cuisine });

  if (!cuisineDoc) {
    throw createHttpError(400, "Invalid cuisine");
  }

  const tagDocs = await db
    .collection("tags")
    .find({ name: { $in: tags } })
    .toArray();

  if (tagDocs.length !== tags.length) {
    throw createHttpError(400, "One or more invalid tags");
  }

  return {
    name,
    cuisine: {
      _id: cuisineDoc._id,
      name: cuisineDoc.name,
    },
    prepTime,
    cookTime,
    servings,
    ingredients,
    instructions,
    tags: tagDocs.map((tag) => ({
      _id: tag._id,
      name: tag.name,
    })),
  };
}

// -----------------------------
// Routes
// -----------------------------

// AI Serach Route
app.get("/ai/recipes", async function (req, res) {
  try {
    // more code here later
  } catch (err) {
    console.error("AI search error:", err);
    res.status(500).json({
      error: "Server error performing AI search"
    });
  }
});


// Protected route example
app.get("/profile", verifyToken, (req, res, next) => {
  try {
    if (!req.user || !req.user.user_id || !req.user.email) {
      const error = new Error("Invalid authenticated user");
      error.status = 401;
      throw error;
    }

    res.json({
      message: "This is a protected route",
      user: {
        user_id: req.user.user_id,
        email: req.user.email,
      },
    });
  } catch (error) {
    next(error);
  }
});

// AI search route
app.get('/ai/recipes', async function (req, res) {
  const query = req.query.q;

  const allCuisines = await db.collection('cuisines').distinct('name');
  const allTags = await db.collection('tags').distinct('name');
  const allIngredients = await db.collection('recipes').distinct('ingredients.name');

  const searchParams = await generateSearchParams(query, allTags, allCuisines, allIngredients);
  const criteria = {};

  if (searchParams.cuisines && searchParams.cuisines.length > 0) {
    criteria["cuisine.name"] = {
      $in: searchParams.cuisines
    }
  }

  if (searchParams.ingredients && searchParams.ingredients.length > 0) {
    criteria["ingredients.name"] = {
      $all: searchParams.ingredients
    }
  }

  if (searchParams.tags && searchParams.tags.length > 0) {
    criteria['tags.name'] = {
      $in: searchParams.tags
    }
  }

  const recipes = await db.collection('recipes').find(criteria).toArray();
  res.json({
    recipes
  })
})

app.get("/recipes", async (req, res, next) => {
  try {
    const { tags, cuisine, ingredients, name } = req.query;
    const query = {};

    if (tags) {
      if (typeof tags !== "string" || tags.trim() === "") {
        throw createHttpError(400, "tags must be a non-empty comma-separated string");
      }

      query["tags.name"] = {
        $in: tags.split(",").map((tag) => tag.trim()),
      };
    }

    if (cuisine) {
      if (typeof cuisine !== "string" || cuisine.trim() === "") {
        throw createHttpError(400, "cuisine must be a non-empty string");
      }

      query["cuisine.name"] = {
        $regex: escapeRegex(cuisine),
        $options: "i",
      };
    }

    if (ingredients) {
      if (typeof ingredients !== "string" || ingredients.trim() === "") {
        throw createHttpError(400, "ingredients must be a non-empty comma-separated string");
      }

      query["ingredients.name"] = {
        $all: ingredients
          .split(",")
          .map((ingredient) => new RegExp(escapeRegex(ingredient.trim()), "i")),
      };
    }

    if (name) {
      if (typeof name !== "string" || name.trim() === "") {
        throw createHttpError(400, "name must be a non-empty string");
      }

      query.name = {
        $regex: escapeRegex(name),
        $options: "i",
      };
    }

    const recipes = await db
      .collection("recipes")
      .find(query)
      .project({
        name: 1,
        "cuisine.name": 1,
        "tags.name": 1,
        _id: 0,
      })
      .toArray();

    res.json({ recipes });
  } catch (error) {
    next(error);
  }
});

app.get("/recipes/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      throw createHttpError(400, "Invalid recipe ID");
    }

    const recipe = await db.collection("recipes").findOne(
      { _id: new ObjectId(id) },
      { projection: { _id: 0 } }
    );

    if (!recipe) {
      throw createHttpError(404, "Recipe not found");
    }

    res.json(recipe);
  } catch (error) {
    next(error);
  }
});

app.post("/recipes", verifyToken, async (req, res, next) => {
  try {
    const newRecipe = await buildRecipeFromRequest(db, req.body);

    const result = await db.collection("recipes").insertOne(newRecipe);

    res.status(201).json({
      message: "Recipe created successfully",
      recipeId: result.insertedId,
    });
  } catch (error) {
    next(error);
  }
});

app.put("/recipes/:id", verifyToken, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      throw createHttpError(400, "Invalid recipe ID");
    }

    const updatedRecipe = await buildRecipeFromRequest(db, req.body);

    const result = await db.collection("recipes").replaceOne(
      { _id: new ObjectId(id) },
      updatedRecipe
    );

    if (result.matchedCount === 0) {
      throw createHttpError(404, "Recipe not found");
    }

    res.json({ message: "Recipe updated successfully" });
  } catch (error) {
    next(error);
  }
});

app.delete("/recipes/:id", verifyToken, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      throw createHttpError(400, "Invalid recipe ID");
    }

    const result = await db.collection("recipes").deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      throw createHttpError(404, "Recipe not found");
    }

    res.json({ message: "Recipe deleted successfully" });
  } catch (error) {
    next(error);
  }
});

app.put(
  "/recipes/:recipeId/reviews/:reviewId",
  verifyToken,
  async (req, res, next) => {
    try {
      const { recipeId, reviewId } = req.params;
      const { user, rating, comment } = req.body;

      if (!isValidObjectId(recipeId)) {
        throw createHttpError(400, "Invalid recipe ID");
      }

      if (!isValidObjectId(reviewId)) {
        throw createHttpError(400, "Invalid review ID");
      }

      if (!user || !rating || !comment) {
        throw createHttpError(400, "Missing required fields");
      }

      const ratingNumber = Number(rating);

      if (
        !Number.isInteger(ratingNumber) ||
        ratingNumber < 1 ||
        ratingNumber > 5
      ) {
        throw createHttpError(400, "Rating must be an integer from 1 to 5");
      }

      const updatedReview = {
        review_id: new ObjectId(reviewId),
        user,
        rating: ratingNumber,
        comment,
        date: new Date(),
      };

      const result = await db.collection("recipes").updateOne(
        {
          _id: new ObjectId(recipeId),
          "reviews.review_id": new ObjectId(reviewId),
        },
        {
          $set: {
            "reviews.$": updatedReview,
          },
        }
      );

      if (result.matchedCount === 0) {
        throw createHttpError(404, "Recipe or review not found");
      }

      res.json({
        message: "Review updated successfully",
        reviewId,
      });
    } catch (error) {
      next(error);
    }
  }
);

app.delete(
  "/recipes/:recipeId/reviews/:reviewId",
  verifyToken,
  async (req, res, next) => {
    try {
      const { recipeId, reviewId } = req.params;

      if (!isValidObjectId(recipeId)) {
        throw createHttpError(400, "Invalid recipe ID");
      }

      if (!isValidObjectId(reviewId)) {
        throw createHttpError(400, "Invalid review ID");
      }

      const result = await db.collection("recipes").updateOne(
        { _id: new ObjectId(recipeId) },
        {
          $pull: {
            reviews: {
              review_id: new ObjectId(reviewId),
            },
          },
        }
      );

      if (result.matchedCount === 0) {
        throw createHttpError(404, "Recipe not found");
      }

      if (result.modifiedCount === 0) {
        throw createHttpError(404, "Review not found");
      }

      res.json({ message: "Review deleted successfully" });
    } catch (error) {
      next(error);
    }
  }
);

app.post("/users", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw createHttpError(400, "Email and password are required");
    }

    if (typeof email !== "string" || typeof password !== "string") {
      throw createHttpError(400, "Email and password must be strings");
    }

    if (password.length < 8) {
      throw createHttpError(400, "Password must be at least 8 characters long");
    }

    const existingUser = await db.collection("users").findOne({ email });

    if (existingUser) {
      throw createHttpError(409, "Email already registered");
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await db.collection("users").insertOne({
      email,
      password: hashedPassword,
    });

    res.status(201).json({
      message: "User created successfully",
      userId: result.insertedId,
    });
  } catch (error) {
    next(error);
  }
});

app.post(["/login", "/logins"], async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw createHttpError(400, "Email and password are required");
    }

    const user = await db.collection("users").findOne({ email });

    // Use the same response for unknown email and incorrect password.
    if (!user) {
      throw createHttpError(401, "Invalid email or password");
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw createHttpError(401, "Invalid email or password");
    }

    const accessToken = generateAccessToken(user._id, user.email);

    res.json({ accessToken });
  } catch (error) {
    next(error);
  }
});

// -----------------------------
// 404 handler
// -----------------------------
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// -----------------------------
// Global error handler
// Must be registered after all routes.
// -----------------------------
app.use((error, req, res, next) => {
  const status = error.status || 500;
  const message =
    status === 500 ? "Internal server error" : error.message;

  if (status === 500) {
    console.error(error.stack || error);
  }

  res.status(status).json({ error: message });
});

// -----------------------------
// Start server after DB connection
// -----------------------------
async function main() {
  try {
    const db = await connect(mongoUri, dbName);

    // Make db available to route handlers without passing it everywhere.
    app.locals.db = db;

    // Rebind route handlers to the connected database.
    // This approach keeps the routes above readable while ensuring `db` exists.
    app.use((req, res, next) => {
      req.db = db;
      next();
    });

    app.listen(PORT, () => {
      console.log(`Server has started on port ${PORT}`);
    });
  } catch (error) {
    console.error("Error connecting to MongoDB", error);
    process.exit(1);
  }
}

main();

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.use((error, req, res, next) => {
  console.error(error.stack || error);
  res.status(500).json({ error: "Internal server error" });
});