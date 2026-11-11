
const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DATABASE;

if (!uri || !databaseName) {
  throw new Error("MongoDB environment variables are missing");
}

const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 5000,
});

let database;

async function connectMongoDB() {
  await client.connect();

  database = client.db(databaseName);

  await database.command({ ping: 1 });

  console.log("MongoDB connected successfully");

  return database;
}

function getDatabase() {
  if (!database) {
    throw new Error("MongoDB is not connected");
  }

  return database;
}

function getMongoClient() {
  return client;
}

async function closeMongoDB() {
  await client.close();
  database = undefined;
}

module.exports = {
  connectMongoDB,
  getDatabase,
  getMongoClient,
  closeMongoDB,
};
