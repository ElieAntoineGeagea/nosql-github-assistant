
require("dotenv").config();

const {
  connectMongoDB,
  getDatabase,
  closeMongoDB,
} = require("../config/mongodb");

const { kafka } = require("../config/kafka");

async function testDuplicateEvent() {
  const producer = kafka.producer();

  let mongoConnected = false;
  let kafkaConnected = false;

  try {
    // Connect to MongoDB
    await connectMongoDB();
    mongoConnected = true;

    const db = getDatabase();

    // Find our original issue
    const issueId =
      "issue_f439d5fa-7847-4b1a-9ed3-bc8667e11063";

    const issue = await db
      .collection("issues")
      .findOne({ _id: issueId });

    if (
      !issue ||
      issue.status !== "closed" ||
      issue.current_revision !== 2
    ) {
      throw new Error(
        "Issue #46 must be closed at revision 2"
      );
    }

    // Retrieve the original published event
    const event = await db
      .collection("outbox_events")
      .findOne({
        aggregate_id: issueId,
        event_type: "issue.closed",
        status: "published",
      });

    if (!event) {
      throw new Error(
        "Original published issue.closed event not found"
      );
    }

    // Connect to Kafka
    await producer.connect();
    kafkaConnected = true;

    // Replay the SAME event twice
    const message = {
      key: event.event_key,
      value: JSON.stringify(event.payload),
    };

    const metadata = await producer.send({
      topic: event.topic,
      acks: -1,
      messages: [message, message],
    });

    console.log("------------------------------");
    console.log("DUPLICATE EVENT TEST");
    console.log("------------------------------");
    console.log("Original event ID:", event._id);
    console.log("Event type:", event.event_type);
    console.log("Issue:", issue.number);
    console.log("Revision:", issue.current_revision);
    console.log("Duplicate messages sent: 2");
    console.log("Kafka acknowledged the batch.");
    console.log("Delivery metadata:", metadata);
    console.log("------------------------------");

  } catch (error) {
    console.error(
      "Duplicate event test failed:",
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

testDuplicateEvent();
