
require("dotenv").config();

const {
  connectNeo4j,
  getNeo4jSession,
  closeNeo4j,
} = require("../config/neo4j");

async function testNeo4j() {
  let session;

  try {
    // 1. Connect to Neo4j
    await connectNeo4j();

    // 2. Open a database session
    session = getNeo4jSession();

    // 3. Find the release containing the fix
    const result = await session.run(`
      MATCH (i:Issue {id: $issueId})
            -[:FIXED_BY]->(pr:PullRequest)
            -[:INCLUDES]->(c:Commit)
            -[:INCLUDED_IN]->(r:Release)

      RETURN
        i.number AS issueNumber,
        i.title AS issueTitle,
        pr.number AS pullRequestNumber,
        c.sha AS commitSha,
        r.tag AS releaseTag
    `, {
      issueId: "issue_42",
    });

    // 4. Display the results
    console.log("------------------------------");
    console.log("Neo4j Graph Traversal Results");

    for (const record of result.records) {
      console.log("Issue:", record.get("issueNumber").toNumber());
      console.log("Title:", record.get("issueTitle"));
      console.log("Pull Request:", record.get("pullRequestNumber").toNumber());
      console.log("Commit:", record.get("commitSha"));
      console.log("Release:", record.get("releaseTag"));
      console.log("------------------------------");
    }

    console.log("Total matching paths:", result.records.length);

  } catch (error) {
    console.error("Neo4j test failed:", error.message);
    process.exitCode = 1;
  } finally {
    if (session) {
      await session.close();
    }

    await closeNeo4j();
  }
}

testNeo4j();
