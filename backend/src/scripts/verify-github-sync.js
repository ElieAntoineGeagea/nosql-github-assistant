"use strict";

require("dotenv").config();

const neo4j = require("neo4j-driver");
const { parseRepository } = require("../ingestion/github-api");
const {
  connectMongoDB,
  getDatabase,
  closeMongoDB,
} = require("../config/mongodb");
const { elasticsearchClient } = require("../config/elasticsearch");
const {
  connectNeo4j,
  getNeo4jSession,
  closeNeo4j,
} = require("../config/neo4j");

function asNumber(value) {
  return neo4j.isInt(value) ? value.toNumber() : Number(value ?? 0);
}

async function main() {
  const arg = process.argv[2];
  if (!arg || process.argv.length !== 3) {
    throw new Error("Usage: npm run verify:github -- owner/repository");
  }
  const { fullName } = parseRepository(arg);

  let mongoReady = false;
  let neo4jReady = false;

  try {
    await connectMongoDB();
    mongoReady = true;
    const db = getDatabase();
    const repository = await db.collection("repositories").findOne({
      full_name: fullName,
      visibility: "public",
      source: "github",
    });
    if (!repository) {
      throw new Error("Repository not imported yet: " + fullName);
    }

    const repositoryId = repository._id;
    const issueIds = (await db.collection("issues")
      .find({ repository_id: repositoryId, source: "github" })
      .project({ _id: 1 })
      .toArray()).map(item => item._id);

    const issues = issueIds.length;
    const published = await db.collection("outbox_events").countDocuments({
      aggregate_id: { $in: issueIds },
      status: "published",
    });
    const notPublished = await db.collection("outbox_events").countDocuments({
      aggregate_id: { $in: issueIds },
      status: { $ne: "published" },
    });
    const discussionCount = await db.collection("discussions")
      .countDocuments({ repository_id: repositoryId });
    const documentCount = await db.collection("documents")
      .countDocuments({ repository_id: repositoryId });

    const issueActivity = await elasticsearchClient.count({
      index: "issue_activity",
      query: {
        bool: {
          filter: [
            { term: { repository_id: repositoryId } },
            { term: { record_type: "issue" } },
          ],
        },
      },
    });
    const commentActivity = await elasticsearchClient.count({
      index: "issue_activity",
      query: {
        bool: {
          filter: [
            { term: { repository_id: repositoryId } },
            { term: { record_type: "comment" } },
          ],
        },
      },
    });
    const knowledgeChunks = await elasticsearchClient.count({
      index: "knowledge_chunks",
      query: { term: { repository_id: repositoryId } },
    });

    await connectNeo4j();
    neo4jReady = true;
    const session = getNeo4jSession();
    let graphCount = 0;
    let graphRelCount = 0;
    try {
      const result = await session.run(
        `
          MATCH (r:Repository {id: $repositoryId})
          OPTIONAL MATCH (r)-[rel:HAS_ISSUE]->(i:Issue)
          RETURN count(DISTINCT i) AS issues,
                 count(DISTINCT rel) AS relationships
        `,
        { repositoryId }
      );
      if (result.records.length) {
        graphCount = asNumber(result.records[0].get("issues"));
        graphRelCount = asNumber(result.records[0].get("relationships"));
      }
    } finally {
      await session.close();
    }

    const searchIssues = Number(issueActivity.count);
    const searchComments = Number(commentActivity.count);
    const chunks = Number(knowledgeChunks.count);

    const checks = [
      ["MongoDB imported issues", issues],
      ["MongoDB comments", discussionCount],
      ["MongoDB documents", documentCount],
      ["Published issue outbox events", published],
      ["Unpublished issue outbox events", notPublished],
      ["Elasticsearch searchable issues", searchIssues],
      ["Elasticsearch comments", searchComments],
      ["Elasticsearch knowledge chunks", chunks],
      ["Neo4j issue nodes", graphCount],
      ["Neo4j HAS_ISSUE relationships", graphRelCount],
    ];

    console.log("\nGitHub synchronization verification for " + fullName);
    console.log("Repository ID:", repositoryId);
    console.log("------------------------------------------------");
    for (const [label, value] of checks) {
      console.log(label.padEnd(39) + value);
    }
    console.log("------------------------------------------------");

    const ok = issues > 0 &&
      notPublished === 0 &&
      published >= issues &&
      searchIssues === issues &&
      searchComments === discussionCount &&
      chunks > 0 &&
      graphCount === issues &&
      graphRelCount === issues;

    if (!ok) {
      console.error("NOT FULLY SYNCHRONIZED. The importer may have completed before the Kafka workers.");
      console.error("Check the outbox publisher, search-consumer and graph-consumer logs, then rerun this command.");
      process.exitCode = 1;
    } else {
      console.log("PASS: MongoDB, outbox, Elasticsearch, and Neo4j counts are consistent.");
    }
  } finally {
    await Promise.allSettled([
      elasticsearchClient.close(),
      ...(neo4jReady ? [closeNeo4j()] : []),
      ...(mongoReady ? [closeMongoDB()] : []),
    ]);
  }
}

main().catch((error) => {
  console.error("Verification failed:", error.message);
  process.exitCode = 1;
});
