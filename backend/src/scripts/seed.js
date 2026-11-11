
require("dotenv").config();

const {
  connectMongoDB,
  closeMongoDB,
} = require("../config/mongodb");

async function seedDatabase() {
  try {
    const db = await connectMongoDB();

    console.log("Initializing database...");

    // Repository collection
    const repositories = db.collection("repositories");

    // Issue collection
    const issues = db.collection("issues");

    // Index for efficient issue lookups
    await issues.createIndex(
      { repository_id: 1, number: 1 },
      { unique: true }
    );

    // Create our first repository
    await repositories.updateOne(
      { _id: "repo_1" },
      {
        $setOnInsert: {
          name: "authentication-service",
          organization_id: "org_1",
          visibility: "public",
          default_branch: "main",
          created_at: new Date(),
        },
      },
      { upsert: true }
    );

    console.log("Repository created or already exists.");

    // Create our first issue
    await issues.updateOne(
      { _id: "issue_42" },
      {
        $setOnInsert: {
          repository_id: "repo_1",
          number: 42,
          title: "Authentication failure",
          body: "Users cannot log in after v2.0.",
          status: "closed",
          labels: ["bug", "security"],
          author_id: "user_1",
          current_revision: 1,
          created_at: new Date(),
        },
      },
      { upsert: true }
    );

    console.log("Issue created or already exists.");

    // Verify saved data
    const repositoryCount =
      await repositories.countDocuments();

    const issueCount =
      await issues.countDocuments();

    console.log("------------------------------");
    console.log("Database initialized!");
    console.log(`Repositories: ${repositoryCount}`);
    console.log(`Issues: ${issueCount}`);
    console.log("------------------------------");

  } catch (error) {
    console.error("Database initialization failed:", error);
    process.exitCode = 1;
  } finally {
    await closeMongoDB();
  }
}

seedDatabase();
