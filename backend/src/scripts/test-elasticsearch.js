
require("dotenv").config();

const {
  elasticsearchClient,
} = require("../config/elasticsearch");

async function testElasticsearch() {
  try {
    // Check the Elasticsearch connection
    const info = await elasticsearchClient.info();

    console.log("Elasticsearch connected successfully!");
    console.log("Version:", info.version.number);

    // Search our existing documentation index
    const result = await elasticsearchClient.search({
      index: "knowledge_chunks",
      query: {
        match: {
          content: "authentication tokens",
        },
      },
    });

    console.log("------------------------------");
    console.log("Search Results");

    for (const hit of result.hits.hits) {
      console.log("Document ID:", hit._id);
      console.log("Score:", hit._score);
      console.log("Title:", hit._source.title);
      console.log("Content:", hit._source.content);
      console.log("------------------------------");
    }

    console.log("Total matches:", result.hits.total.value);

  } catch (error) {
    console.error("Elasticsearch test failed:", error.message);
    process.exitCode = 1;
  } finally {
    await elasticsearchClient.close();
  }
}

testElasticsearch();
