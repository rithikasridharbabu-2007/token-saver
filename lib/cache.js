import { createHash } from "node:crypto";

const cache = new Map();

function createKey(prompt) {
  if (typeof prompt !== "string") {
    throw new TypeError("Prompt must be a string.");
  }

  return createHash("sha256").update(prompt).digest("hex");
}

export function saveToCache(prompt, response) {
  const key = createKey(prompt);
  cache.set(key, response);
}

export function getFromCache(prompt) {
  const key = createKey(prompt);
  return cache.get(key);
}

export function isCached(prompt) {
  const key = createKey(prompt);
  return cache.has(key);
}

export function clearCache() {
  cache.clear();
}

export function getCacheSize() {
  return cache.size;
}
