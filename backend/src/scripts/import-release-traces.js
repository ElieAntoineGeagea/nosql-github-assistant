"use strict";

require("dotenv").config();

const { parseRepository, createGitHubClient } = require("../ingestion/github-api");
const { importRealReleaseTrace } = require("../ingestion/import-release-traces");
const { connectMongoDB, getDatabase, closeMongoDB } = require("../config/mongodb");
const { connectNeo4j, getNeo4jSession, closeNeo4j } = require("../config/neo4j");

async function main() {
  const repository = process.argv[2];
  if (!repository || process.argv.length !== 3) {
    console.log("Usage: npm run import:traces -- owner/repository");
    process.exitCode = 2;
    return;
  }
  parseRepository(repository);
  let mongoReady = false, neoReady = false, session;
  try {
    await connectMongoDB();
    mongoReady = true;
    await connectNeo4j();
    neoReady = true;
    session = getNeo4jSession();

    const report = await importRealReleaseTrace({
      db: getDatabase(), session, github: createGitHubClient(), repository,
    });
    console.log(JSON.stringify(report, null, 2));
    console.log("Note: 0 complete issue-to-release paths can be a valid outcome.");
    console.log("The importer never fabricates links without GitHub evidence.");
  } finally {
    if (session) await session.close();
    await Promise.allSettled([
      ...(neoReady ? [closeNeo4j()] : []),
      ...(mongoReady ? [closeMongoDB()] : []),
    ]);
  }
}

main().catch(error => {
  console.error("Release trace import failed:", error.message);
  process.exitCode = 1;
});
