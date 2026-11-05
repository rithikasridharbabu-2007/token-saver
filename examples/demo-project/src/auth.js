import { createSession } from "./sessions.js";

export async function signIn(accounts, email, password) {
  const account = await accounts.findByEmail(email);
  if (!account || !(await accounts.verifyPassword(account, password))) {
    throw new Error("Invalid email or password");
  }
  return createSession(account.id);
}
