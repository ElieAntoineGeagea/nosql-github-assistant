
require("dotenv").config();

const neo4j = require("neo4j-driver");

const {
  connectMongoDB,
  getDatabase,
  closeMongoDB,
} = require("../config/mongodb");

const {
  connectNeo4j,
  getNeo4jSession,
  closeNeo4j,
} = require("../config/neo4j");

const { kafka } = require("../config/kafka");

// ======================================
// CONFIGURATION
// ======================================

const consumer = kafka.consumer({
  groupId: "nosql-graph-consumer-v1",
});

const SUPPORTED_EVENTS = new Set([
  "issue.opened",
  "issue.updated",
  "issue.closed",
  "issue.reopened",
]);

let shuttingDown = false;

// ======================================
// PROCESS AN ISSUE EVENT
// ======================================

async function processEvent(event) {
  if (!SUPPORTED_EVENTS.has(event.event_type)) {
    return;
  }

  if (
    typeof event.issue_id !== "string" ||
    !event.issue_id.trim()
  ) {
    console.log("Skipping event without issue ID");
    return;
  }

  const db = getDatabase();

  // ==================================
  // 1. GET AUTHORITATIVE ISSUE
  // ==================================

  const issue = await db
    .collection("issues")
    .findOne({ _id: event.issue_id });

  if (!issue) {
    console.log(
      `Skipping event: Issue ${event.issue_id} not found`
    );
    return;
  }

  // ==================================
  // 2. VERIFY REPOSITORY
  // ==================================

  const repository = await db
    .collection("repositories")
    .findOne({
      _id: issue.repository_id,
      visibility: "public",
    });

  if (!repository) {
    console.log("Skipping non-public repository");
    return;
  }

  // ==================================
  // 3. PREPARE CURRENT ISSUE DATA
  // ==================================

  const sourceVersion = issue.current_revision || 1;

  const session = getNeo4jSession();

  try {
    // ==================================
    // 4. VERSION-AWARE GRAPH UPDATE
    // ==================================

    const previousVersion = await session.executeWrite(
      async (tx) => {
        const result = await tx.run(
          `
          MERGE (repo:Repository {
            id: $repositoryId
          })

          SET repo.name = $repositoryName

          MERGE (issue:Issue {
            id: $issueId
          })

          WITH
            repo,
            issue,
            coalesce(
              issue.source_version, 0
            ) AS previousVersion

          FOREACH (
            _ IN CASE
              WHEN previousVersion < $sourceVersion
              THEN [1]
              ELSE []
            END |

            SET
              issue.number = $issueNumber,
              issue.title = $issueTitle,
              issue.status = $issueStatus,
              issue.repository_id = $repositoryId,
              issue.source_version = $sourceVersion
          )

          MERGE (repo)-[:HAS_ISSUE]->(issue)

          RETURN previousVersion
          `,
          {
            repositoryId: repository._id,
            repositoryName: repository.name,
            issueId: issue._id,
            issueNumber: issue.number,
            issueTitle: issue.title,
            issueStatus: issue.status,
            sourceVersion,
          }
        );

        // FIX: Support both Neo4j integers
        // and regular JavaScript numbers.
        const rawVersion = result.records[0]
          .get("previousVersion");

        if (neo4j.isInt(rawVersion)) {
          return rawVersion.toNumber();
        }

        return Number(rawVersion);
      }
    );

    // ==================================
    // 5. LOG THE RESULT
    // ==================================

    console.log("------------------------------");

    if (previousVersion >= sourceVersion) {
      console.log(
        "Graph already at same or newer revision."
      );
    } else {
      console.log("Graph synchronized successfully!");
    }

    console.log("Event type:", event.event_type);
    console.log("Repository:", repository.name);
    console.log("Issue:", issue.number);
    console.log("Issue ID:", issue._id);
    console.log("Title:", issue.title);
    console.log("Status:", issue.status);
    console.log("Previous revision:", previousVersion);
    console.log("Current revision:", sourceVersion);
    console.log("Relationship: HAS_ISSUE");

  } finally {
    await session.close();
  }
}

// ======================================
// START GRAPH CONSUMER
// ======================================

async function startGraphConsumer() {
  try {
    await connectMongoDB();
    await connectNeo4j();

    // Create uniqueness constraints
    const session = getNeo4jSession();

    try {
      await session.run(`
        CREATE CONSTRAINT repository_id_unique
        IF NOT EXISTS
        FOR (r:Repository)
        REQUIRE r.id IS UNIQUE
      `);

      await session.run(`
        CREATE CONSTRAINT issue_id_unique
        IF NOT EXISTS
        FOR (i:Issue)
        REQUIRE i.id IS UNIQUE
      `);
    } finally {
      await session.close();
    }

    // Connect Kafka
    await consumer.connect();

    console.log("Kafka graph consumer connected!");

    await consumer.subscribe({
      topic: "issue.events",
      fromBeginning: true,
    });

    console.log("------------------------------");
    console.log("Graph Consumer is running...");
    console.log("Supported events:");
    console.log("- issue.opened");
    console.log("- issue.updated");
    console.log("- issue.closed");
    console.log("- issue.reopened");
    console.log("------------------------------");

    await consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) {
          return;
        }

        let event;

        try {
          event = JSON.parse(message.value.toString());
        } catch {
          console.log("Skipping malformed JSON event");
          return;
        }

        if (
          !event ||
          typeof event !== "object" ||
          Array.isArray(event)
        ) {
          console.log("Skipping invalid event");
          return;
        }

        try {
          await processEvent(event);
        } catch (error) {
          console.error(
            "Failed to synchronize graph:",
            error.message
          );

          throw error;
        }
      },
    });

  } catch (error) {
    console.error(
      "Graph Consumer failed:",
      error.message
    );

    process.exitCode = 1;
    await shutdown();
  }
}

// ======================================
// GRACEFUL SHUTDOWN
// ======================================

async function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log("Stopping Graph Consumer...");

  await Promise.allSettled([
    consumer.stop(),
    consumer.disconnect(),
    closeNeo4j(),
    closeMongoDB(),
  ]);

  console.log("Graph Consumer stopped.");
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

startGraphConsumer();
