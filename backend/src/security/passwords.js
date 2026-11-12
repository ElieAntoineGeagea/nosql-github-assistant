"use strict";

const { randomBytes, scrypt, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");

const deriveKey = promisify(scrypt);
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const OPTIONS = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 12 || Buffer.byteLength(password, "utf8") > 256) {
    throw new Error("Password must be at least 12 characters and at most 256 UTF-8 bytes.");
  }
}

async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt, KEY_LENGTH, OPTIONS);
  return ["scrypt", OPTIONS.N, OPTIONS.r, OPTIONS.p,
    salt.toString("hex"), key.toString("hex")].join("$");
}

async function verifyPassword(password, encoded) {
  if (typeof password !== "string" || typeof encoded !== "string") return false;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltText, keyText] = parts;
  if (Number(n) !== OPTIONS.N || Number(r) !== OPTIONS.r || Number(p) !== OPTIONS.p) return false;
  if (!/^[a-f0-9]{32}$/i.test(saltText) || !/^[a-f0-9]{128}$/i.test(keyText)) return false;
  if (Buffer.byteLength(password, "utf8") > 256) return false;
  const expected = Buffer.from(keyText, "hex");
  const actual = await deriveKey(password, Buffer.from(saltText, "hex"), KEY_LENGTH, OPTIONS);
  return timingSafeEqual(expected, actual);
}

module.exports = { validatePassword, hashPassword, verifyPassword };
