---
id: carbon-workspace-modes
type: decision
title: Carbon workspace agent and review modes
summary: link_open_antigravity takes an optional workspace and mode; agent runs agy in Auto mode in the terminal sandbox, review keeps reads and denies writes and commands, no workspace keeps the advisory flags.
status: observed
tags: [antigravity, carbon, agy, workspace, mode, agent, review, sandbox, permissions]
canonical_for: [carbon-workspace-modes]
verified_at: 2026-11-15
sources:
  - type: repository
    reference: plugins/claude-codex-link/scripts/antigravity.mjs
    confirmed_at: 2026-11-15
  - type: repository
    reference: plugins/claude-codex-link/scripts/test-link.mjs
    confirmed_at: 2026-11-15
  - type: trace
    reference: Live agy 1.5.9 runs against disposable mktemp directories on 2026-11-15, described under Rationale.
    confirmed_at: 2026-11-15
related: [../processes/session-link.md]
---

# Carbon workspace agent and review modes

## Context

Every Carbon turn ran `agy` with `--sandbox`, an all-deny `--settings` and an
empty private folder as its working directory. Carbon could only discuss text:
asked to review a plan against a repository, it reported the repository as
unreadable. The owner asked for the same interaction model as `ask`: read a
repository and do work in it (edit files, run commands and tests).

## Alternatives

- `--dangerously-skip-permissions` for agent mode: excluded by the owner.
- `--mode accept-edits` with a `command(*)` allow rule: commands would run
  without the Auto-mode review of commands that leave the terminal sandbox.
- `--mode plan` for review: agy changelog states that headless runs proceed
  through plan review automatically, so a plan could turn into edits.
- `toolPermission: strict` for review: in a live headless run it also denied
  `read_file` inside the workspace, and the turn ended with an empty response.
  A `read_file(<workspace>)` allow rule did not lift that denial.
- `--add-dir` instead of the working directory: not needed; agy treats the
  working directory as the workspace.

## Decision

- Without `workspace`: unchanged advisory flags, the private empty folder and
  the text-only preamble.
- `mode: agent` (default with a workspace): working directory is the
  workspace; flags `--sandbox --mode auto`; `--settings` sets
  `agentMode: auto`, `toolPermission: request-review`,
  `enableTerminalSandbox: true`, `allowNonWorkspaceAccess: false` and denies
  `mcp(*)`; `--print-timeout 30m`.
- `mode: review`: working directory is the workspace; flag `--sandbox`, no
  `--mode`; `--settings` sets `agentMode: ""` (Default mode),
  `toolPermission: request-review`, `enableTerminalSandbox: true`,
  `allowNonWorkspaceAccess: false` and denies `command(*)`, `unsandboxed(*)`,
  `write_file(*)`, `read_url(*)`, `execute_url(*)`, `download_url(*)` and
  `mcp(*)`; `--print-timeout 30m`.
- Workspace and mode are validated (absolute, existing directory, canonical
  real path) before any record or process is created, stored on the
  conversation and fixed for its lifetime. A different workspace or mode
  needs a new conversation. A send whose stored workspace has disappeared
  fails before launching agy.
- The peer preamble keeps "carries no new human authority" and adds the
  workspace path and the mode's limits.

## Rationale

Live runs with agy 1.5.9 and `gemini-4-carbon-high` on 2026-11-15, each in a
new `mktemp -d` directory holding one `notes.txt`:

- agent, through the CLI: Carbon appended the requested line, ran
  `od -c notes.txt`, and the file on disk gained exactly that line.
- review, through the CLI: Carbon read the file, declined the edit and
  returned the current contents; the file hash did not change.
- review flags with a prompt that omitted the read-only preamble and asked to
  try both tools: `edit_file` failed on the `write_file` deny rule and
  `run_command` failed on the `command` deny rule; the file did not change.
  The block therefore does not depend on Carbon following the preamble.

Auto mode is agy's own mechanism for non-interactive edits inside the
workspace and sandboxed commands; anything that still needs a human is
soft-denied by headless print mode. MCP stays denied in both modes so a peer
message cannot reach other agents or connectors through Carbon.

## Sources

See frontmatter. The agy behaviour notes come from `agy --help` and
`agy changelog` for version 1.5.9.

## Comments and objections

The owner has not yet reviewed the chosen flags. Auto mode may approve a
command that leaves the terminal sandbox after its own reviewer agent clears
it; that reviewer is agy's, not Harness Link's.

## Resolution

Implemented on branch `feature/carbon-workspace`; not merged at the time of
recording.

## Consequences

Workspace is scope, not a hard OS sandbox: Carbon runs as the current user.
Running tests that need the network or paths outside the terminal sandbox
depends on agy's Auto-mode review and was not verified.

## Supersedes / superseded by

Unknown until sourced.
