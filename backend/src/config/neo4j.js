
const neo4j = require("neo4j-driver");

const uri = process.env.NEO4J_URI;
const username = process.env.NEO4J_USER;
const password = process.env.NEO4J_PASSWORD;
const database = process.env.NEO4J_DATABASE || "neo4j";

// Verify environment variables
if (!uri || !username || !password) {
  throw new Error("Neo4j environment variables are missing");
}

// Create Neo4j driver
const driver = neo4j.driver(
  uri,
  neo4j.auth.basic(username, password)
);

// Verify the database connection
async function connectNeo4j() {
  await driver.verifyConnectivity();

  console.log("Neo4j connected successfully");

  return driver;
}

// Create a database session
function getNeo4jSession() {
  return driver.session({
    database,
  });
}

// Close Neo4j connection
async function closeNeo4j() {
  await driver.close();
}

module.exports = {
  connectNeo4j,
  getNeo4jSession,
  closeNeo4j,
};
