"use strict";

// Do not infer graph edges from shared issue/PR numbers or chronology.
// Only create links supported by explicit GitHub text and merge ancestry.

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripCodeBlocks(text) {
  return text.replace(/```[\s\S]*?```/g, "");
}

function extractClosingIssueNumbers(body, fullName) {
  if (typeof body !== "string") return [];
  const refs = new Set();
  const regex = /\b(?:fix(?:es|ed)?|clos(?:e|es|ed)|resolv(?:e|es|ed))\s+(?:([\w.-]+\/[\w.-]+))?#(\d{1,9})\b/gi;
  for (const match of stripCodeBlocks(body).matchAll(regex)) {
    if (match[1] && match[1].toLowerCase() !== fullName.toLowerCase()) continue;
    const number = Number(match[2]);
    if (Number.isSafeInteger(number) && number > 0) refs.add(number);
  }
  return [...refs];
}

function releaseMentionsPull(body, fullName, number) {
  if (typeof body !== "string" || !Number.isSafeInteger(number)) return false;
  const [owner, name] = fullName.split("/");
  if (!owner || !name) return false;
  const pattern = new RegExp(
    "https?:\\/\\/github\\.com\\/" + escapeRegExp(owner) +
    "\\/" + escapeRegExp(name) + "\\/pull\\/" + number + "(?:\\b|$)",
    "i"
  );
  return pattern.test(body);
}

function compareConfirmsAncestry(response) {
  return Boolean(
    response &&
    (response.status === "ahead" || response.status === "identical") &&
    response.behind_by === 0
  );
}

function isFullCommitSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);
}

function validReleaseTag(value) {
  return typeof value === "string" && value.length <= 100 &&
    /^[a-zA-Z0-9_.\/-]+$/.test(value) && value !== "." && value !== "..";
}

module.exports = {
  extractClosingIssueNumbers,
  releaseMentionsPull,
  compareConfirmsAncestry,
  isFullCommitSha,
  validReleaseTag,
};
