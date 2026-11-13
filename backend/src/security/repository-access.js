"use strict";

const { createHash } = require("node:crypto");

const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
const PERMISSION_ROLES = new Set(["reader", "writer", "admin"]);

function sessionTokenHash(rawToken) {
  return createHash("sha256").update(rawToken).digest("hex");
}

async function viewerFromRequest(db, req) {
  const header = req.get?.("authorization");
  if (typeof header !== "string") return null;
  const match = /^Bearer ([a-f0-9]{64})$/i.exec(header);
  if (!match) return null;

  const session = await db.collection("user_sessions").findOne({
    _id: sessionTokenHash(match[1]),
    expires_at: { $gt: new Date() },
  });
  if (!session) return null;

  const user = await db.collection("users").findOne({
    _id: session.user_id,
    disabled: { $ne: true },
  });
  if (!user) return null;
  return { id: user._id, username: user.username, session_id: session._id };
}

async function findAccessibleRepository(db, repositoryId, viewer) {
  if (typeof repositoryId !== "string" || !repositoryId.trim() || repositoryId.length > 100) return null;
  const repository = await db.collection("repositories").findOne({ _id: repositoryId });
  if (!repository) return null;
  if (repository.visibility === "public") return repository;
  if (repository.visibility !== "private" || !viewer) return null;

  const permission = await db.collection("repository_permissions").findOne({
    _id: viewer.id + ":" + repositoryId,
    user_id: viewer.id,
    repository_id: repositoryId,
  });
  if (!permission || !PERMISSION_ROLES.has(permission.role)) return null;

  // Read visibility again so a repository changed to a disallowed state
  // during the permission lookup is not served as private.
  const current = await db.collection("repositories").findOne({
    _id: repositoryId,
    visibility: "private",
  });
  return current || null;
}

async function listAccessibleRepositories(db, viewer, limit = 50) {
  const query = { visibility: "public" };
  if (viewer) {
    const permissions = await db.collection("repository_permissions")
      .find({ user_id: viewer.id, role: { $in: [...PERMISSION_ROLES] } })
      .project({ repository_id: 1 })
      .limit(500)
      .toArray();
    const ids = permissions.map((entry) => entry.repository_id);
    if (ids.length) {
      query.$or = [{ visibility: "public" }, { visibility: "private", _id: { $in: ids } }];
      delete query.visibility;
    }
  }
  return db.collection("repositories").find(query).sort({ name: 1 }).limit(limit).toArray();
}

function safeUser(user) {
  return { id: user._id, username: user.username };
}

module.exports = {
  SESSION_LIFETIME_MS, PERMISSION_ROLES, sessionTokenHash,
  viewerFromRequest, findAccessibleRepository, listAccessibleRepositories, safeUser,
};
