"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractClosingIssueNumbers,
  releaseMentionsPull,
  compareConfirmsAncestry,
  isFullCommitSha,
  validReleaseTag,
} = require("../src/ingestion/trace-evidence");

test("Only real closing keywords create candidate issue associations", () => {
  assert.deepEqual(
    extractClosingIssueNumbers("Fixes #42\nCloses expressjs/express#73\nrelated #90", "expressjs/express"),
    [42, 73]
  );
  assert.deepEqual(
    extractClosingIssueNumbers("closes otherorg/otherrepo#7; resolves #10", "expressjs/express"),
    [10]
  );
  assert.deepEqual(extractClosingIssueNumbers("```\nfixes #5\n```\nFixes #6", "expressjs/express"), [6]);
  assert.deepEqual(extractClosingIssueNumbers(null, "expressjs/express"), []);
});

test("Release matching requires explicit same-repository PR URL", () => {
  const body = "* Fix bug in https://github.com/expressjs/express/pull/6150 by contributor";
  assert.equal(releaseMentionsPull(body, "expressjs/express", 6150), true);
  assert.equal(releaseMentionsPull(body, "expressjs/express", 615), false);
  assert.equal(releaseMentionsPull(body, "other/other", 6150), false);
  assert.equal(releaseMentionsPull("See issue #6150", "expressjs/express", 6150), false);
  assert.equal(releaseMentionsPull("", "expressjs/express", 6150), false);
});

test("Commit must be proven ancestor of the release tag", () => {
  assert.equal(compareConfirmsAncestry({ status: "ahead", behind_by: 0 }), true);
  assert.equal(compareConfirmsAncestry({ status: "identical", behind_by: 0 }), true);
  assert.equal(compareConfirmsAncestry({ status: "diverged", behind_by: 2 }), false);
  assert.equal(compareConfirmsAncestry({ status: "behind", behind_by: 4 }), false);
  assert.equal(compareConfirmsAncestry(null), false);
});

test("Only valid refs enter API compare paths", () => {
  assert.equal(isFullCommitSha("a".repeat(40)), true);
  assert.equal(isFullCommitSha("a1b2c3"), false);
  assert.equal(validReleaseTag("v5.1.0"), true);
  assert.equal(validReleaseTag("v5/fix-1"), true);
  assert.equal(validReleaseTag("../bad"), false);
  assert.equal(validReleaseTag("tag with spaces"), false);
});
