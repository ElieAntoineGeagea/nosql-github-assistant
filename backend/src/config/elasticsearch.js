
const { Client } = require("@elastic/elasticsearch");

const elasticsearchUrl = process.env.ELASTICSEARCH_URL;

if (!elasticsearchUrl) {
  throw new Error("ELASTICSEARCH_URL is missing");
}

const elasticsearchClient = new Client({
  node: elasticsearchUrl,
  requestTimeout: 10000,
  maxRetries: 2,
});

module.exports = {
  elasticsearchClient,
};
