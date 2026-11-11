
require("dotenv").config();

const { kafka } = require("../config/kafka");

async function testKafka() {
  const admin = kafka.admin();
  let connected = false;

  try {
    // Connect to the Kafka broker
    await admin.connect();
    connected = true;

    console.log("Kafka connected successfully!");

    // Retrieve all existing Kafka topics
    const topics = await admin.listTopics();

    console.log("------------------------------");
    console.log("Available Kafka Topics:");

    for (const topic of topics) {
      console.log("-", topic);
    }

    // Verify our project topic exists
    if (topics.includes("issue.events")) {
      console.log("------------------------------");
      console.log("SUCCESS: issue.events topic found!");
    } else {
      console.error("ERROR: issue.events topic not found!");
      process.exitCode = 1;
    }

  } catch (error) {
    console.error("Kafka connection failed:", error.message);
    process.exitCode = 1;

  } finally {
    if (connected) {
      await admin.disconnect();
    }
  }
}

testKafka();
