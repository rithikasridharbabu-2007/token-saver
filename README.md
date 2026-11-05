# Token Saver

**Smaller code prompts. Visible evidence. Measured tradeoffs.**

Token Saver finds relevant source excerpts, shows why they were chosen, and packages them into a prompt. Preview and export work entirely offline. An optional Codex integration answers questions and remembers repeated answers locally.

Useful for explaining an unfamiliar function, tracing a local import, and preparing focused code context for a coding assistant.

## Try the browser workbench

Open the bundled standalone preview.html from this source folder for an offline replay with no installation or account. It contains six demo questions at three budgets; it is not a simulated AI answer.

For live selection on the included sample:

~~~sh
npm ci
npm run demo
~~~

Open the printed local URL. Move the session question's budget from 300 to 700: more of the required code survives. Excerpts, source lines, selection reasons and export controls are visible together.

~~~sh
# Inspect your own project in the local workbench:
node index.js demo /path/to/project

# Generate a standalone replay to share with reviewers:
node index.js demo --output preview.html
~~~

The server binds to 127.0.0.1 and makes no model calls. Custom questions without labeled evidence are unscored. The standalone export records only its preset questions; arbitrary questions use the local server.

## Check evidence, then measure model usage

~~~sh
# Offline budget sweep, using the six bundled evidence cases:
node index.js evaluate --output evaluation.json

# Use your own source labels (see examples/evaluation-cases.json):
node index.js evaluate /path/to/project --cases cases.json --budgets 300,700,1200

# Two live Codex calls; requires login and consumes model usage:
node index.js compare "How does checkout calculate the total?" examples/demo-project \
  --model gpt-5.6-sol --budget 700 --output comparison.json
~~~

evaluate checks that specific code fragments remain in the correct files. It does not grade AI answers. The bundled sample currently retains all labeled evidence on 5/6 cases at 300 tokens and 6/6 at 700. The recommendation is the smallest passing budget from the tested list, not a universal safe limit.

compare bypasses saved answers and runs the same question with the same explicit model against full eligible source and selected excerpts. It records both answers, reported usage, timing and provider thread IDs when available. Unknown usage stays unknown. Read both answers before claiming equal quality. A failed second run preserves a partial report; the full-source baseline is capped at 32,000 local tokens unless --baseline-limit is explicitly changed.

Use a model available in your Codex account. The model argument is not silently substituted if unavailable.

## Try it in two minutes

Requires **Node.js 22 or newer**. From this source folder:

~~~sh
npm ci
node index.js context "How does signIn create a session?" examples/demo-project --budget 700
~~~

This previews code without sending anything to a model or creating a cache. Try other questions:

~~~sh
node index.js context "Where are expired cached answers removed?" examples/demo-project
node index.js context "How does checkout calculate the total?" examples/demo-project
~~~

To make the command available in your terminal:

~~~sh
npm install --global .
token-saver --help
~~~

The source can be installed locally; this README does not assume that version 1.2.0 has been published to npm.

## Use it on your project

~~~sh
# Preview selected code, source lines, reasons and token counts:
token-saver context "How does authentication work?" /path/to/project --budget 3000

# Export the assembled prompt to a new file for another coding assistant:
token-saver context "Explain checkout" /path/to/project --output /tmp/checkout-context.txt

# JSON output for scripts:
token-saver context "Explain checkout" /path/to/project --json
~~~

Export refuses to overwrite an existing file. Put exports outside the scanned project, or exclude them in .tokensaverignore.

## Ask Codex

Install a current [Codex CLI](https://learn.chatgpt.com/docs/cli) and sign in with codex login. Token Saver uses that CLI's authentication; it does not request or store an API key.

~~~sh
token-saver doctor /path/to/project
token-saver ask "How does caching work?" /path/to/project

# Use a model available in your Codex account:
token-saver ask "Explain checkout" /path/to/project --model YOUR_MODEL --budget 3000

# Preview exactly the context an ask would use:
token-saver ask "Explain checkout" /path/to/project --dry-run

# Disable saved answers or allow a longer run:
token-saver ask "Explain checkout" /path/to/project --no-cache --timeout 180
~~~

Without --model, Codex uses its configured default. doctor checks the binary and project scan; it does not verify login or model access.

Interactive mode remains available:

~~~sh
token-saver /path/to/project
# Also supported: node index.js /path/to/project
~~~

Interactive commands:

| Command | What it does |
| --- | --- |
| /context QUESTION | Preview code without asking Codex |
| /stats | Show session calls, failures, estimated reduction and reported usage |
| /clear | Delete this project's saved answers |
| /exit | Exit |

Each question is independent. Follow-up questions such as “what about that?” do not carry chat history. Ctrl+C cancels an active model request; Ctrl+C at the prompt or Ctrl+D exits.

## What is counted

The budget covers **the assembled user prompt**: instructions, question, JSON file labels and source excerpts. Counts use the bundled o200k_base tokenizer, rather than characters divided by four.

The baseline is all eligible scanned text files with the same question and instructions. It is a comparison baseline, not a claim that ordinary Codex would send an entire repository.

Codex adds its own context, and models may use a different encoding. Consequently:

- Local prompt counts are estimates of model usage.
- The budget does not limit system messages, reasoning, answers or the total bill.
- When Codex returns usage, input, cached input and output counts are reported separately.
- Reusing a saved answer makes no model request; previous usage is not reported as new usage.
- Session reduction estimates count successful answers. A failed request may still consume provider usage that Token Saver cannot observe.

Read [Codex's JSON output documentation](https://learn.chatgpt.com/docs/non-interactive-mode#make-output-machine-readable) for the event format.

## How code is chosen

1. Scan eligible source files and apply root and nested ignore files.
2. Split source into bounded excerpts with file and line references.
3. Rank excerpts using BM25-style term scoring, relative filenames and declared identifiers.
4. Consider one-hop local imports from the best matching file.
5. Select a diverse set of excerpts that fits the whole-prompt budget.

There is no embedding service, vector database or extra AI call for selection. JS/TS relative imports and relative Python from-imports are recognized heuristically; aliases, dynamic imports and complete dependency graphs are not resolved. This is lexical retrieval, not a full language parser.

If nothing matches, the tool labels its overview fallback as low confidence. A large function may be cut; partial excerpts are marked.

## File exclusions and local data

The scanner applies .gitignore and .tokensaverignore in each traversed directory. A .tokensaverignore uses gitignore-style patterns:

~~~gitignore
customer-data/
internal-notes.md
**/fixtures/private/
~~~

Always excluded:

- .env variants, common credential filenames and private-key formats.
- Dependencies, version-control metadata, build output and common local-tool folders.
- Symlinks, unsupported/binary files, invalid UTF-8 and oversized files.
- Files containing a small set of recognizable API-key/private-key patterns.

Defaults: 512 KiB per file, 20 MiB of eligible files, 10,000 files, 50,000 visited entries and depth 64. Scan-limit warnings are shown. These exclusions are best effort, not a guarantee that a source file contains no secrets; inspect context before using ask.

context performs no network requests. ask sends the selected question and excerpts through Codex to its configured provider. It disables Codex shell and subagent tools, requests read-only operation, and rejects answers with observed extra tool events. This is not filesystem isolation; other user-configured integrations may still be available to Codex.

Saved answers live in .token-saver/cache under the project, expire after 24 hours, and are bounded to 100 entries / 10 MiB. They contain answer text, which may quote source code. New state directories use mode 700 and new cache files use mode 600 on POSIX systems. Add .token-saver/ to the project's .gitignore before committing files. Use --no-cache to avoid saved answers.

Cache identity includes the full eligible-source fingerprint, exact question and selected context, model argument, prompt version, Codex version and global config.toml contents. External provider behavior and instructions stored in other files are not fingerprinted; clear the cache after changing them.

~~~sh
token-saver cache info /path/to/project
token-saver cache clear /path/to/project
~~~

In interactive mode, unchanged source contents are reused in memory after checking file metadata. Filesystem metadata and ignore rules are checked on each question; this is not a persistent search index.

## Tests and reproducible benchmark

~~~sh
npm test
npm run benchmark
npm run evaluate
npm pack --dry-run
~~~

Tests use a fake Codex executable and make no paid model calls. They cover scanning, budgets, ranking, imports, cache invalidation, CLI commands, JSON events, failures, cancellation and timeouts. Fake-executable integration tests run on POSIX; some are skipped on Windows. CI is configured for Node 22 and 24 on Linux and macOS.

The benchmark asks six questions against the small authored JS/Python demo and checks expected files, evidence text and prompt budgets. It reports individual results and exits unsuccessfully if an expected result is missing. It does **not** establish answer accuracy, real billing savings or general retrieval performance. Unseen repositories and human-reviewed answer comparisons remain future validation work.

## Contributing

Include a small reproduction and a focused test with bug fixes. Run the checks above before submitting a pull request. Useful next contributions include additional language import resolvers and benchmark cases from independently chosen repositories.

## Supported platforms

Supported local runtime: Node.js 22+ on macOS and Linux; CI is configured for Node 22/24 on those systems. Windows has partial test coverage and is not claimed as fully validated. The standalone replay needs a modern browser.

Codex was used to review the original implementation, build the CLI improvements, implement the workbench and write behavioral checks. Product decisions included an offline-first preview, explicit evidence labels, separate estimated/reported usage, and preserving failed comparison results.

## License

MIT — see [LICENSE](LICENSE).
