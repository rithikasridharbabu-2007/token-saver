const answers = new Map();

export function remember(key, answer, ttlMs, now = Date.now()) {
  answers.set(key, { answer, expiresAt: now + ttlMs });
}

export function cachedAnswer(key, now = Date.now()) {
  const entry = answers.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    answers.delete(key);
    return null;
  }
  return entry.answer;
}
