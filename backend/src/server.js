
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const {
  connectMongoDB,
  getDatabase,
  closeMongoDB,
} = require("./config/mongodb");

const app = express();
const PORT = process.env.PORT || 5000;

// ======================================
// MIDDLEWARE
// ======================================

app.use(helmet());

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  })
);

app.use(express.json({ limit: "1mb" }));

// ======================================
// MAIN ROUTE
// ======================================

app.get("/", (req, res) => {
  res.json({
    application: "NoSQL GitHub Assistant",
    message: "Backend API is running",
    version: "1.0.0",
  });
});

// ======================================
// HEALTH CHECK
// ======================================

app.get("/api/health", async (req, res) => {
  try {
    const db = getDatabase();

    await db.command({ ping: 1 });

    res.status(200).json({
      status: "ok",
      service: "backend",
      mongodb: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: "error",
      service: "backend",
      mongodb: "disconnected",
    });
  }
});

// ======================================
// GET PUBLIC REPOSITORIES
// ======================================

app.get("/api/repositories", async (req, res) => {
  try {
    const db = getDatabase();

    const repositories = await db
      .collection("repositories")
      .find({ visibility: "public" })
      .sort({ name: 1 })
      .limit(50)
      .toArray();

    res.status(200).json({
      success: true,
      count: repositories.length,
      repositories: repositories,
    });
  } catch (error) {
    console.error("Repository retrieval error:", error);

    res.status(500).json({
      success: false,
      error: "Failed to retrieve repositories",
    });
  }
});

// ======================================
// GET ISSUES BY REPOSITORY
// ======================================

app.get("/api/issues", async (req, res) => {
  try {
    const db = getDatabase();

    const repositoryId = req.query.repository_id;

    if (
      typeof repositoryId !== "string" ||
      !repositoryId.trim()
    ) {
      return res.status(400).json({
        success: false,
        error: "repository_id is required",
      });
    }

    // Only allow public repository access for now.
    const repository = await db
      .collection("repositories")
      .findOne({
        _id: repositoryId,
        visibility: "public",
      });

    if (!repository) {
      return res.status(404).json({
        success: false,
        error: "Repository not found",
      });
    }

    const issues = await db
      .collection("issues")
      .find({ repository_id: repositoryId })
      .sort({ number: 1 })
      .limit(100)
      .toArray();

    res.status(200).json({
      success: true,
      repository_id: repositoryId,
      count: issues.length,
      issues: issues,
    });
  } catch (error) {
    console.error("Issue retrieval error:", error);

    res.status(500).json({
      success: false,
      error: "Failed to retrieve issues",
    });
  }
});

// ======================================
// UNKNOWN ROUTES
// ======================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
  });
});

// ======================================
// START SERVER
// ======================================

async function startServer() {
  try {
    await connectMongoDB();

    const server = app.listen(PORT, "127.0.0.1", () => {
      console.log("----------------------------------");
      console.log("NoSQL GitHub Assistant Backend");
      console.log(`Server: http://localhost:${PORT}`);
      console.log("----------------------------------");
    });

    async function shutdown() {
      console.log("Shutting down backend...");

      server.close(async () => {
        await closeMongoDB();
        process.exit(0);
      });
    }

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

  } catch (error) {
    console.error("Failed to start backend:", error.message);
    await closeMongoDB();
    process.exit(1);
  }
}

startServer();
