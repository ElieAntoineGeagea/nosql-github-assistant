"use strict";

// Synthetic private data for local authorization tests only.
// Safe to rerun: never overwrites existing records or sends Kafka events.
require("dotenv").config();

const { connectMongoDB, closeMongoDB } = require("../config/mongodb");

const REPOSITORY_ID = "repo_private_demo_1";
const ISSUE_ID = "issue_private_demo_1";

async function seedPrivateDemo() {
  let connected = false;
  try {
    const db = await connectMongoDB();
    connected = true;

    await db.collection("repositories").updateOne(
      { _id: REPOSITORY_ID },
      {
        $setOnInsert: {
          name: "private-permissions-demo",
          organization_id: "org_demo",
          visibility: "private",
          default_branch: "main",
          description: "Synthetic, non-sensitive data for local access-control testing.",
          created_at: new Date(),
        },
      },
      { upsert: true }
    );

    await db.collection("issues").updateOne(
      { _id: ISSUE_ID },
      {
        $setOnInsert: {
          repository_id: REPOSITORY_ID,
          number: 1,
          title: "Private authorization test issue",
          body: "Synthetic data only. No real credentials or personal content.",
          labels: ["demo"],
          status: "open",
          author_id: "test_fixture",
          current_revision: 1,
          created_at: new Date(),
          updated_at: new Date(),
        },
      },
      { upsert: true }
    );

    const repository = await db.collection("repositories").findOne({ _id: REPOSITORY_ID });
    if (repository.visibility !== "private") {
      throw new Error("Existing fixture repository is not private; refusing to continue.");
    }

    console.log("Private test fixture ready.");
    console.log("Repository ID:", REPOSITORY_ID);
    console.log("Issue ID:", ISSUE_ID);
    console.log("Expected result before grant: HTTP 404");
    console.log("Expected result after reader grant: HTTP 200");
    console.log("Expected result after revocation: HTTP 404");
  } finally {
    if (connected) await closeMongoDB();
  }
}

seedPrivateDemo().catch((error) => {
  console.error("Private fixture setup failed:", error.message);
  process.exitCode = 1;
});
