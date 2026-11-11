
require("dotenv").config();

const { kafka } = require("../config/kafka");

async function testKafkaProducer() {
  const producer = kafka.producer();
  let connected = false;

  try {
    // Connect to Kafka
    await producer.connect();
    connected = true;

    console.log("Kafka producer connected!");

    // Create a sample event
    const event = {
      event_id: "evt_node_1002",
      event_type: "issue.opened",
      repository_id: "repo_1",
      issue_id: "issue_44",
      title: "Password reset not working",
      status: "open",
      timestamp: new Date().toISOString(),
    };

    // Publish the event
    const result = await producer.send({
      topic: "issue.events",
      messages: [
        {
          key: event.repository_id,
          value: JSON.stringify(event),
        },
      ],
    });

    console.log("------------------------------");
    console.log("Event published successfully!");
    console.log("Event:", JSON.stringify(event, null, 2));
    console.log("Kafka delivery metadata:", result);

  } catch (error) {
    console.error("Kafka producer failed:", error.message);
    process.exitCode = 1;

  } finally {
    if (connected) {
      await producer.disconnect();
    }
  }
}

testKafkaProducer();
