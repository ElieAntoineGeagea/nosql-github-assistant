"use strict";

require("dotenv").config();

const { createGitHubClient, parseRepository } = require("../ingestion/github-api");
const { importPublicRepository } = require("../ingestion/import-public-repository");
const {
  connectMongoDB,
  getDatabase,
  getMongoClient,
  closeMongoDB,
} = require("../config/mongodb");
const { elasticsearchClient } = require("../config/elasticsearch");

async function main() {
  const input = process.argv[2];
  if (process.argv.length !== 3 || !input || input === "--help") {
    console.log("Usage: npm run import:github -- owner/repository");
    console.log("Imports PUBLIC GitHub issues, issue comments, release notes and documentation.");
    if (!input || input === "--help") return;
    process.exitCode = 2;
    return;
  }
  // Validate the argument before opening connections or writing anything.
  parseRepository(input);

  let mongoConnected = false;
  try {
    await connectMongoDB();
    mongoConnected = true;
    await elasticsearchClient.info();

    const summary = await importPublicRepository({
      db: getDatabase(),
      client: getMongoClient(),
      elasticsearch: elasticsearchClient,
      github: createGitHubClient(),
      repository: input,
    });
    console.log(JSON.stringify(summary, null, 2));
    console.log("Run the outbox publisher and Kafka consumers to synchronize issues.");
  } finally {
    await Promise.allSettled([
      elasticsearchClient.close(),
      ...(mongoConnected ? [closeMongoDB()] : []),
    ]);
  }
}

main().catch((error) => {
  console.error("GitHub import failed:", error.message);
  process.exitCode = 1;
});
