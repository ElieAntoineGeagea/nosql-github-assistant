
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
// KAFKA CONSUMER CONFIGURATION
// ======================================

const consumer = kafka.consumer({
  groupId: "nosql-search-consumer-v1",
});

let shuttingDown = false;

// ======================================
// PROCESS A SINGLE KAFKA EVENT
// ======================================

async function processEvent(event) {
  // We currently support issue creation events.
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

  // 1. Retrieve authoritative issue from MongoDB
  const issue = await db
    .collection("issues")
    .findOne({ _id: event.issue_id });

  if (!issue) {
    console.log(
      `Skipping event: Issue ${event.issue_id} not found`
    );
    return;
  }

  // 2. Verify repository is public for this prototype
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

  // 3. Prepare searchable document
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
    source_version: issue.current_revision || 1,
    created_at: issue.created_at,
    updated_at: issue.updated_at || issue.created_at,
  };

  // 4. Insert or replace record in Elasticsearch
  await elasticsearchClient.index({
    index: "issue_activity",
    id: issue._id,
    document: searchDocument,
    refresh: "wait_for",
  });

  console.log("------------------------------");
  console.log("Issue indexed successfully!");
  console.log("Issue ID:", issue._id);
  console.log("Title:", issue.title);
  console.log("Elasticsearch index: issue_activity");
}

// ======================================
// START SEARCH CONSUMER
// ======================================

async function startSearchConsumer() {
  try {
    // 1. Connect to MongoDB
    await connectMongoDB();

    // 2. Verify Elasticsearch
    await elasticsearchClient.info();
    console.log("Elasticsearch connected successfully!");

    // 3. Connect to Kafka
    await consumer.connect();
    console.log("Kafka consumer connected!");

    // 4. Subscribe to events
    await consumer.subscribe({
      topic: "issue.events",
      fromBeginning: true,
    });

    console.log("------------------------------");
    console.log("Search Consumer is running...");
    console.log("Listening for issue.opened events");
    console.log("------------------------------");

    // 5. Continuously process messages
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
            "Failed to index event:",
            error.message
          );

          // Do not treat a failed indexing attempt
          // as successfully processed.
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

// Start the worker
startSearchConsumer();
