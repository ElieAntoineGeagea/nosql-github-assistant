"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { hashPassword, verifyPassword, validatePassword } = require("../src/security/passwords");
const {
  sessionTokenHash, viewerFromRequest,
  findAccessibleRepository, listAccessibleRepositories,
} = require("../src/security/repository-access");

test("scrypt hashes passwords with unique salts and verifies correct credentials", async () => {
  const password = "Correct-Horse-Battery-2026!";
  const one = await hashPassword(password);
  const two = await hashPassword(password);
  assert.notEqual(one, two);
  assert.equal(await verifyPassword(password, one), true);
  assert.equal(await verifyPassword("Wrong-Password-2026!", one), false);
  assert.equal(await verifyPassword(password, "garbage"), false);
});

test("password limits reject weak or overlong secrets", () => {
  assert.throws(() => validatePassword("short"));
  assert.throws(() => validatePassword("x".repeat(257)));
  assert.doesNotThrow(() => validatePassword("more-than-twelve-characters"));
});

test("session tokens are not stored in plaintext", () => {
  const raw = "a".repeat(64);
  const digest = sessionTokenHash(raw);
  assert.equal(digest.length, 64);
  assert.notEqual(digest, raw);
  assert.equal(digest, sessionTokenHash(raw));
});

function fakeDatabase() {
  const repos = [
    { _id: "public_1", name: "public", visibility: "public" },
    { _id: "private_1", name: "secret", visibility: "private" },
  ];
  const perms = [];
  const users = [{ _id: "user_123", username: "member", disabled: false }];
  const sessions = [{
    _id: sessionTokenHash("b".repeat(64)),
    user_id: "user_123",
    expires_at: new Date(Date.now() + 100000),
  }];
  return {
    perms,
    collection: (name) => {
      if (name === "repositories") return {
        findOne: async (q) => repos.find(r =>
          r._id === q._id && (!q.visibility || r.visibility === q.visibility)
        ) || null,
        find: (query) => ({
          sort: () => ({
            limit: () => ({
              toArray: async () => repos.filter(r =>
                query.visibility === "public" ? r.visibility === "public" :
                  r.visibility === "public" || query.$or?.[1]?._id.$in.includes(r._id)
              ),
            }),
          }),
        }),
      };
      if (name === "repository_permissions") return {
        findOne: async (q) => perms.find(p =>
          p._id === q._id && p.user_id === q.user_id &&
          p.repository_id === q.repository_id
        ) || null,
        find: (q) => ({
          project: () => ({
            limit: () => ({
              toArray: async () => perms.filter(p => p.user_id === q.user_id && q.role.$in.includes(p.role)),
            }),
          }),
        }),
      };
      if (name === "user_sessions") return {
        findOne: async (q) => sessions.find(s =>
          s._id === q._id && s.expires_at > q.expires_at.$gt
        ) || null,
      };
      if (name === "users") return {
        findOne: async (q) => users.find(u => u._id === q._id && !u.disabled) || null,
      };
      throw new Error("Unknown collection: " + name);
    },
  };
}

test("invalid, missing and expired bearer sessions do not authorize private data", async () => {
  const db = fakeDatabase();
  const noViewer = await viewerFromRequest(db, { get: () => null });
  assert.equal(noViewer, null);
  assert.equal(await viewerFromRequest(db, { get: () => "Bearer malformed" }), null);
  assert.equal(await findAccessibleRepository(db, "private_1", noViewer), null);
  assert.equal((await findAccessibleRepository(db, "public_1", noViewer))._id, "public_1");
  assert.equal((await listAccessibleRepositories(db, noViewer)).length, 1);
});

test("authenticated reader sees private repository only while grant exists", async () => {
  const db = fakeDatabase();
  const viewer = await viewerFromRequest(db, { get: () => "Bearer " + "b".repeat(64) });
  assert.equal(viewer.id, "user_123");
  assert.equal(await findAccessibleRepository(db, "private_1", viewer), null);
  db.perms.push({
    _id: "user_123:private_1",
    user_id: "user_123", repository_id: "private_1", role: "reader",
  });
  assert.equal((await findAccessibleRepository(db, "private_1", viewer))._id, "private_1");
  assert.equal((await listAccessibleRepositories(db, viewer)).length, 2);
  db.perms.pop();
  assert.equal(await findAccessibleRepository(db, "private_1", viewer), null);
  assert.equal((await listAccessibleRepositories(db, viewer)).length, 1);
});
