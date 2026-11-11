
require("dotenv").config();

const { kafka } = require("../config/kafka");

async function testKafkaConsumer() {
  const consumer = kafka.consumer({
    groupId: `nosql-test-consumer-${Date.now()}`,
  });

  let timeout;

  try {
    // 1. Connect to Kafka
    await consumer.connect();

    console.log("Kafka consumer connected!");

    // 2. Subscribe to our topic
    await consumer.subscribe({
      topic: "issue.events",
      fromBeginning: true,
    });

    console.log("Searching for event evt_node_1002...");

    // 3. Wait until the expected event is found
    let resolveFound;

    const eventFound = new Promise((resolve) => {
      resolveFound = resolve;
    });

    let found = false;

    // 4. Start consuming messages
    await consumer.run({
      eachMessage: async ({ partition, message }) => {
        let event;

        try {
          event = JSON.parse(message.value.toString());
        } catch {
          console.log("Skipping invalid JSON message");
          return;
        }

        if (event.event_id === "evt_node_1002" && !found) {
          found = true;

          console.log("------------------------------");
          console.log("SUCCESS: Event received!");
          console.log("Partition:", partition);
          console.log("Event:", JSON.stringify(event, null, 2));
          console.log("------------------------------");

          resolveFound(true);
        }
      },
    });

    // 5. Give the consumer up to 30 seconds
    const success = await Promise.race([
      eventFound,
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(false), 30000);
      }),
    ]);

    if (!success) {
      console.error("Event was not found.");
      process.exitCode = 1;
    }

  } catch (error) {
    console.error("Kafka consumer failed:", error.message);
    process.exitCode = 1;

  } finally {
    clearTimeout(timeout);
    await consumer.disconnect();
    console.log("Kafka consumer disconnected.");
  }
}

testKafkaConsumer();
