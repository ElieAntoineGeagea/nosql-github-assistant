"use strict";

const { createHash } = require("node:crypto");

/**
 * Split a Markdown source into line-preserving chunks.
 * start_line and end_line are 1-based and inclusive.
 * This permits direct citations into the original GitHub source file.
 */
function chunkMarkdown(content, { linesPerChunk = 24, overlap = 3 } = {}) {
  if (typeof content !== "string") throw new TypeError("content must be a string");
  if (!Number.isSafeInteger(linesPerChunk) || linesPerChunk < 2) {
    throw new Error("linesPerChunk must be >= 2");
  }
  if (!Number.isSafeInteger(overlap) || overlap < 0 || overlap >= linesPerChunk) {
    throw new Error("overlap must be less than linesPerChunk");
  }

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (!content.trim()) return [];

  const chunks = [];
  for (let start = 0; start < lines.length;) {
    const end = Math.min(start + linesPerChunk, lines.length);
    const body = lines.slice(start, end).join("\n");
    if (body.trim()) {
      chunks.push({
        chunk_index: chunks.length,
        start_line: start + 1,
        end_line: end,
        content: body,
      });
    }
    if (end === lines.length) break;
    start = end - overlap;
  }
  return chunks;
}

function stableId(...parts) {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 28);
}

module.exports = { chunkMarkdown, stableId };
