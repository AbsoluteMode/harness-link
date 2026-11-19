---
id: codex-wake
type: decision
title: Waking an idle Codex chat by loading it after the message is queued
summary: After thread/queue/add, Harness Link waits for a Codex process that already has the chat, then loads the chat itself with thread/resume, starts a paused queue, watches the turn that holds the message and delivers its final answer to reply_to; a chat that is running a turn is only queued.
status: observed
tags: [codex, delivery, wake-up, queue, app-server, resume, reply, lock, desktop]
canonical_for: [codex-wake]
verified_at: 2026-11-20
sources:
  - type: repository
    reference: plugins/claude-codex-link/scripts/transports.mjs
    confirmed_at: 2026-11-20
  - type: repository
    reference: plugins/claude-codex-link/scripts/link-runner.mjs
    confirmed_at: 2026-11-20
  - type: repository
    reference: plugins/claude-codex-link/scripts/test-link.mjs
    confirmed_at: 2026-11-20
  - type: url
    reference: https://github.com/openai/codex/issues/58421
    confirmed_at: 2026-11-20
  - type: trace
    reference: Live runs against disposable Codex chats with codex-cli 0.159.2 and 0.170.0 on 2026-11-19..20, described under What was tested.
    confirmed_at: 2026-11-20
related: [../processes/session-link.md, claude-mailbox-delivery.md, carbon-worker-turns.md]
---

# Waking an idle Codex chat by loading it after the message is queued

## Context

A message to Codex was only written to the chat's queue. Nothing ran it until
the owner typed in that chat, so an agent could not get an answer from Codex
without a human. On 2026-11-19 two test messages stayed `queued` for more than
14 hours. The owner asked for the harnesses to talk without him.

## Decision

1. **Queue, then wait for an owner.** After `thread/queue/add` the runner
   polls for 15 seconds (`CLAUDE_CODEX_LINK_CODEX_GRACE_MS`). If the message
   leaves the queue or its turn appears, another Codex process has the chat and
   this runner only watches.
2. **Otherwise load the chat.** The runner calls `thread/resume` in its own
   `codex app-server` and stays alive. Codex then runs the queue of a loaded
   chat by itself.
3. **Start a paused queue.** If no turn starts within three seconds the runner
   calls `thread/queue/start` for its message. Codex keeps the queue paused
   after an interrupted turn.
4. **Watch the turn that holds the message.** It is found by the message UUID
   inside the user item. When it ends, the last agent message is the response:
   status `accepted`, transport `codex-wake` (or `codex-queue` when another
   process ran it). A failed or interrupted turn is `error` with
   `codex_turn_<status>`; a turn longer than 60 minutes is interrupted with
   `codex_turn_timeout`.
5. **Deliver the answer.** A watched turn is sent to `reply_to` as a
   `kind: reply` message, like a Carbon turn. The envelope tells Codex that its
   final message is delivered by itself, so it does not also call `link_send`.
   Reply notifications never produce another notification.
6. **Do not touch a running chat.** If the newest turn is `inProgress`, the
   message is only queued. `delivery: live` refuses before queueing when the
   chat is running or cannot be woken.
7. **One runner per chat.** `codex/<thread UUID>/wake.lock` in the data
   directory serializes runners, so two messages never load one chat twice.
8. `CLAUDE_CODEX_LINK_CODEX_WAKE=off` restores queue-only delivery.

## Why

- The queue RPC is the only supported write to an existing chat, and Codex
  itself starts a loaded chat's queue. Loading the chat is the missing step.
- The runner already outlives the MCP server and watches Carbon turns, so the
  same process can hold the app-server for the length of a turn.
- Matching the turn by message UUID does not depend on queue order, older
  queued messages, or which process ran the turn.
- Approval requests are still refused by the RPC client: the runner grants
  nothing on the owner's behalf.

## What was tested

- New chat, `queue/add` in the process that created it: the turn started by
  itself and ended in 8.7 s.
- New process, chat not loaded, `queue/add` and `queue/start`: nothing ran;
  `queue/start` answered "resume the thread before starting a queued message".
- New process, `thread/resume`: the queue ran by itself in 8.9 s.
- The branch code against a disposable chat whose last turn had been
  interrupted: the queue stayed paused for the whole minute the first version
  waited, then `queue/start` ran the message. The nudge was moved to three
  seconds; later sends ended in 26 to 27 s, of which 15 s is the grace period.
  Each answer reached the sending Claude session as a reply notification.
- Codex answered the peer text with the chat's earlier instruction, not the new
  request: the envelope marks peer text as not a human instruction, and Codex
  followed that.
- Seven scenario tests with a fake app-server cover wake-up, reply delivery,
  a reply that wakes Codex without another notification, two messages to one
  chat, a chat another process runs, a running chat with `live`, a paused
  queue, a failed turn, a timeout, a chat that will not load and an older Codex.

## Limits

- **Not tested: a chat open in Codex Desktop.** If Desktop has the chat loaded
  and idle and does not take the queued message within the grace period, the
  runner loads the same chat in a second process. Desktop may not show that
  turn until it reloads the chat, and a human typing there at the same moment
  writes to the same chat. This replaces the earlier rule "never start a second
  headless process over a live Desktop conversation"; the owner accepted it on
  2026-11-20 and it needs a check with Desktop open.
- The turn runs with the chat's saved sandbox and approval settings. A step
  that needs approval is refused.
- `thread/queue/*` is an experimental app-server API. A Codex without
  `thread/turns/list` or `thread/queue/list` is queued without a wake-up.
- A runner killed during the turn leaves the receipt `unknown`.

## Rejected

- **Manual wake-up by the owner:** the same work as sending the message
  himself.
- **Codex Desktop's own socket (`ipc/ipc.sock`):** the turn would run in the
  window, but the protocol is undocumented.
- **`turn/start` instead of the queue:** skips messages already queued and
  loses the persisted queue item if the runner dies before the turn starts.
- **Loading the chat without a grace period:** a certain second process for
  every chat a Codex process already has.
- **`link_open_codex` managed workers:** a new feature; does not reach existing
  chats.

2026-11-20.
