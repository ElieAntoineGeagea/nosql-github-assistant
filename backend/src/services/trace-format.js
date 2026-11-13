"use strict";

function nullableNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw.toNumber === "function" ? raw.toNumber() : Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

function formatTraceRows(records) {
  return records.map(record => {
    const get = (field) => record.get(field);
    const releaseId = get("releaseId") ?? null;
    const evidence = get("releaseEvidence") ?? null;
    return {
      pull_request: {
        number: nullableNumber(get("pullRequestNumber")),
        title: get("pullRequestTitle") ?? null,
        url: get("pullRequestUrl") ?? null,
      },
      commit: {
        sha: get("commitSha") ?? null,
        message: get("commitMessage") ?? null,
      },
      release: releaseId === null ? null : {
        id: releaseId,
        tag: get("releaseTag") ?? null,
      },
      release_evidence: evidence,
      release_verified: Boolean(releaseId && evidence === "release_notes_and_github_compare"),
    };
  });
}

function traceSummary(paths) {
  return {
    count: paths.length,
    complete_paths: paths.filter(path => path.release !== null).length,
    verified_release_paths: paths.filter(path => path.release_verified).length,
    partial_paths: paths.filter(path => path.release === null).length,
  };
}

module.exports = { nullableNumber, formatTraceRows, traceSummary };
