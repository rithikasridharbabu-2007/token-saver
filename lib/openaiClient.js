import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export async function askModel({ prompt, context }) {
  const runDirectory = path.resolve(".token-saver/codex-run");
  fs.mkdirSync(runDirectory, { recursive: true });

  const outputFile = path.join(
    runDirectory,
    `response-${process.pid}-${Date.now()}.txt`
  );

  const instructions = [
    "You are helping a developer understand their code.",
    "Answer the user's request using only the selected project context below.",
    "Do not inspect files, run commands, or modify anything.",
    "",
    "SELECTED PROJECT CONTEXT:",
    context,
    "",
    "USER REQUEST:",
    prompt
  ].join("\n");

  return new Promise((resolve, reject) => {
    const codex = spawn(
      "codex",
      [
        "exec",
        "--model",
        "gpt-5.6-sol",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--cd",
        runDirectory,
        "--output-last-message",
        outputFile,
        "-"
      ],
      {
        env: process.env,
        stdio: ["pipe", "ignore", "pipe"]
      }
    );

    let errorOutput = "";

    codex.stderr.on("data", (chunk) => {
      errorOutput += chunk.toString();
    });

    codex.on("error", (error) => {
      reject(
        new Error(
          `Could not start Codex CLI: ${error.message}`
        )
      );
    });

    codex.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            errorOutput.trim() ||
              `Codex exited with code ${code}`
          )
        );
        return;
      }

      if (!fs.existsSync(outputFile)) {
        reject(
          new Error("Codex did not create a response file.")
        );
        return;
      }

      const text = fs.readFileSync(outputFile, "utf8").trim();
      fs.rmSync(outputFile, { force: true });

      resolve({
        text,
        usage: null
      });
    });

    codex.stdin.write(instructions);
    codex.stdin.end();
  });
}
