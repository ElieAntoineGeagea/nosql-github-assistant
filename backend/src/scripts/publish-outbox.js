
require("dotenv").config();

const { randomUUID } = require("node:crypto");

const {
  connectMongoDB,
  getDatabase,
  closeMongoDB,
} = require("../config/mongodb");

const { kafka } = require("../config/kafka");

const WORKER_ID = randomUUID();
const LEASE_MS = 60000;
const MAX_EVENTS = 10;

async function publishOutbox() {
  const producer = kafka.producer();

  let mongoConnected = false;
  let kafkaConnected = false;
  let publishedCount = 0;

  try {
    // 1. Connect to MongoDB
    await connectMongoDB();
    mongoConnected = true;

    const db = getDatabase();
    const outbox = db.collection("outbox_events");

    // 2. Connect Kafka producer
    await producer.connect();
    kafkaConnected = true;

    console.log("Kafka producer connected!");
    console.log("Starting outbox publication...");

    // 3. Process pending events
    for (let i = 0; i < MAX_EVENTS; i++) {
      const now = new Date();

      // Atomically claim an event
      const event = await outbox.findOneAndUpdate(
        {
          $or: [
            { status: "pending" },
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

      if (!event) {
        console.log("No more pending events.");
        break;
      }

      try {
        console.log("------------------------------");
        console.log("Publishing event:", event._id);

        // 4. Publish to Kafka
        const metadata = await producer.send({
          topic: event.topic,
          messages: [
            {
              key: event.event_key,
              value: JSON.stringify(event.payload),
            },
          ],
        });

        // 5. Mark as published in MongoDB
        const updateResult = await outbox.updateOne(
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
              last_error: "",
            },
          }
        );

        if (updateResult.modifiedCount !== 1) {
          throw new Error(
            "Could not confirm outbox publication"
          );
        }

        publishedCount++;

        console.log("Event published successfully!");
        console.log("Topic:", event.topic);
        console.log("Partition:", metadata[0].partition);
        console.log("Status: published");

      } catch (error) {
        console.error(
          "Event publication failed:",
          error.message
        );

        // Allow a failed event to be retried
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
              },
              $unset: {
                claimed_by: "",
                lease_until: "",
              },
            }
          );
        } catch (recoveryError) {
          console.error(
            "Recovery update failed:",
            recoveryError.message
          );
        }

        process.exitCode = 1;
        break;
      }
    }

    console.log("------------------------------");
    console.log("Published events:", publishedCount);

    const remaining = await outbox.countDocuments({
      status: "pending",
    });

    console.log("Pending events:", remaining);

  } catch (error) {
    console.error(
      "Outbox publisher failed:",
      error.message
    );

    process.exitCode = 1;

  } finally {
    if (kafkaConnected) {
      await producer.disconnect();
    }

    if (mongoConnected) {
      await closeMongoDB();
    }
  }
}

publishOutbox();
