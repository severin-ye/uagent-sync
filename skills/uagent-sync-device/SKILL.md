---
name: uagent-sync-device
description: Register computers, inspect workspace coverage, and transfer Codex personal profiles through a configurable private GitHub registry. Use for switching computers or syncing device environments.
---

# Multi-device workspace handoff

Use the installed `uagent-sync device` CLI, or `node <verified-source>/dist/cli.js device` when using a built checkout. Read `device help` for current options. Device names and paths come from registration, never hardcode a particular user's machines.

## Identify and inspect

`device list` reads the local connection and shared device records. If unregistered, use `device register --registry <local-private-config-checkout> --remote <GitHub-url> --name <alias> --workspace-id <stable-id> --workspace-root <local-path>`. An optional `--connection <file>` isolates the machine identity. Each computer registers itself; never copy one machine's local connection over another.

`device audit` examines all ordinary workspace files, including ignored/untracked content, and reports dependencies, credential file names, large files and Git status. It does not read document contents or upload files. Its success means the audit ran, not that every file is available on GitHub.

## Codex personal files

`device snapshot` creates a new immutable profile in the registry. It covers supported Codex config fields, AGENTS.md, rules, local skills, and memory files; it also covers `.agents/skills`. Read the reported exclusions. Source links or detected secrets can block collection; resolve each cause without silently omitting requested memories or modifying original text.

`device restore --snapshot <directory>` previews target changes without writing. `--apply` backs up overwritten files and applies the profile. Existing differing content with no baseline conflicts by default. `--prefer-source` is for an explicitly source-authoritative first migration only, never a permanent conflict override. Subsequent restores compare source and local changes against the successful baseline. Source deletions are retained and reported, not silently propagated.

These commands do not install plugins, rebuild project environments or copy the workspace itself. Keep `environmentComplete=false` meaningful: extension installation, missing sources, project transfer, credentials and actual target runtime checks must be handled before reporting a complete environment. Preserve historical sessions as optional; this profile does not transfer SQLite, sessions, authentication, host trust or live plugin state.

## Registry transport

`device publish --path sync/devices/<id>.json --path sync/profiles/<id>/<snapshot>` publishes only explicit device/profile paths. It verifies the configured origin and PRIVATE visibility, scans candidate files for known secret patterns, rejects staged changes or divergence, and never force-pushes. Secret scanning is a heuristic, not proof that arbitrary content is safe. Publish only within the user's authorized scope.

`device fetch` requires a clean registry and uses fast-forward pull. Local edits or remote divergence require reconciliation. `device reconnect --registry <new-checkout> --remote <url>` changes storage while preserving the local device identity; the destination registry must contain that identity.

## Personal workflow integration

If Severin Skill is present, use its task continuity records as the handoff context. Store device registration and synchronization algorithms only in U同步; do not make a second list or copy sync logic into the personal plugin. Verify results on the receiving computer and one return trip before declaring cross-device operation complete.
