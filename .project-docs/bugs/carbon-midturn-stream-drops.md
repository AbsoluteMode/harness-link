---
id: carbon-midturn-stream-drops
type: bug
title: Carbon turns drop after transient agy 503 retries, leaked hook pipes, or stale MCP servers
summary: Mid-turn 503 stream interruptions latched an error status in agy even after internal retry succeeded, leaked hook or child stdio descriptors could block close, and long-lived MCP servers kept spawning older cached link runners.
status: observed
tags: [antigravity, carbon, agy, stream-json, http-503, retry, pipes, mcp, cache, link-runner]
canonical_for: [carbon-midturn-stream-drops]
verified_at: 2026-11-16
sources:
  - type: repository
    reference: plugins/claude-codex-link/scripts/antigravity.mjs
    confirmed_at: 2026-11-16
  - type: repository
    reference: plugins/claude-codex-link/scripts/link.mjs
    confirmed_at: 2026-11-16
  - type: repository
    reference: plugins/claude-codex-link/scripts/transports.mjs
    confirmed_at: 2026-11-16
  - type: trace
    reference: Local agy 1.5.9 CLI log cli-20261116_032543.log and conversation c28afc19-c263-4f52-8fa3-6a0a9593db3d on 2026-11-16.
    confirmed_at: 2026-11-16
related: [../decisions/carbon-worker-turns.md, ../processes/session-link.md]
---

# Carbon turns drop after transient agy 503 retries, leaked hook pipes, or stale MCP servers

## Symptoms

- A `review` turn (`fac31f88-f36c-450b-9f66-c861892a9bca`, native conversation
  `c28afc19-c263-4f52-8fa3-6a0a9593db3d`) ran for 6 minutes 42 seconds, wrote a
  complete 9,647-character final `PLANNER_RESPONSE` at step 42, yet ended as a
  failed/unknown turn without returning Carbon's text.
- Long-lived Claude Code sessions started before a plugin update continued
  spawning `0.7.0/scripts/link-runner.mjs`, which lacked turn journals,
  recovery, and automatic `reply_to` notifications.
- `agy` hooks or background child processes that keep inherited `stdout` or
  `stderr` descriptors open (`exec: WaitDelay expired before I/O complete` in
  `cli-20261116_032543.log` and `cli-20261116_033552.log`) can prevent Node's
  `close` event from firing after `agy` exits.

## Root causes

1. **Latched mid-turn `ERROR_MESSAGE` in `agy` 1.5.9.** At step 40 of
   `c28afc19`, the upstream model stream returned HTTP 503 (`UNAVAILABLE`).
   `agy` recorded step 41 (`ERROR_MESSAGE`: `Error: The stream was interrupted.
   Please continue the task you were working on.`), retried 4 seconds later,
   and completed step 42 (`PLANNER_RESPONSE`, `DONE`, 9,647 characters). Print
   mode still reported a turn error because an error step had appeared during
   the turn, and `classify()` rejected any run whose exit code or `result.status`
   was non-success.
2. **No automatic continuation on unrecovered transient stream errors or empty
   replies.** When `agy` exited on a transient `UNAVAILABLE` / `INTERNAL`
   failure before finishing, or returned an empty `SUCCESS` response without a
   permission denial, Harness Link aborted the turn immediately instead of
   continuing the saved `--conversation` once.
3. **Waiting only on `close` in `runAgy`.** `stop()` did not signal tracked
   descendant process groups, and `runAgy` resolved only on `child.once('close')`.
   Any grandchild keeping `stdout` or `stderr` open after `agy` exited would
   stall completion indefinitely.
4. **Static `RUNNER` path in `link.mjs` and unbounded `run()` in
   `transports.mjs`.** Long-lived MCP servers resolved `link-runner.mjs`
   relative to their own startup cache directory instead of the newest
   installed semver cache entry, and `run()` had no timeout for courier CLI
   invocations.

## Fix

Implemented in version `0.8.1`:

- `runAgy` tracks `agent_response` completion (`DONE` with `usage` or
  `duration_seconds`), active tool steps, and the highest non-checkpoint step
  index. `completedText` accepts a turn whose final step is a completed
  `agent_response` with no active tools even if `agy` latched an earlier
  mid-turn stream error, while still rejecting cut-off partial streams,
  timeouts, and cancellations.
- `sendAntigravity` continues a saved native conversation once on retryable
  `carbon_error`, `agy_exited`, or `empty_response` outcomes.
- `runAgy` signals tracked descendant process groups in `stop()` and drains
  inherited stdio pipes 1.5 seconds after `child` emits `exit`.
- `resolveRunner` in `link.mjs` selects the highest semver `link-runner.mjs`
  present in a versioned plugin cache, and `run()` in `transports.mjs` bounds
  helper CLI execution with a 120-second default timeout.
