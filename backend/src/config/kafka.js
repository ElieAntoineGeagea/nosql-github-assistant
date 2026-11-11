
const { Kafka, logLevel } = require("kafkajs");

const brokers = process.env.KAFKA_BROKERS;
const clientId = process.env.KAFKA_CLIENT_ID;

if (!brokers || !clientId) {
  throw new Error("Kafka environment variables are missing");
}

const kafka = new Kafka({
  clientId,
  brokers: brokers.split(",").map((broker) => broker.trim()),
  connectionTimeout: 10000,
  requestTimeout: 30000,
  retry: {
    initialRetryTime: 300,
    retries: 5,
  },
  logLevel: logLevel.ERROR,
});

module.exports = {
  kafka,
};
