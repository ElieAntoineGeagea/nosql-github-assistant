const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseRepository,
  createGitHubClient,
} = require("../src/ingestion/github-api");
const {
  chunkMarkdown,
  stableId,
} = require("../src/ingestion/chunk-markdown");

test("accepts valid owner/name and rejects URLs or traversal", () => {
  assert.equal(parseRepository("octocat/Hello-World").owner, "octocat");
  assert.throws(() => parseRepository("https://github.com/octocat/repo"));
  assert.throws(() => parseRepository("owner/../repo"));
  assert.throws(() => parseRepository("owner/"));
});

test("chunks preserve exact original 1-based source lines", () => {
  const chunks = chunkMarkdown("A\nB\nC\nD\nE", { linesPerChunk: 3, overlap: 1 });
  assert.deepEqual(chunks.map(({ start_line, end_line }) => [start_line, end_line]), [[1, 3], [3, 5]]);
  assert.equal(chunks[1].content, "C\nD\nE");
  assert.deepEqual(chunkMarkdown(" \n"), []);
  assert.throws(() => chunkMarkdown("Hello", { linesPerChunk: 2, overlap: 2 }));
});

test("stable IDs are deterministic and separate values", () => {
  assert.equal(stableId("a", "b"), stableId("a", "b"));
  assert.notEqual(stableId("a", "b"), stableId("ab"));
});

test("GitHub client paginates and obeys maximum size", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url.toString());
    const page = Number(url.searchParams.get("page"));
    return {
      ok: true,
      json: async () => page === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }],
    };
  };
  const client = createGitHubClient({ fetchImpl, token: "" });
  const results = await client.list("/repos/a/b/issues", { max: 3 });
  assert.deepEqual(results.map(x => x.id), [1, 2, 3]);
  assert.equal(seen.length, 2);
});

test("GitHub client reports HTTP failures without leaking tokens", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    headers: new Map(),
    json: async () => ({ message: "Bad credentials" }),
  });
  const client = createGitHubClient({ fetchImpl, token: "private-test-token" });
  await assert.rejects(client.request("/repos/a/b"), /401: Bad credentials/);
});
