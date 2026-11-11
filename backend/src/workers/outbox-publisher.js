
require("dotenv").config();

const { randomUUID } = require("node:crypto");

const {
  connectMongoDB,
  getDatabase,
  closeMongoDB,
} = require("../config/mongodb");

const { kafka } = require("../config/kafka");

// ======================================
// CONFIGURATION
// ======================================

const WORKER_ID = randomUUID();

const POLL_INTERVAL_MS = 2000;
const LEASE_MS = 120000;
const MAX_BATCH_SIZE = 10;
const MAX_RETRY_DELAY_MS = 60000;

let stopping = false;

// ======================================
// HELPER: WAIT
// ======================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ======================================
// CLAIM A PENDING EVENT
// ======================================

async function claimEvent(outbox) {
  const now = new Date();

  return outbox.findOneAndUpdate(
    {
      $or: [
        {
          status: "pending",
          $or: [
            { next_attempt_at: { $exists: false } },
            { next_attempt_at: { $lte: now } },
          ],
        },
        {
          status: "processing",
          lease_until: { $lt: now },
        },
      ],
    },
    {
      $set: {
        status: "processing",
        claimed_by: WORKER_ID,
        lease_until: new Date(
          now.getTime() + LEASE_MS
        ),
      },
      $inc: {
        attempts: 1,
      },
    },
    {
      sort: { created_at: 1 },
      returnDocument: "after",
    }
  );
}

// ======================================
// PUBLISH ONE EVENT
// ======================================

async function publishEvent(outbox, producer, event) {
  try {
    // Send event to Kafka
    const metadata = await producer.send({
      topic: event.topic,
      acks: -1,
      messages: [
        {
          key: event.event_key,
          value: JSON.stringify(event.payload),
        },
      ],
    });

    // Mark as published
    const result = await outbox.updateOne(
      {
        _id: event._id,
        status: "processing",
        claimed_by: WORKER_ID,
      },
      {
        $set: {
          status: "published",
          published_at: new Date(),
        },
        $unset: {
          claimed_by: "",
          lease_until: "",
          next_attempt_at: "",
          last_error: "",
        },
      }
    );

    if (result.modifiedCount !== 1) {
      throw new Error("Publication state update failed");
    }

    console.log("------------------------------");
    console.log("Event published successfully!");
    console.log("Event ID:", event._id);
    console.log("Type:", event.event_type);
    console.log("Topic:", event.topic);
    console.log("Partition:", metadata[0].partition);

  } catch (error) {
    console.error(
      "Event publication failed:",
      event._id,
      error.message
    );

    // Exponential retry delay
    const retryDelay = Math.min(
      1000 * Math.pow(2, Math.min(event.attempts, 6)),
      MAX_RETRY_DELAY_MS
    );

    // Release the event for a later retry
    try {
      await outbox.updateOne(
        {
          _id: event._id,
          status: "processing",
          claimed_by: WORKER_ID,
        },
        {
          $set: {
            status: "pending",
            last_error: error.message,
            next_attempt_at: new Date(
              Date.now() + retryDelay
            ),
          },
          $unset: {
            claimed_by: "",
            lease_until: "",
          },
        }
      );
    } catch (recoveryError) {
      console.error(
        "Could not update retry state:",
        recoveryError.message
      );
    }
  }
}

// ======================================
// MAIN PUBLISHER
// ======================================

async function startOutboxPublisher() {
  const producer = kafka.producer();

  let mongoConnected = false;
  let kafkaConnected = false;

  try {
    // Connect to MongoDB
    await connectMongoDB();
    mongoConnected = true;

    // Connect to Kafka
    await producer.connect();
    kafkaConnected = true;

    const outbox = getDatabase().collection("outbox_events");

    console.log("------------------------------");
    console.log("Automatic Outbox Publisher Running");
    console.log("Checking for pending events...");
    console.log("------------------------------");

    // Continuously check MongoDB
    while (!stopping) {
      let processed = 0;

      for (let i = 0; i < MAX_BATCH_SIZE && !stopping; i++) {
        const event = await claimEvent(outbox);

        if (!event) {
          break;
        }

        await publishEvent(outbox, producer, event);
        processed++;
      }

      if (processed === 0) {
        await sleep(POLL_INTERVAL_MS);
      }
    }

  } catch (error) {
    console.error(
      "Outbox publisher failed:",
      error.message
    );

    process.exitCode = 1;

  } finally {
    console.log("Stopping Outbox Publisher...");

    if (kafkaConnected) {
      await producer.disconnect();
    }

    if (mongoConnected) {
      await closeMongoDB();
    }

    console.log("Outbox Publisher stopped.");
  }
}

// ======================================
// GRACEFUL SHUTDOWN
// ======================================

process.on("SIGINT", () => {
  stopping = true;
});

process.on("SIGTERM", () => {
  stopping = true;
});

// Start the publisher
startOutboxPublisher();
