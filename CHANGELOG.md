# Changelog

## 1.2.0

- Local browser workbench and standalone offline replay for trying the product without installation.
- Explicit per-file evidence checks and configurable budget sweeps.
- Unscored status for unlabeled questions and warnings when source evidence is lost.
- Two uncached, explicitly modeled Codex runs for answer and usage comparisons.
- Partial failure reports, source fingerprints, and provider thread IDs when available.
- Loopback-only server, same-origin checks, request limits and embedded-source escaping.
- Behavioral tests for the new workflows.

## 1.1.0

- Installable token-saver command with offline context, ask, doctor, and cache commands.
- Whole-prompt o200k_base token budgets, bounded line excerpts and selection reasons.
- BM25-style lexical scoring, identifier matching and one-hop local JS/TS and relative Python imports.
- Root and nested .gitignore/.tokensaverignore support; sensitive filenames, common credential patterns, binary and generated files excluded.
- File and project scan limits, no symlink traversal, and incremental source rereads during interactive use.
- Project-local persistent answers with 24-hour expiry and entry/byte bounds; code, prompt, model and global config changes invalidate the cache.
- Codex JSON event parsing, reported usage, timeout, cancellation and temporary-run cleanup.
- Behavioral tests, authored retrieval benchmark and CI configuration.
- Removed unused diff-only context modules, which were not connected to the CLI.
- Corrected package metadata to MIT and replaced the fixed model with a configurable model.
