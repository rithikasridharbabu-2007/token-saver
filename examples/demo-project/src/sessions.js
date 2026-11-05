import { randomUUID } from "node:crypto";

const sessions = new Map();
const SESSION_TTL_MS = 60 * 60 * 1000;

export function createSession(accountId, now = Date.now()) {
  const token = randomUUID();
  sessions.set(token, { accountId, expiresAt: now + SESSION_TTL_MS });
  return token;
}

export function findSession(token, now = Date.now()) {
  const session = sessions.get(token);
  if (!session || session.expiresAt <= now) {
    sessions.delete(token);
    return null;
  }
  return session;
}
