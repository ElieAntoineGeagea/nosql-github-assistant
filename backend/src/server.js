
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const { randomUUID } = require("node:crypto");

const {
  connectMongoDB,
  getDatabase,
  getMongoClient,
  closeMongoDB,
} = require("./config/mongodb");

const {
  elasticsearchClient,
} = require("./config/elasticsearch");

const {
  connectNeo4j,
  getNeo4jSession,
  closeNeo4j,
} = require("./config/neo4j");

const issueSearchRouter = require("./routes/issue-search");
const { authRouter, adminRouter } = require("./routes/auth");
const { verifyDemoWriteKey } = require("./security/demo-key");
const {
  viewerFromRequest,
  findAccessibleRepository,
  listAccessibleRepositories,
} = require("./security/repository-access");

// NEW: Issue modification service
const {
  IssueError,
  updateIssueWithOutbox,
} = require("./services/issue-mutations");

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
// DEVELOPMENT WRITE AUTHORIZATION
// ======================================

// The development write key middleware lives in security/demo-key.js.
// Read sessions on every request so access revocation takes effect immediately.
app.use(async (req, res, next) => {
  try {
    req.viewer = await viewerFromRequest(getDatabase(), req);
    next();
  } catch (error) {
    console.error("Session lookup failed:", error);
    res.status(503).json({ success: false, error: "Authentication service unavailable" });
  }
});
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);

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

    const repositories = await listAccessibleRepositories(db, req.viewer, 50);

    res.status(200).json({
      success: true,
      count: repositories.length,
      repositories,
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

    const repository = await findAccessibleRepository(db, repositoryId, req.viewer);

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
      issues,
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
// ISSUE SEARCH - ELASTICSEARCH
// ======================================

app.use("/api/issues/search", issueSearchRouter);

// ======================================
// CREATE ISSUE WITH TRANSACTIONAL OUTBOX
// ======================================

app.post("/api/issues", verifyDemoWriteKey, async (req, res) => {
  try {
    const db = getDatabase();
    const client = getMongoClient();

    const {
      repository_id,
      number,
      title,
      body = "",
      labels = [],
    } = req.body || {};

    if (
      typeof repository_id !== "string" ||
      !repository_id.trim() ||
      repository_id.length > 100 ||
      !Number.isSafeInteger(number) ||
      number <= 0 ||
      typeof title !== "string" ||
      !title.trim() ||
      title.length > 200 ||
      typeof body !== "string" ||
      body.length > 10000 ||
      !Array.isArray(labels) ||
      labels.length > 10 ||
      !labels.every(
        (label) =>
          typeof label === "string" &&
          label.length > 0 &&
          label.length <= 40
      )
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid issue data",
      });
    }

    const now = new Date();

    const issue = {
      _id: `issue_${randomUUID()}`,
      repository_id,
      number,
      title: title.trim(),
      body,
      status: "open",
      labels: [...new Set(labels)],
      author_id: "demo_user",
      current_revision: 1,
      created_at: now,
      updated_at: now,
    };

    const eventId = `evt_${randomUUID()}`;

    const outboxEvent = {
      _id: eventId,
      topic: "issue.events",
      event_key: repository_id,
      event_type: "issue.opened",
      aggregate_id: issue._id,
      aggregate_version: 1,
      status: "pending",
      attempts: 0,
      created_at: now,
      published_at: null,
      payload: {
        event_id: eventId,
        event_type: "issue.opened",
        repository_id,
        issue_id: issue._id,
        issue_number: number,
        title: issue.title,
        status: "open",
        entity_version: 1,
        occurred_at: now.toISOString(),
      },
    };

    const session = client.startSession();

    try {
      await session.withTransaction(async () => {
        const repository = await db
          .collection("repositories")
          .findOne(
            {
              _id: repository_id,
              visibility: "public",
            },
            { session }
          );

        if (!repository) {
          const error = new Error("Repository not found");
          error.statusCode = 404;
          throw error;
        }

        await db
          .collection("issues")
          .insertOne(issue, { session });

        await db
          .collection("outbox_events")
          .insertOne(outboxEvent, { session });
      });
    } finally {
      await session.endSession();
    }

    res.status(201).json({
      success: true,
      message: "Issue and outbox event saved atomically",
      issue: {
        id: issue._id,
        repository_id: issue.repository_id,
        number: issue.number,
        title: issue.title,
        status: issue.status,
      },
      outbox: {
        event_id: eventId,
        status: "pending",
        topic: "issue.events",
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: "Issue number already exists in this repository",
      });
    }

    if (error.statusCode === 404) {
      return res.status(404).json({
        success: false,
        error: "Repository not found",
      });
    }

    console.error("Issue creation error:", error);

    res.status(500).json({
      success: false,
      error: "Failed to create issue",
    });
  }
});

// ======================================
// NEW: UPDATE OR CLOSE EXISTING ISSUE
// ======================================

app.patch(
  "/api/issues/:id",
  verifyDemoWriteKey,
  async (req, res) => {
    try {
      const issueId = req.params.id;

      const { expectedRevision, ...patch } = req.body || {};

      // Call our transactional update service
      const result = await updateIssueWithOutbox({
        issueId,
        expectedRevision,
        patch,
      });

      return res.status(200).json(result);

    } catch (error) {
      // Handle expected validation/conflict errors
      if (error instanceof IssueError) {
        return res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      }

      // MongoDB write conflict
      if (
        error.code === 112 ||
        error.hasErrorLabel?.("TransientTransactionError")
      ) {
        return res.status(409).json({
          success: false,
          error: "Concurrent modification detected. Retry.",
        });
      }

      console.error("Issue update error:", error);

      return res.status(500).json({
        success: false,
        error: "Failed to update issue",
      });
    }
  }
);

// ======================================
// TRACE ISSUE RELATIONSHIPS - NEO4J
// ======================================

app.get("/api/issues/:id/trace", async (req, res) => {
  let session;

  try {
    const db = getDatabase();
    const issueId = req.params.id;

    if (
      typeof issueId !== "string" ||
      !issueId.trim() ||
      issueId.length > 100
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid issue ID",
      });
    }

    const issue = await db
      .collection("issues")
      .findOne({ _id: issueId });

    if (!issue) {
      return res.status(404).json({
        success: false,
        error: "Issue not found",
      });
    }

    const repository = await findAccessibleRepository(db, issue.repository_id, req.viewer);

    if (!repository) {
      return res.status(404).json({
        success: false,
        error: "Issue not found",
      });
    }

    session = getNeo4jSession();

    const graphResult = await session.run(
      `
      MATCH
        (repo:Repository {id: $repositoryId})
        -[:HAS_ISSUE]->
        (i:Issue {id: $issueId})
        -[:FIXED_BY]->
        (pr:PullRequest)
        -[:INCLUDES]->
        (c:Commit)
        -[:INCLUDED_IN]->
        (r:Release)

      RETURN DISTINCT
        pr.number AS pullRequestNumber,
        pr.title AS pullRequestTitle,
        c.sha AS commitSha,
        c.message AS commitMessage,
        r.id AS releaseId,
        r.tag AS releaseTag
      `,
      {
        issueId,
        repositoryId: issue.repository_id,
      }
    );

    const paths = graphResult.records.map((record) => ({
      pull_request: {
        number: record.get("pullRequestNumber")?.toNumber(),
        title: record.get("pullRequestTitle"),
      },
      commit: {
        sha: record.get("commitSha"),
        message: record.get("commitMessage"),
      },
      release: {
        id: record.get("releaseId"),
        tag: record.get("releaseTag"),
      },
    }));

    const stillPublic = await findAccessibleRepository(db, issue.repository_id, req.viewer);

    if (!stillPublic) {
      return res.status(404).json({
        success: false,
        error: "Issue not found",
      });
    }

    res.status(200).json({
      success: true,
      issue: {
        id: issue._id,
        number: issue.number,
        title: issue.title,
        repository_id: issue.repository_id,
      },
      count: paths.length,
      paths,
    });
  } catch (error) {
    console.error("Neo4j graph traversal error:", error);

    res.status(500).json({
      success: false,
      error: "Failed to retrieve issue relationships",
    });
  } finally {
    if (session) {
      await session.close();
    }
  }
});

// ======================================
// SEARCH DOCUMENTATION - ELASTICSEARCH
// ======================================

app.get("/api/search", async (req, res) => {
  try {
    const db = getDatabase();

    const query = req.query.q;
    const repositoryId = req.query.repository_id;
    const releaseId = req.query.release_id;

    if (
      typeof query !== "string" ||
      !query.trim() ||
      query.length > 200
    ) {
      return res.status(400).json({
        success: false,
        error: "Valid search query q is required (max 200 characters)",
      });
    }

    if (
      typeof repositoryId !== "string" ||
      !repositoryId.trim()
    ) {
      return res.status(400).json({
        success: false,
        error: "repository_id is required",
      });
    }

    if (
      releaseId !== undefined &&
      (typeof releaseId !== "string" || !releaseId.trim())
    ) {
      return res.status(400).json({
        success: false,
        error: "release_id must be a non-empty string",
      });
    }

    const repository = await findAccessibleRepository(db, repositoryId, req.viewer);

    if (!repository) {
      return res.status(404).json({
        success: false,
        error: "Repository not found",
      });
    }

    const filters = [
      {
        term: {
          repository_id: repositoryId,
        },
      },
    ];

    if (releaseId) {
      filters.push({
        term: {
          release_ids: releaseId,
        },
      });
    }

    const searchResult = await elasticsearchClient.search({
      index: "knowledge_chunks",
      size: 20,
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query: query.trim(),
                fields: ["title", "section", "content"],
              },
            },
          ],
          filter: filters,
        },
      },
    });

    const stillPublic = await findAccessibleRepository(db, repositoryId, req.viewer);

    if (!stillPublic) {
      return res.status(404).json({
        success: false,
        error: "Repository not found",
      });
    }

    const results = searchResult.hits.hits.map((hit) => ({
      id: hit._id,
      score: hit._score,
      repository_id: hit._source.repository_id,
      document_id: hit._source.document_id,
      title: hit._source.title,
      section: hit._source.section,
      content: hit._source.content,
      revision: hit._source.revision,
      release_ids: hit._source.release_ids,
      citation: {
        document_id: hit._source.document_id,
        revision: hit._source.revision,
        start_line: hit._source.start_line,
        end_line: hit._source.end_line,
      },
    }));

    res.status(200).json({
      success: true,
      query: query.trim(),
      repository_id: repositoryId,
      count: results.length,
      total: searchResult.hits.total.value,
      results,
    });
  } catch (error) {
    console.error("Elasticsearch search error:", error);

    res.status(500).json({
      success: false,
      error: "Search failed",
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

    const db = getDatabase();

    await db.collection("issues").createIndex(
      { repository_id: 1, number: 1 },
      { unique: true }
    );

    await db.collection("outbox_events").createIndex({
      status: 1,
      created_at: 1,
    });

    await db.collection("users").createIndex(
      { username_lower: 1 }, { unique: true }
    );

    await db.collection("user_sessions").createIndex(
      { expires_at: 1 }, { expireAfterSeconds: 0 }
    );

    await db.collection("repository_permissions").createIndex(
      { user_id: 1, repository_id: 1 }, { unique: true }
    );

    await connectNeo4j();

    const server = app.listen(PORT, "127.0.0.1", () => {
      console.log("----------------------------------");
      console.log("NoSQL GitHub Assistant Backend");
      console.log(`Server: http://localhost:${PORT}`);
      console.log("----------------------------------");
    });

    async function shutdown() {
      console.log("Shutting down backend...");

      server.close(async () => {
        try {
          await elasticsearchClient.close();
          await closeNeo4j();
          await closeMongoDB();
        } finally {
          process.exit(0);
        }
      });
    }

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    console.error("Failed to start backend:", error.message);

    await Promise.allSettled([
      elasticsearchClient.close(),
      closeNeo4j(),
      closeMongoDB(),
    ]);

    process.exit(1);
  }
}

startServer();
