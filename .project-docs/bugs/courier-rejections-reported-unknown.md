---
id: courier-rejections-reported-unknown
type: bug
title: Claude courier rejected at login was reported as unknown and the message was lost
summary: When the claude -p courier was rejected by the API before it could call SendMessage (expired login, token-refresh race), the sender got unknown with "delivery may have occurred; do not resend", so undelivered messages were never sent again. Fixed in 0.8.2 by classifying the courier's own output.
status: observed
tags: [claude, courier, send-message, oauth, authentication, unknown, failed, retry, receipts]
canonical_for: [courier-rejections-reported-unknown]
verified_at: 2026-11-16
sources:
  - type: repository
    reference: plugins/claude-codex-link/scripts/transports.mjs
    confirmed_at: 2026-11-16
  - type: repository
    reference: plugins/claude-codex-link/scripts/test-link.mjs
    confirmed_at: 2026-11-16
  - type: trace
    reference: Local Harness Link message journal for 2026-11-08..16 and the courier session transcripts Claude Code kept for those messages.
    confirmed_at: 2026-11-16
  - type: trace
    reference: Claude Code 2.1.325, claude -p --output-format stream-json run with an invalid API key on 2026-11-16; output kept as scripts/fixtures/courier-auth-rejected.jsonl.
    confirmed_at: 2026-11-16
related: [../processes/session-link.md]
---

# Claude courier rejected at login was reported as unknown and the message was lost

## Symptoms

- 45 Codex to Claude live messages were journaled on 2026-11-08..16: 31
  `accepted`, 9 `unknown`, 5 with no `state.json`.
- 8 of the 9 `unknown` were never sent. The courier transcript holds one
  synthetic assistant message with `error: authentication_failed` and no tool
  call; the text is absent from the recipient transcript.
  - 6 on 2026-11-13 14:31–14:56: "OAuth session expired and could not be
    refreshed".
  - 2 on 2026-11-12 00:48: "another Claude Code process is refreshing it". The
    next send 51 seconds after the first failure was accepted.
- The sender received `Transport exited without success; delivery may have
  occurred.` and, per the `unknown` contract, did not resend. Queue
  notifications were lost.
- The ninth `unknown` was a real ambiguity: SendMessage was issued, the run was
  interrupted, and the recipient did acknowledge the message.

## Cause

`run()` discarded stderr and rejected on a non-zero exit code before the
courier's stream-json output was parsed. A courier that could not authenticate
exits with code 1, so its output, which states that the API call was rejected
and that no tool was requested, was never read.

## Fix (0.8.2)

`classifyCourier` reads the output of every courier run, whatever the exit
code.

- `failed` requires all three: the stream ended with its own `result` event
  marked `is_error`, an assistant event carries an API `error`, and the model
  requested no tool at all. SendMessage runs only when the model requests it,
  so this proves nothing left the machine. The receipt carries `error_code`
  (`courier_auth` or `courier_api_error`), the API's text and a `next_step`.
- Anything short of that stays `unknown`: a stream cut before its `result`
  event, or any tool request before the failure. The error now includes the
  exit code and the last 300 characters of stderr.
- Only the token-refresh race is retried, twice, after 30 and 60 seconds
  (`CLAUDE_CODEX_LINK_COURIER_RETRY_MS` overrides the delays). A retry is safe
  because it follows a proven non-delivery. An expired login is not retried: it
  lasted 25 minutes in the journal and needs the human.

## Not covered

- The 5 messages of 2026-11-14 00:23–01:04 with no `state.json`: the runner
  left no trace, the cause is unknown.
- The historical courier stdout was not kept, so the classifier was verified
  against a reproduced rejection (invalid API key), not the original runs.
