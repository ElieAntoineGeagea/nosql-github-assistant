
const { randomUUID } = require("node:crypto");

const {
  getDatabase,
  getMongoClient,
} = require("../config/mongodb");

// ======================================
// APPLICATION ERROR
// ======================================

class IssueError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "IssueError";
    this.statusCode = statusCode;
  }
}

// ======================================
// VALIDATE UPDATE DATA
// ======================================

function validatePatch(patch) {
  if (
    !patch ||
    typeof patch !== "object" ||
    Array.isArray(patch)
  ) {
    throw new IssueError(400, "Invalid update body");
  }

  const allowedFields = [
    "title",
    "body",
    "labels",
    "status",
  ];

  const keys = Object.keys(patch);

  if (
    keys.length === 0 ||
    keys.some((key) => !allowedFields.includes(key))
  ) {
    throw new IssueError(400, "Invalid update fields");
  }

  const changes = {};

  if (Object.hasOwn(patch, "title")) {
    if (
      typeof patch.title !== "string" ||
      !patch.title.trim() ||
      patch.title.length > 200
    ) {
      throw new IssueError(400, "Invalid title");
    }

    changes.title = patch.title.trim();
  }

  if (Object.hasOwn(patch, "body")) {
    if (
      typeof patch.body !== "string" ||
      patch.body.length > 10000
    ) {
      throw new IssueError(400, "Invalid body");
    }

    changes.body = patch.body;
  }

  if (Object.hasOwn(patch, "labels")) {
    if (
      !Array.isArray(patch.labels) ||
      patch.labels.length > 10 ||
      !patch.labels.every(
        (label) =>
          typeof label === "string" &&
          label.trim().length > 0 &&
          label.length <= 40
      )
    ) {
      throw new IssueError(400, "Invalid labels");
    }

    changes.labels = [
      ...new Set(
        patch.labels.map((label) => label.trim())
      ),
    ];
  }

  if (Object.hasOwn(patch, "status")) {
    if (!["open", "closed"].includes(patch.status)) {
      throw new IssueError(400, "Invalid status");
    }

    changes.status = patch.status;
  }

  return changes;
}

// ======================================
// UPDATE ISSUE AND OUTBOX ATOMICALLY
// ======================================

async function updateIssueWithOutbox({
  issueId,
  expectedRevision,
  patch,
}) {
  if (
    typeof issueId !== "string" ||
    !issueId.trim() ||
    issueId.length > 100
  ) {
    throw new IssueError(400, "Invalid issue ID");
  }

  if (
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 1
  ) {
    throw new IssueError(
      400,
      "A valid expectedRevision is required"
    );
  }

  const changes = validatePatch(patch);

  const db = getDatabase();
  const client = getMongoClient();

  const issues = db.collection("issues");
  const outbox = db.collection("outbox_events");

  const eventId = `evt_${randomUUID()}`;
  const now = new Date();

  const session = client.startSession();

  let result;

  try {
    await session.withTransaction(async () => {
      // 1. Retrieve the existing issue
      const issue = await issues.findOne(
        { _id: issueId },
        { session }
      );

      if (!issue) {
        throw new IssueError(404, "Issue not found");
      }

      // 2. Verify the repository is public
      const repository = await db
        .collection("repositories")
        .findOne(
          {
            _id: issue.repository_id,
            visibility: "public",
          },
          { session }
        );

      if (!repository) {
        throw new IssueError(404, "Issue not found");
      }

      // 3. Verify the expected revision
      if (issue.current_revision !== expectedRevision) {
        throw new IssueError(
          409,
          "Issue was modified by another request"
        );
      }

      // 4. Check that something actually changed
      const hasChanges = Object.keys(changes).some(
        (key) =>
          JSON.stringify(issue[key]) !==
          JSON.stringify(changes[key])
      );

      if (!hasChanges) {
        throw new IssueError(
          400,
          "No changes were provided"
        );
      }

      const newRevision = expectedRevision + 1;

      // 5. Determine the event type
      let eventType = "issue.updated";

      if (
        changes.status === "closed" &&
        issue.status !== "closed"
      ) {
        eventType = "issue.closed";
      } else if (
        changes.status === "open" &&
        issue.status === "closed"
      ) {
        eventType = "issue.reopened";
      }

      // 6. Update the issue
      const updateResult = await issues.updateOne(
        {
          _id: issueId,
          current_revision: expectedRevision,
        },
        {
          $set: {
            ...changes,
            updated_at: now,
          },
          $inc: {
            current_revision: 1,
          },
        },
        { session }
      );

      if (updateResult.modifiedCount !== 1) {
        throw new IssueError(
          409,
          "Concurrent issue modification detected"
        );
      }

      // 7. Create the outbox event
      const event = {
        _id: eventId,
        topic: "issue.events",
        event_key: issue.repository_id,
        event_type: eventType,
        aggregate_id: issueId,
        aggregate_version: newRevision,
        status: "pending",
        attempts: 0,
        created_at: now,
        published_at: null,
        payload: {
          event_id: eventId,
          event_type: eventType,
          repository_id: issue.repository_id,
          issue_id: issueId,
          issue_number: issue.number,
          entity_version: newRevision,
          occurred_at: now.toISOString(),
        },
      };

      // 8. Insert event in the same transaction
      await outbox.insertOne(event, { session });

      // 9. Prepare the response
      result = {
        success: true,
        message: "Issue updated atomically",
        issue: {
          id: issueId,
          repository_id: issue.repository_id,
          number: issue.number,
          ...changes,
          current_revision: newRevision,
        },
        outbox: {
          event_id: eventId,
          event_type: eventType,
          status: "pending",
        },
      };
    });

    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  IssueError,
  updateIssueWithOutbox,
};
