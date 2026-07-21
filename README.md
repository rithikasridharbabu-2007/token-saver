# Token Saver CLI

Token Saver is a developer tool that reduces the project context sent to Codex.

Instead of sending the entire codebase for every question, it:

- Scans the project
- Selects files relevant to the user's question
- Sends only those selected files to Codex
- Estimates context-token savings
- Caches repeated questions to avoid duplicate Codex calls

## Demo result

For the question "Explain how the cache works in this project":

- Full project context: 4,089 estimated tokens
- Selected context: 2,146 estimated tokens
- Estimated saving: 1,943 tokens

When the same question was repeated, Token Saver returned the cached answer without another Codex call.

## Requirements

- Node.js 18 or newer
- Codex CLI
- A ChatGPT account with Codex access

## Setup

Install dependencies:

npm install

Install Codex CLI:

curl -fsSL https://chatgpt.com/codex/install.sh | sh

Sign in:

codex

Choose Sign in with ChatGPT.

## Run

Analyze the current folder:

node index.js .

Analyze another project:

node index.js /path/to/project

## Commands

/stats - Show token statistics
/clear - Clear the in-memory cache
/exit - Exit the program

## How it works

Token Saver extracts keywords from the user's question and ranks project files using filename matches and keyword occurrences. It sends the highest-ranking files to Codex through codex exec in a read-only sandbox.

The cache key contains both the question and selected project context. A cached response is used only when both are unchanged.

## Current limitations

- Token counts are estimates
- The cache resets when the program closes
- Relevance selection uses keyword matching
- The tool currently focuses on code explanation and analysis
