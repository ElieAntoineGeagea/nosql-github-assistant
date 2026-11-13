"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { nullableNumber, formatTraceRows, traceSummary } = require("../src/services/trace-format");

function record(data) {
  return { get: (key) => data[key] ?? null };
}

test("partial GitHub fix relationship remains visible when no release is recorded", () => {
  const paths = formatTraceRows([record({
    pullRequestNumber: { toNumber: () => 7563 },
    pullRequestTitle: "deps: body-parser",
    pullRequestUrl: "https://github.com/expressjs/express/pull/7563",
    commitSha: "a".repeat(40),
    commitMessage: "Merge commit for PR #7563",
  })]);
  assert.equal(paths.length, 1);
  assert.equal(paths[0].pull_request.number, 7563);
  assert.equal(paths[0].release, null);
  assert.equal(paths[0].release_verified, false);
  assert.deepEqual(traceSummary(paths), {
    count: 1, complete_paths: 0, verified_release_paths: 0, partial_paths: 1,
  });
});

test("real release evidence is differentiated from demonstration-only links", () => {
  const paths = formatTraceRows([
    record({
      pullRequestNumber: 57, pullRequestTitle: "Fix authentication",
      commitSha: "a1b2c3", releaseId: "release_21", releaseTag: "v2.1",
    }),
    record({
      pullRequestNumber: { toNumber: () => 10 }, pullRequestTitle: "Fix security",
      commitSha: "b".repeat(40), releaseId: "gh:1:release:2", releaseTag: "v1.2.0",
      releaseEvidence: "release_notes_and_github_compare",
    }),
  ]);
  assert.equal(paths[0].release_verified, false);
  assert.equal(paths[1].release_verified, true);
  assert.deepEqual(traceSummary(paths), {
    count: 2, complete_paths: 2, verified_release_paths: 1, partial_paths: 0,
  });
});

test("no matches and malformed number values are safe", () => {
  assert.deepEqual(traceSummary(formatTraceRows([])), {
    count: 0, complete_paths: 0, verified_release_paths: 0, partial_paths: 0,
  });
  assert.equal(nullableNumber(null), null);
  assert.equal(nullableNumber("invalid"), null);
  assert.equal(nullableNumber(42), 42);
});
