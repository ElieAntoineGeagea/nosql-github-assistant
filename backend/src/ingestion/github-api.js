"use strict";

const API_BASE = "https://api.github.com";

function parseRepository(input) {
  if (typeof input !== "string" || input.length > 200) {
    throw new Error("Repository must be in owner/name format.");
  }

  const parts = input.trim().split("/");
  if (
    parts.length !== 2 ||
    !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(parts[0]) ||
    !/^[\w.-]{1,100}$/.test(parts[1]) ||
    parts[1] === "." || parts[1] === ".."
  ) {
    throw new Error("Invalid repository. Use owner/name (for example: octocat/Hello-World).");
  }
  return { owner: parts[0], name: parts[1], fullName: parts.join("/") };
}

function createGitHubClient({
  token = process.env.GITHUB_TOKEN,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("This importer requires Node.js with built-in fetch.");
  }

  async function request(path, query = {}) {
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
      throw new Error("GitHub API path must begin with a single slash.");
    }

    const url = new URL(path, API_BASE);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "nosql-github-assistant-educational-importer",
    };
    if (token) headers.Authorization = "Bearer " + token;

    const response = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = body?.message ? ": " + body.message : "";
      } catch { /* no JSON body */ }

      if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
        throw new Error("GitHub rate limit reached. Add a GITHUB_TOKEN to backend/.env or retry later.");
      }
      throw new Error("GitHub API HTTP " + response.status + detail);
    }
    return response.json();
  }

  async function list(path, { max = 30, query = {} } = {}) {
    if (!Number.isSafeInteger(max) || max < 0 || max > 500) {
      throw new Error("max must be between 0 and 500.");
    }

    const items = [];
    for (let page = 1; items.length < max; page++) {
      const batch = await request(path, {
        ...query,
        per_page: Math.min(100, max - items.length),
        page,
      });
      if (!Array.isArray(batch)) throw new Error("Expected a list from GitHub.");
      items.push(...batch);
      if (batch.length === 0 || batch.length < Math.min(100, max - (items.length - batch.length))) break;
    }
    return items.slice(0, max);
  }

  return { request, list };
}

function githubRepoPath({ owner, name }) {
  return "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(name);
}

module.exports = { parseRepository, createGitHubClient, githubRepoPath };
