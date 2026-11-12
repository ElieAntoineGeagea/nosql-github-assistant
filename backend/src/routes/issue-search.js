
const express = require("express");

const { getDatabase } = require("../config/mongodb");
const { findAccessibleRepository } = require("../security/repository-access");
const {
  elasticsearchClient,
} = require("../config/elasticsearch");

const router = express.Router();

// ======================================
// GET /api/issues/search
// ======================================

router.get("/", async (req, res) => {
  try {
    const db = getDatabase();

    const repositoryId = req.query.repository_id;
    const query = req.query.q;
    const status = req.query.status;
    const label = req.query.label;

    // ==================================
    // 1. VALIDATE PARAMETERS
    // ==================================

    if (
      typeof repositoryId !== "string" ||
      !repositoryId.trim() ||
      repositoryId.length > 100
    ) {
      return res.status(400).json({
        success: false,
        error: "A valid repository_id is required",
      });
    }

    if (
      query !== undefined &&
      (
        typeof query !== "string" ||
        !query.trim() ||
        query.length > 200
      )
    ) {
      return res.status(400).json({
        success: false,
        error: "q must contain 1 to 200 characters",
      });
    }

    if (
      status !== undefined &&
      !["open", "closed"].includes(status)
    ) {
      return res.status(400).json({
        success: false,
        error: "status must be open or closed",
      });
    }

    if (
      label !== undefined &&
      (
        typeof label !== "string" ||
        !label.trim() ||
        label.length > 40
      )
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid issue label",
      });
    }

    // ==================================
    // 2. CHECK REPOSITORY VISIBILITY
    // ==================================

    const repository = await findAccessibleRepository(db, repositoryId, req.viewer);

    if (!repository) {
      return res.status(404).json({
        success: false,
        error: "Repository not found",
      });
    }

    // ==================================
    // 3. BUILD ELASTICSEARCH FILTERS
    // ==================================

    const filters = [
      { term: { repository_id: repositoryId } },
      { term: { record_type: "issue" } },
    ];

    if (status) {
      filters.push({
        term: { status },
      });
    }

    if (label) {
      filters.push({
        term: { labels: label.trim() },
      });
    }

    // ==================================
    // 4. BUILD SEARCH QUERY
    // ==================================

    const searchQuery = {
      bool: {
        filter: filters,
      },
    };

    if (query) {
      searchQuery.bool.must = [
        {
          multi_match: {
            query: query.trim(),
            fields: ["title^3", "body"],
          },
        },
      ];
    }

    // ==================================
    // 5. SEARCH ELASTICSEARCH
    // ==================================

    const response = await elasticsearchClient.search({
      index: "issue_activity",
      size: 20,
      track_total_hits: true,
      query: searchQuery,

      // When there is no keyword query,
      // show the most recently updated issues.
      ...(query
        ? {}
        : {
            sort: [
              { updated_at: { order: "desc" } },
            ],
          }),
    });

    // ==================================
    // 6. RECHECK REPOSITORY VISIBILITY
    // ==================================

    const stillPublic = await findAccessibleRepository(db, repositoryId, req.viewer);

    if (!stillPublic) {
      return res.status(404).json({
        success: false,
        error: "Repository not found",
      });
    }

    // ==================================
    // 7. FORMAT RESULTS
    // ==================================

    const results = response.hits.hits.map((hit) => {
      const source = hit._source;

      return {
        id: source.record_id,
        number: source.number,
        title: source.title,
        body: source.body,
        status: source.status,
        labels: source.labels,
        repository_id: source.repository_id,
        source_version: source.source_version,
        created_at: source.created_at,
        updated_at: source.updated_at,
        score: hit._score,
      };
    });

    // ==================================
    // 8. RETURN JSON RESPONSE
    // ==================================

    return res.status(200).json({
      success: true,
      repository_id: repositoryId,
      query: query || null,
      filters: {
        status: status || null,
        label: label || null,
      },
      count: results.length,
      total: response.hits.total.value,
      results,
    });

  } catch (error) {
    console.error("Issue search error:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to search issues",
    });
  }
});

module.exports = router;
