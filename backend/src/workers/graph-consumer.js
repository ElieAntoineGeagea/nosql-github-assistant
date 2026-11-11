
require("dotenv").config();

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
// KAFKA GRAPH CONSUMER
// ======================================

const consumer = kafka.consumer({
  groupId: "nosql-graph-consumer-v1",
});

let shuttingDown = false;

// ======================================
// PROCESS ISSUE EVENTS
// ======================================

async function processEvent(event) {
  // Only handle issue creation for now
  if (event.event_type !== "issue.opened") {
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

  // 1. Retrieve original issue from MongoDB
  const issue = await db
    .collection("issues")
    .findOne({ _id: event.issue_id });

  if (!issue) {
    console.log(
      `Skipping event: Issue ${event.issue_id} not found`
    );
    return;
  }

  // 2. Retrieve the repository
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

  // 3. Open a Neo4j session
  const session = getNeo4jSession();

  try {
    // 4. Create or update graph nodes
    await session.executeWrite(async (tx) => {
      await tx.run(
        `
        MERGE (repo:Repository {id: $repositoryId})
        SET repo.name = $repositoryName

        MERGE (issue:Issue {id: $issueId})
        SET
          issue.number = $issueNumber,
          issue.title = $issueTitle,
          issue.status = $issueStatus,
          issue.repository_id = $repositoryId,
          issue.source_version = $sourceVersion

        MERGE (repo)-[:HAS_ISSUE]->(issue)
        `,
        {
          repositoryId: repository._id,
          repositoryName: repository.name,
          issueId: issue._id,
          issueNumber: issue.number,
          issueTitle: issue.title,
          issueStatus: issue.status,
          sourceVersion: issue.current_revision || 1,
        }
      );
    });

    console.log("------------------------------");
    console.log("Graph updated successfully!");
    console.log("Repository:", repository.name);
    console.log("Issue:", issue.number);
    console.log("Issue ID:", issue._id);
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
    // Connect to MongoDB
    await connectMongoDB();

    // Connect to Neo4j
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

    // Connect to Kafka
    await consumer.connect();

    console.log("Kafka graph consumer connected!");

    // Subscribe to issue events
    await consumer.subscribe({
      topic: "issue.events",
      fromBeginning: true,
    });

    console.log("------------------------------");
    console.log("Graph Consumer is running...");
    console.log("Listening for issue.opened events");
    console.log("------------------------------");

    // Continuously process messages
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

        try {
          await processEvent(event);
        } catch (error) {
          console.error(
            "Graph event processing failed:",
            error.message
          );

          // Let KafkaJS handle the failure
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

// Start the worker
startGraphConsumer();
