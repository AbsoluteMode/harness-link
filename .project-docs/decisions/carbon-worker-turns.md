---
id: carbon-worker-turns
type: decision
title: Carbon worker turns, journal, recovery and reply delivery
summary: Every Carbon turn is journaled with progress; denied tool calls, timeouts, cancels and a lost runner leave the conversation resumable; agent mode gets explicit allow rules for the workspace and granted directories; finished turns are delivered to reply_to; Carbon writes to peers through an outbox directory.
status: observed
tags: [antigravity, carbon, agy, journal, progress, cancel, timeout, permissions, add_dirs, outbox, reply, notification, recovery]
canonical_for: [carbon-worker-turns]
verified_at: 2026-11-15
sources:
  - type: repository
    reference: plugins/claude-codex-link/scripts/antigravity.mjs
    confirmed_at: 2026-11-15
  - type: repository
    reference: plugins/claude-codex-link/scripts/link-runner.mjs
    confirmed_at: 2026-11-15
  - type: repository
    reference: plugins/claude-codex-link/scripts/test-link.mjs
    confirmed_at: 2026-11-15
  - type: trace
    reference: agy 1.5.9 CLI logs and conversation records of the two failed turns on 2026-11-15, and live runs described under Rationale.
    confirmed_at: 2026-11-15
related: [carbon-workspace-modes.md, ../processes/session-link.md]
---

# Carbon worker turns, journal, recovery and reply delivery

## Context

The owner sent Carbon a real task (attachment thumbnails in Command Center)
twice in agent mode. Both turns ended as `unknown` with "Antigravity did not
return a successful text response", the conversation was marked interrupted
and refused further messages, and nothing recorded why. The sender also had to
poll `link_status`, and Carbon had no way to tell anyone it was done or to ask
a question. The owner asked for Carbon to work as a full executor through
Harness Link and for agents to be able to write to each other.

## Root cause

agy's own CLI log (`antigravity-cli/log/cli-20261115_193205.log` and
`cli-20261115_195304.log` in agy's `.gemini` data directory) shows the same ending for both turns:

```
Print mode: soft-denying tool confirmation "ReadFile" at step 44
Print mode: stream input closed after 1 turn(s)
```

The conversation records show the denied step: `read_file
/tmp/cc-attach-shots/before-paste.png`, the screenshot Carbon had just rendered
with a sandboxed command. The file is outside the workspace, reading it needs a
human approval, headless print mode soft-denies it, and agy ends the turn with
`status: SUCCESS`, an empty `response`, `denied_actions: [read_file]` and exit
code 0. Harness Link treated the empty response as an unknown outcome and
blocked the conversation. The runner did not die: it saved the error itself.

A disposable reproduction showed a second, hidden problem: agy prints
`--mode auto is not available for this account; continuing in the default
mode.` In Default mode an `edit_file` inside the workspace is soft-denied the
same way, so agent mode could not edit files with its file tools at all.

## Decision

- **Journal.** Each turn writes `antigravity/<conversation>/turns/<message>/`:
  `stream.jsonl` (agy stdout, 16 MB cap), `stderr.txt` (1 MB cap),
  `agy-<attempt>.log` (agy `--log-file`, trimmed to its last 2 MB), `turn.json`
  (per attempt: agy pid, exit code, signal, result status, finished reason,
  denials, times) and `progress.json`. Files are 0600; well-known credential
  formats and `key=value` secrets are masked before writing.
- **Outcome classification.** `permission_denied`, `timeout` (agy's
  `print_timeout` or Link's backstop), `cancelled`, `agy_exited`,
  `carbon_error`, `empty_response`, `protocol_error`, `runner_lost`,
  `model_mismatch`, `conversation_mismatch`, `agy_unavailable`,
  `carbon_unavailable`. A started turn that ends without a response has
  `status: error` (or `cancelled`) with `error`, `next_step`, `journal` and
  `stderr_tail`.
- **Denied tool calls.** On an empty response with denials, Link sends Carbon
  a continuation in the same conversation naming the denied call and the
  allowed paths, at most twice. The denial itself stays in force.
- **Resumable conversation.** The native conversation ID is saved as soon as
  agy's `init` event arrives. Only a model or conversation mismatch blocks a
  conversation. A turn lock whose owner runner is dead is taken over; the
  previous message is marked `runner_lost`, a still-running agy of that turn is
  stopped, and the next prompt carries a note that the previous turn was
  interrupted (or, without a saved native ID, that its context is lost).
  A 0.7.0 `interrupted` flag is handled the same way.
- **Waiting.** A message for a busy conversation waits while the owner runner
  is alive instead of failing after 12 minutes.
- **Cancel and timeout.** `link_cancel` writes a cancel marker the runner
  polls. `timeout_minutes` (default 60 agent, 30 review, 10 advisory, max
  240) is passed as `--print-timeout`; Link's watchdog stops the process group
  30 seconds later. agy runs in its own process group, and the process groups
  of its sandboxed commands are tracked and stopped when the turn ends.
- **Permissions in agent mode.** Keep `--sandbox --mode auto` and the existing
  settings, and add `permissions.allow`: `write_file(<workspace>)` plus
  `read_file(<dir>)` and `write_file(<dir>)` for each granted directory, with
  `--add-dir` for each. Granted directories are `add_dirs` (new option of
  `link_open_antigravity`, fixed for the conversation; not `/`, the home
  directory or Link's data) and two per-conversation directories, `scratch`
  and `outbox`. Review mode gets `read_file(<dir>)` and `--add-dir` for
  `add_dirs` only. No unsandboxed mode was added.
- **Reply delivery.** When a Carbon turn ends (any outcome except a cancel),
  the runner creates a `kind: reply` message from the Carbon address to
  `reply_to` with `in_reply_to` set, using a deterministic ID, and delivers it
  through the normal transport (Claude courier to the live inbox, Codex queue,
  or another Carbon turn). `notify: false` turns it off per message. A
  `kind: reply` message never produces another notification.
- **Carbon writes to others.** In agent mode Carbon writes
  `{"to"|"room_id", "text"}` JSON files into the conversation's outbox; the
  runner polls the outbox during the turn, sends each file from the
  conversation's own address, writes `<name>.receipt.json`, and renames the
  file to `.done`. `to` must be a known peer (an address that has written to
  the conversation); at most 10 per turn. Rooms are posted with role
  `antigravity`. Answers arrive as later turns.

## Rationale

Live runs with agy 1.5.9 and `gemini-4-carbon-high`, each in a new conversation:

- `read_file` of a file in `/tmp` outside the workspace: soft-denied, turn
  ended with an empty response and `denied_actions`, exit code 0.
- `edit_file` in the workspace with the 0.7.0 flags: denied (Default mode).
  Allow rule `write_file(<workspace>/**)` and `write_file(<dir>/*)`: still
  denied. `write_file(<canonical workspace path>)`: allowed, including nested
  files. The rule must use the canonical path (`/private/tmp/...`).
- `--add-dir <dir>` plus `read_file(<dir>)`/`write_file(<dir>)`: reads and
  writes there succeeded; sandboxed commands wrote to `/tmp` without any rule.
- `--print-timeout 15s`: agy returned `finished_reason: print_timeout`, status
  `SUCCESS`, empty response, and `AGY_ERROR` with `reason: print_timeout` on
  stderr; the sandboxed `sleep` it had started survived in its own process
  group, which is why Link tracks and stops those groups.
- Through the Link CLI (conversation `f55b520c`): a five-step task edited the
  workspace file, wrote and read `/tmp/carbon-live-shots/x.txt` (`add_dirs`),
  posted to a room through the outbox mid-turn and read the receipt, hit a
  denial on `/etc/hosts`, was continued automatically and answered (2
  attempts). `link_cancel` stopped a `sleep 300` turn and its command. After
  `kill -9` of the runner mid-turn, status became `runner_lost`, the
  conversation `interrupted`, and the next message resumed the same native
  conversation and Carbon still knew the earlier edit. `timeout_minutes: 1`
  ended with `timeout` after 63 s and stopped the command.

The outbox is the simplest channel that works in a headless, MCP-denied
Carbon: it uses the file tool Carbon already has, needs no network or shell
access to Link's data, and the runner, not Carbon, decides the sender address
and checks the recipient. Delivering the final response to `reply_to`
covers the common case of "tell me when you are done" and "I have a
question" without any channel at all.

## Rejected

- Allowing Link's own MCP server inside agy (`mcp(...)` allow rule): agy
  starts the installed Harness Link plugin's room server, but opening MCP is
  broader than one directory and would let peer text reach Link tools.
- A Link CLI command Carbon runs through `run_command`: the terminal sandbox
  blocks writes to Link's data directory and the Claude courier needs the
  network and Claude's configuration directory.
- A marker in Carbon's final text that Link turns into messages: only works
  at the end of a turn, and the text is model output that a peer can steer.
- `--dangerously-skip-permissions` or no sandbox: not needed; every observed
  failure was a file tool outside the granted paths or Default mode edits.
- agy stdout written straight to a file so agy survives a dead runner: raw
  output would reach the disk before masking; the conversation is resumable
  instead.
- Automatic resend of an interrupted turn: the outcome is uncertain and the
  workspace may be half changed; the next message carries a note instead.

## Consequences

- A runner killed with `kill -9` leaves its agy to die on a broken pipe; its
  sandboxed commands may keep running until they finish, because they are no
  longer descendants Link can find.
- Reply notifications to Claude use the Opus 5.5 courier, one short Claude
  turn per notification.
- Commands that need to leave the terminal sandbox (network, writes outside
  `/tmp` and granted directories) still depend on agy; in Default mode they
  are denied and reported as `permission_denied`.

## Comments and objections

The owner has not yet reviewed this change.

## Resolution

Implemented on branch `feature/carbon-worker` (version 0.8.0); not merged at
the time of recording.

## Supersedes / superseded by

Extends [carbon-workspace-modes](carbon-workspace-modes.md); its "no
`--add-dir`" and "Auto mode approves edits" assumptions are superseded.
