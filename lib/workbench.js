import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectIndex } from "./snapshot.js";
import { DEMO_CASES, inspectContext, evaluateBudgets } from "./evaluation.js";

export const DEMO_ROOT = fileURLToPath(new URL("../examples/demo-project", import.meta.url));
const templatePath = fileURLToPath(new URL("../ui/workbench.html", import.meta.url));
const BUDGETS = [300, 700, 1200];
const genericQuestions = ["How is this project started?", "How does authentication work?", "How are errors handled?"];

export function renderWorkbench(data) {
  // Source is data, never executable markup, even when an excerpt contains </script>.
  const json = JSON.stringify(data).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
  return fs.readFileSync(templatePath, "utf8").replace("__TOKEN_SAVER_DATA__", json);
}

export function makeWorkbenchData(root = DEMO_ROOT, mode = "replay") {
  const realRoot = fs.realpathSync(root);
  const demo = realRoot === fs.realpathSync(DEMO_ROOT);
  const cases = demo ? DEMO_CASES : [];
  const questions = demo ? cases.map(item => item.question) : genericQuestions;
  const report = new ProjectIndex().scan(realRoot);
  if (!report.fileCount) throw new Error("No readable source found for the workbench.");
  const initial = inspectContext(report, questions[0], { budget: 700 }, cases);
  const evaluation = demo ? evaluateBudgets(report, cases, BUDGETS) : null;
  const frames = mode === "replay" ? questions.flatMap(question => BUDGETS.map(budget => inspectContext(report, question, { budget }, cases))) : [];
  return { mode, project: path.basename(realRoot), budgets: BUDGETS, questions, initial, frames, evaluation };
}

export async function startWorkbench(root = DEMO_ROOT, { port = 0 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Port must be from 0 to 65535.");
  const realRoot = fs.realpathSync(root);
  const data = makeWorkbenchData(realRoot, "live");
  const index = new ProjectIndex();
  const cases = realRoot === fs.realpathSync(DEMO_ROOT) ? DEMO_CASES : [];
  const page = renderWorkbench(data);
  const server = http.createServer(async (request, response) => {
    const expectedHost = "127.0.0.1:" + server.address().port;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const send = (status, body) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); };
    if (request.headers.host !== expectedHost ||
        (request.headers.origin && request.headers.origin !== "http://" + expectedHost)) {
      send(403, { error: "Only same-origin local workbench requests are accepted." }); return;
    }
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(page); return;
    }
    if (request.method !== "POST" || request.url !== "/api/context") { send(404, { error: "Not found." }); return; }
    if (!request.headers["content-type"]?.startsWith("application/json")) { send(415, { error: "Send application/json." }); return; }
    try {
      const pieces = [];
      let size = 0;
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > 16000) { send(413, { error: "Question request is too large." }); request.resume(); return; }
        pieces.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(pieces).toString("utf8"));
      if (!body || typeof body.question !== "string" || !body.question.trim() || body.question.length > 4000) throw new Error("Provide a question of 1–4000 characters.");
      const result = inspectContext(index.scan(realRoot), body.question, { budget: body.budget ?? 700 }, cases);
      send(200, result);
    } catch (error) { send(400, { error: error instanceof SyntaxError ? "Invalid JSON request." : error.message }); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return { server, url: "http://127.0.0.1:" + server.address().port };
}
