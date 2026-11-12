"use strict";

const express = require("express");
const { randomBytes, randomUUID } = require("node:crypto");
const { getDatabase, getMongoClient } = require("../config/mongodb");
const { validatePassword, hashPassword, verifyPassword } = require("../security/passwords");
const {
  SESSION_LIFETIME_MS, sessionTokenHash, safeUser,
} = require("../security/repository-access");
const { verifyDemoWriteKey } = require("../security/demo-key");

const router = express.Router();
const admin = express.Router();
const failedLogins = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function validUsername(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{2,31}$/i.test(value);
}
function validRepositoryId(value) {
  return typeof value === "string" && value.length <= 100 && /^[\w:-]+$/.test(value);
}
function loginKey(req, username) {
  return (req.ip || "local") + ":" + username;
}
function failLogin(key) {
  const now = Date.now();
  const current = failedLogins.get(key);
  if (!current || now >= current.until) failedLogins.set(key, { attempts: 1, until: now + WINDOW_MS });
  else current.attempts++;
  if (failedLogins.size > 3000) {
    for (const [item, info] of failedLogins) {
      if (info.until <= now) failedLogins.delete(item);
    }
  }
}
function tooManyAttempts(key) {
  const item = failedLogins.get(key);
  return Boolean(item && item.until > Date.now() && item.attempts >= MAX_ATTEMPTS);
}

router.post("/users", verifyDemoWriteKey, async (req, res) => {
  const { username, password } = req.body || {};
  if (!validUsername(username)) {
    return res.status(400).json({ success: false, error: "Username must be 3-32 letters, numbers, _ or - and start with a letter" });
  }
  try { validatePassword(password); }
  catch (error) { return res.status(400).json({ success: false, error: error.message }); }
  try {
    const db = getDatabase();
    const lower = username.toLowerCase();
    const user = {
      _id: "user_" + randomUUID(),
      username,
      username_lower: lower,
      password_hash: await hashPassword(password),
      disabled: false,
      created_at: new Date(),
    };
    await db.collection("users").insertOne(user);
    return res.status(201).json({ success: true, user: safeUser(user) });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, error: "Username is already registered" });
    }
    console.error("User creation failed:", error);
    return res.status(500).json({ success: false, error: "User creation failed" });
  }
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!validUsername(username) || typeof password !== "string" || Buffer.byteLength(password, "utf8") > 256) {
    return res.status(400).json({ success: false, error: "Invalid credentials format" });
  }
  const key = loginKey(req, username.toLowerCase());
  if (tooManyAttempts(key)) {
    return res.status(429).json({ success: false, error: "Too many login attempts; try again later" });
  }
  try {
    const db = getDatabase();
    const user = await db.collection("users").findOne({
      username_lower: username.toLowerCase(), disabled: { $ne: true },
    });
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      failLogin(key);
      return res.status(401).json({ success: false, error: "Invalid username or password" });
    }
    failedLogins.delete(key);
    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + SESSION_LIFETIME_MS);
    await db.collection("user_sessions").insertOne({
      _id: sessionTokenHash(token), user_id: user._id,
      created_at: new Date(), expires_at: expires,
    });
    res.set("Cache-Control", "no-store");
    return res.json({
      success: true, token, token_type: "Bearer",
      expires_at: expires.toISOString(), user: safeUser(user),
    });
  } catch (error) {
    console.error("Login failed:", error);
    return res.status(500).json({ success: false, error: "Login failed" });
  }
});

router.get("/me", (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!req.viewer) return res.status(401).json({ success: false, error: "Authentication required" });
  return res.json({ success: true, user: { id: req.viewer.id, username: req.viewer.username } });
});

router.post("/logout", async (req, res) => {
  try {
    if (req.viewer?.session_id) {
      await getDatabase().collection("user_sessions").deleteOne({ _id: req.viewer.session_id });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error("Logout failed:", error);
    return res.status(500).json({ success: false, error: "Logout failed" });
  }
});

// Admin routes are intentionally LOCAL DEVELOPMENT ONLY. This is not a production RBAC admin API.
admin.use(verifyDemoWriteKey);

admin.put("/permissions", async (req, res) => {
  const { user_id: userId, repository_id: repoId, role } = req.body || {};
  if (!validRepositoryId(repoId) || typeof userId !== "string" ||
      !/^user_[\w-]{36}$/.test(userId) || role !== "reader") {
    return res.status(400).json({ success: false, error: "Valid user_id, repository_id and role=reader required" });
  }
  try {
    const db = getDatabase();
    const [user, repository] = await Promise.all([
      db.collection("users").findOne({ _id: userId, disabled: { $ne: true } }),
      db.collection("repositories").findOne({ _id: repoId, visibility: "private" }),
    ]);
    if (!user || !repository) {
      return res.status(404).json({ success: false, error: "Private repository or user not found" });
    }
    await db.collection("repository_permissions").updateOne(
      { _id: userId + ":" + repoId },
      { $set: { user_id: userId, repository_id: repoId, role: "reader", updated_at: new Date() } },
      { upsert: true }
    );
    return res.json({ success: true, permission: { user_id: userId, repository_id: repoId, role: "reader" } });
  } catch (error) {
    console.error("Permission grant failed:", error);
    return res.status(500).json({ success: false, error: "Permission grant failed" });
  }
});

admin.delete("/permissions", async (req, res) => {
  const { user_id: userId, repository_id: repoId } = req.body || {};
  if (!validRepositoryId(repoId) || typeof userId !== "string" || !/^user_[\w-]{36}$/.test(userId)) {
    return res.status(400).json({ success: false, error: "Valid user_id and repository_id required" });
  }
  const client = getMongoClient();
  const session = client.startSession();
  let deleted = false;
  try {
    const db = getDatabase();
    await session.withTransaction(async () => {
      const removed = await db.collection("repository_permissions").deleteOne(
        { _id: userId + ":" + repoId, user_id: userId, repository_id: repoId }, { session }
      );
      if (!removed.deletedCount) return;
      deleted = true;
      const eventId = "evt_" + randomUUID();
      const now = new Date();
      await db.collection("outbox_events").insertOne({
        _id: eventId,
        topic: "issue.events",
        event_key: repoId,
        event_type: "access.revoked",
        aggregate_id: repoId,
        aggregate_version: now.getTime(),
        status: "pending", attempts: 0,
        created_at: now, published_at: null,
        payload: {
          event_id: eventId, event_type: "access.revoked",
          repository_id: repoId, user_id: userId,
          occurred_at: now.toISOString(),
        },
      }, { session });
    });
    if (!deleted) return res.status(404).json({ success: false, error: "Permission not found" });
    return res.json({ success: true, revoked: { user_id: userId, repository_id: repoId } });
  } catch (error) {
    console.error("Access revocation failed:", error);
    return res.status(500).json({ success: false, error: "Access revocation failed" });
  } finally {
    await session.endSession();
  }
});

module.exports = { authRouter: router, adminRouter: admin };
