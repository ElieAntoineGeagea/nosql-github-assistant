
require("dotenv").config();

const {
  connectMongoDB,
  getDatabase,
  closeMongoDB,
} = require("../config/mongodb");

const {
  elasticsearchClient,
} = require("../config/elasticsearch");

const { kafka } = require("../config/kafka");

// ======================================
// CONFIGURATION
// ======================================

const consumer = kafka.consumer({
  groupId: "nosql-search-consumer-v1",
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
  // 1. Ignore unsupported event types
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
  // 2. GET AUTHORITATIVE ISSUE
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
  // 3. VERIFY REPOSITORY
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
  // 4. PREPARE CURRENT ISSUE DOCUMENT
  // ==================================

  const sourceVersion = issue.current_revision || 1;

  const searchDocument = {
    record_id: issue._id,
    record_type: "issue",
    repository_id: issue.repository_id,
    number: issue.number,
    title: issue.title,
    body: issue.body || "",
    content: `${issue.title}\n${issue.body || ""}`,
    status: issue.status,
    labels: issue.labels || [],
    source_version: sourceVersion,
    created_at: issue.created_at,
    updated_at: issue.updated_at || issue.created_at,
  };

  // ==================================
  // 5. VERSION-AWARE ELASTICSEARCH UPDATE
  // ==================================

  const response = await elasticsearchClient.update({
    index: "issue_activity",
    id: issue._id,
    retry_on_conflict: 3,
    refresh: "wait_for",

    script: {
      lang: "painless",

      source: `
        if (
          ctx._source.source_version == null ||
          ctx._source.source_version < params.version
        ) {
          ctx._source.putAll(params.document);
        } else {
          ctx.op = 'noop';
        }
      `,

      params: {
        version: sourceVersion,
        document: searchDocument,
      },
    },

    // Insert this document if it doesn't exist.
    upsert: searchDocument,
  });

  // ==================================
  // 6. LOG THE RESULT
  // ==================================

  console.log("------------------------------");

  if (response.result === "noop") {
    console.log("Document already at same or newer revision.");
  } else {
    console.log("Issue synchronized successfully!");
  }

  console.log("Event type:", event.event_type);
  console.log("Issue:", issue.number);
  console.log("Issue ID:", issue._id);
  console.log("Title:", issue.title);
  console.log("Status:", issue.status);
  console.log("Revision:", sourceVersion);
  console.log("Elasticsearch result:", response.result);
  console.log("Index: issue_activity");
}

// ======================================
// START CONSUMER
// ======================================

async function startSearchConsumer() {
  try {
    // Connect MongoDB
    await connectMongoDB();

    // Verify Elasticsearch
    await elasticsearchClient.info();
    console.log("Elasticsearch connected successfully!");

    // Connect Kafka
    await consumer.connect();
    console.log("Kafka consumer connected!");

    // Subscribe to the existing topic
    await consumer.subscribe({
      topic: "issue.events",
      fromBeginning: true,
    });

    console.log("------------------------------");
    console.log("Search Consumer is running...");
    console.log("Supported events:");
    console.log("- issue.opened");
    console.log("- issue.updated");
    console.log("- issue.closed");
    console.log("- issue.reopened");
    console.log("------------------------------");

    // Process messages continuously
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

        if (!event || typeof event !== "object") {
          console.log("Skipping invalid event");
          return;
        }

        try {
          await processEvent(event);
        } catch (error) {
          console.error(
            "Failed to synchronize issue:",
            error.message
          );

          // Do not acknowledge processing as successful
          throw error;
        }
      },
    });

  } catch (error) {
    console.error(
      "Search Consumer failed:",
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

  console.log("Stopping Search Consumer...");

  await Promise.allSettled([
    consumer.stop(),
    consumer.disconnect(),
    elasticsearchClient.close(),
    closeMongoDB(),
  ]);

  console.log("Search Consumer stopped.");
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

// Start worker
startSearchConsumer();
