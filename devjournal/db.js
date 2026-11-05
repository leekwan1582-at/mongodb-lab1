const { MongoClient, ServerApiVersion } = require("mongodb");

let client = null;

async function connect(uri, dbname) {
  // Reuse existing connection if client is already connected
  if (client) {
    return client.db(dbname);
  }

  // Initialize a new client using the Stable API version
  client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: false,
      deprecationErrors: true,
    },
  });

  await client.connect();
  console.log("Connected to MongoDB");

  return client.db(dbname);
}

module.exports = { connect };
