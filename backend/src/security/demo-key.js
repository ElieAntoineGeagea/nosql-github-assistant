"use strict";

const { createHash, timingSafeEqual } = require("node:crypto");

function verifyDemoWriteKey(req, res, next) {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ success: false, error: "Demo write access is disabled in production" });
  }
  const expected = process.env.DEMO_WRITE_KEY;
  if (!expected) {
    return res.status(503).json({ success: false, error: "Demo write access is not configured" });
  }
  const supplied = req.get("x-demo-write-key") || "";
  const hash = (value) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(hash(expected), hash(supplied))) {
    return res.status(401).json({ success: false, error: "Invalid demo write key" });
  }
  return next();
}

module.exports = { verifyDemoWriteKey };
