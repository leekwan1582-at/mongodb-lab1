// SETUP BEGINS
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { connect } = require('./db');
const { ObjectId } = require('mongodb')

const mongoUri = process.env.MONGO_URI;
const dbname = "recipe_book";
const PORT = process.env.PORT || 3000;
const bcrypt = require('bcrypt')
const crypto = require('crypto');
const secret = crypto.randomBytes(64).toString('hex');
//console.log(secret);
const { ai, MODEL, generateSearchParams, generateRecipe } = require("./gemini");


if (!mongoUri) {
    console.error("FATAL ERROR: MONGO_URI is not defined in .env");
    process.exit(1);
}

const jwt = require('jsonwebtoken');
const generateAccessToken = (id, email) => {
    return jwt.sign({
        'user_id': id,
        'email': email
    }, process.env.TOKEN_SECRET, {
        expiresIn: "1h"
    });
}
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(403);
    jwt.verify(token, process.env.TOKEN_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};



let app = express();

// Middleware
app.use(express.json());
app.use(cors());

// SETUP END

// 1. Define routes OUTSIDE the async main function
app.get("/", function (req, res) {
    res.json({
        message: "Hello World!"
    });
});

// Global Error Handler (Optional but recommended)
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something broke!' });
});

async function main() {
    try {
        const db = await connect(mongoUri, dbname);
        console.log('Connected to MongoDB');

        // 2. Start server AFTER successful connection
        app.listen(PORT, () => {
            console.log(`Server has started on port ${PORT}`);
        });
        // Routes
        // app.get("/recipes", async (req, res) => {
        //     try {
        //         const recipes = await db.collection("recipes").find().project({
        //             _id: 0,
        //             name: 1,
        //             cuisine: 1,
        //             prepTime: 1,
        //         }).toArray();

        //         res.json({ recipes });
        //     } catch (error) {
        //         console.error("Error fetching recipes:", error);
        //         res.status(500).json({ error: "Internal server error" });
        //     }
        // });
        app.get('/profile', verifyToken, (req, res) => {
            res.json({ message: 'This is a protected route', user: req.user });
        });
        app.get("/recipes/:id", async (req, res) => {
            try {
                const id = req.params.id;

                // First, fetch the recipe
                const recipe = await db.collection("recipes").findOne(
                    { _id: new ObjectId(id) },
                    { projection: { _id: 0 } }
                );

                if (!recipe) {
                    return res.status(404).json({ error: "Recipe not found" });
                }

                res.json(recipe);
            } catch (error) {
                console.error("Error fetching recipe:", error);
                res.status(500).json({ error: "Internal server error" });
            }
        });
        // AI-powered recipe search endpoint
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
        // AI-powered recipe generation endpoint
        app.post('/ai/recipes', async function (req, res) {
            const recipeText = req.body.recipeText;
            const allCuisines = await db.collection('cuisines').distinct('name');
            const allTags = await db.collection('tags').distinct('name');
            const newRecipe = await generateRecipe(recipeText, allCuisines, allTags);

            // get the cuisine document
            const cuisineDoc = await db.collection('cuisines').findOne({
                "name": newRecipe.cuisine
            });

            if (cuisineDoc) {
                newRecipe.cuisine = cuisineDoc;
            } else {
                return res.status(404).json({
                    "error": "AI tried to use a cuisine that doesn't exist"
                })
            }

            // get all the tags that corresponds
            const tagDocs = await db.collection('tags').find({
                'name': {
                    $in: newRecipe.tags
                }
            }).toArray();
            newRecipe.tags = tagDocs;

            // insert into the database
            const result = await db.collection('recipes').insertOne(newRecipe);
            res.json({
                recipeId: result.insertedId
            })
        })
        app.get('/recipes', async (req, res) => {
            try {
                const { tags, cuisine, ingredients, name } = req.query;
                let query = {};

                if (tags) {
                    query['tags.name'] = { $in: tags.split(',') };
                }

                if (cuisine) {
                    query['cuisine.name'] = { $regex: cuisine, $options: 'i' };
                }

                if (ingredients) {
                    query['ingredients.name'] = { $all: ingredients.split(',').map(i => new RegExp(i, 'i')) };
                }

                if (name) {
                    query.name = { $regex: name, $options: 'i' };
                }

                const recipes = await db.collection('recipes').find(query).project({
                    name: 1,
                    'cuisine.name': 1,
                    'tags.name': 1,
                    _id: 0
                }).toArray();

                res.json({ recipes });
                app.post('/recipes', async (req, res) => {
                    try {
                        const { name, cuisine, prepTime, cookTime, servings, ingredients, instructions, tags } = req.body;

                        // Basic validation
                        if (!name || !cuisine || !ingredients || !instructions || !tags) {
                            return res.status(400).json({ error: 'Missing required fields' });
                        }

                        // Fetch the cuisine document
                        const cuisineDoc = await db.collection('cuisines').findOne({ name: cuisine });
                        if (!cuisineDoc) {
                            return res.status(400).json({ error: 'Invalid cuisine' });
                        }

                        // Fetch the tag documents
                        const tagDocs = await db.collection('tags').find({ name: { $in: tags } }).toArray();
                        if (tagDocs.length !== tags.length) {
                            return res.status(400).json({ error: 'One or more invalid tags' });
                        }

                        // Create the new recipe object
                        const newRecipe = {
                            name,
                            cuisine: {
                                _id: cuisineDoc._id,
                                name: cuisineDoc.name
                            },
                            prepTime,
                            cookTime,
                            servings,
                            ingredients,
                            instructions,
                            tags: tagDocs.map(tag => ({
                                _id: tag._id,
                                name: tag.name
                            }))
                        };

                        // Insert the new recipe into the database
                        const result = await db.collection('recipes').insertOne(newRecipe);

                        // Send back the created recipe
                        res.status(201).json({
                            message: 'Recipe created successfully',
                            recipeId: result.insertedId
                        });
                    } catch (error) {
                        console.error('Error creating recipe:', error);
                        res.status(500).json({ error: 'Internal server error' });
                    }
                });
            } catch (error) {
                console.error('Error searching recipes:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });
        app.post('/recipes', async (req, res) => {
            try {
                const { name, cuisine, prepTime, cookTime, servings, ingredients, instructions, tags } = req.body;

                // Basic validation
                if (!name || !cuisine || !ingredients || !instructions || !tags) {
                    return res.status(400).json({ error: 'Missing required fields' });
                }

                // Fetch the cuisine document
                const cuisineDoc = await db.collection('cuisines').findOne({ name: cuisine });
                if (!cuisineDoc) {
                    return res.status(400).json({ error: 'Invalid cuisine' });
                }

                // Fetch the tag documents
                const tagDocs = await db.collection('tags').find({ name: { $in: tags } }).toArray();
                if (tagDocs.length !== tags.length) {
                    return res.status(400).json({ error: 'One or more invalid tags' });
                }

                // Create the new recipe object
                const newRecipe = {
                    name,
                    cuisine: {
                        _id: cuisineDoc._id,
                        name: cuisineDoc.name
                    },
                    prepTime,
                    cookTime,
                    servings,
                    ingredients,
                    instructions,
                    tags: tagDocs.map(tag => ({
                        _id: tag._id,
                        name: tag.name
                    }))
                };

                // Insert the new recipe into the database
                const result = await db.collection('recipes').insertOne(newRecipe);

                // Send back the created recipe
                res.status(201).json({
                    message: 'Recipe created successfully',
                    recipeId: result.insertedId
                });
            } catch (error) {
                console.error('Error creating recipe:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });
        app.put('/recipes/:id', async (req, res) => {
            try {
                const recipeId = req.params.id;
                const { name, cuisine, prepTime, cookTime, servings, ingredients, instructions, tags } = req.body;

                // Basic validation
                if (!name || !cuisine || !ingredients || !instructions || !tags) {
                    return res.status(400).json({ error: 'Missing required fields' });
                }

                // Fetch the cuisine document
                const cuisineDoc = await db.collection('cuisines').findOne({ name: cuisine });
                if (!cuisineDoc) {
                    return res.status(400).json({ error: 'Invalid cuisine' });
                }

                // Fetch the tag documents
                const tagDocs = await db.collection('tags').find({ name: { $in: tags } }).toArray();
                if (tagDocs.length !== tags.length) {
                    return res.status(400).json({ error: 'One or more invalid tags' });
                }

                // Create the updated recipe object
                const updatedRecipe = {
                    name,
                    cuisine: {
                        _id: cuisineDoc._id,
                        name: cuisineDoc.name
                    },
                    prepTime,
                    cookTime,
                    servings,
                    ingredients,
                    instructions,
                    tags: tagDocs.map(tag => ({
                        _id: tag._id,
                        name: tag.name
                    }))
                };

                // Update the recipe in the database
                const result = await db.collection('recipes').replaceOne(
                    { _id: new ObjectId(recipeId) },
                    updatedRecipe
                );

                if (result.matchedCount === 0) {
                    return res.status(404).json({ error: 'Recipe not found' });
                }

                // Send back the success response
                res.json({
                    message: 'Recipe updated successfully'
                });
            } catch (error) {
                console.error('Error updating recipe:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });
        app.delete('/recipes/:id', async (req, res) => {
            try {
                const recipeId = req.params.id;

                // Attempt to delete the recipe
                const result = await db.collection('recipes').deleteOne({ _id: new ObjectId(recipeId) });

                if (result.deletedCount === 0) {
                    return res.status(404).json({ error: 'Recipe not found' });
                }

                res.json({ message: 'Recipe deleted successfully' });
            } catch (error) {
                console.error('Error deleting recipe:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });
        app.delete('/recipes/:recipeId/reviews/:reviewId', async (req, res) => {
            try {
                const recipeId = req.params.recipeId;
                const reviewId = req.params.reviewId;

                // Remove the specific review from the recipe document
                const result = await db.collection('recipes').updateOne(
                    { _id: new ObjectId(recipeId) },
                    {
                        $pull: {
                            reviews: { review_id: new ObjectId(reviewId) }
                        }
                    }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).json({ error: 'Recipe not found' });
                }

                if (result.modifiedCount === 0) {
                    return res.status(404).json({ error: 'Review not found' });
                }

                res.json({
                    message: 'Review deleted successfully'
                });
            } catch (error) {
                console.error('Error deleting review:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });


        app.put('/recipes/:recipeId/reviews/:reviewId', async (req, res) => {
            try {
                const recipeId = req.params.recipeId;
                const reviewId = req.params.reviewId;
                const { user, rating, comment } = req.body;

                // Basic validation
                if (!user || !rating || !comment) {
                    return res.status(400).json({ error: 'Missing required fields' });
                }

                // Create the updated review object
                const updatedReview = {
                    review_id: new ObjectId(reviewId),
                    user,
                    rating: Number(rating),
                    comment,
                    date: new Date()  // Update the date to reflect the edit time
                };

                // Update the specific review in the recipe document
                const result = await db.collection('recipes').updateOne(
                    {
                        _id: new ObjectId(recipeId),
                        "reviews.review_id": new ObjectId(reviewId)
                    },
                    {
                        $set: { "reviews.$": updatedReview }
                    }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).json({ error: 'Recipe or review not found' });
                }

                res.json({
                    message: 'Review updated successfully',
                    reviewId: reviewId
                });
            } catch (error) {
                console.error('Error updating review:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });
        app.post('/users', async function (req, res) {
            const result = await db.collection("users").insertOne({
                'email': req.body.email,
                'password': await bcrypt.hash(req.body.password, 12)
            })
            res.status(201).json({
                "message": "New user account",
                "result": result
            })
        })
        app.post(['/login', '/logins'], async (req, res) => {
            const { email, password } = req.body;
            if (!email || !password) {
                return res.status(400).json({ message: 'Email and password are required' });
            }
            const user = await db.collection('users').findOne({ email: email });
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }
            const isPasswordValid = await bcrypt.compare(password, user.password);
            if (!isPasswordValid) {
                return res.status(401).json({ message: 'Invalid password' });
            }
            const accessToken = generateAccessToken(user._id, user.email);
            res.json({ accessToken: accessToken });
        });

    } catch (error) {
        console.error('Error connecting to MongoDB', error);
        process.exit(1); // Exit process if DB fails to connect on startup
    }
}

main();