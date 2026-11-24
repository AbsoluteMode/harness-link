---
id: session-link-operations
type: process
title: Session link operations
summary: Install the renamed plugin and distinguish inbox acceptance from recipient acknowledgement.
status: observed
tags: [installation, messages, receipts, testing]
canonical_for: [session-link-operations]
verified_at: 2026-11-24
sources:
  - type: repository
    reference: plugins/claude-codex-link/scripts/transports.mjs
    confirmed_at: 2026-11-08
  - type: url
    reference: https://code.claude.com/docs/en/cross-session-messaging
    confirmed_at: 2026-11-08
  - type: url
    reference: https://learn.chatgpt.com/docs/app-server
    confirmed_at: 2026-11-08
related: [../project.md, ../decisions/antigravity-model-choice.md, ../decisions/claude-mailbox-delivery.md, ../decisions/codex-wake.md, ../decisions/carbon-workspace-modes.md, ../decisions/carbon-worker-turns.md, ../bugs/carbon-midturn-stream-drops.md, ../bugs/courier-rejections-reported-unknown.md]
---

# Session link operations

## Delivery

Claude discovery uses `claude agents --json`. Send resolves the exact UUID to
the session's pid and writes one line to its inbox socket (`<pid>.sock`); no
model runs. Without a usable socket it falls back to an isolated Opus 5.5
courier with only SendMessage, addressed by the session's unique name. Messages
remain subject to the recipient's inbound policy, and a socket write returns no
receipt. The transport receipt is `accepted`; only an explicit recipient call to
`link_ack` is `acknowledged`. When the session cannot be woken the message is
`stored` and the plugin hook hands it over on the session's next turn. Design,
evidence and limits: [Claude mailbox delivery](../decisions/claude-mailbox-delivery.md).

Codex listing, history, and queueing use the installed CLI's app-server JSONL
protocol. Queue requests include the bridge message UUID as clientUserMessageId.
An archived target is rejected. After queueing, the runner waits for a Codex
process that already has the chat, then loads an idle chat with `thread/resume`,
starts a paused queue, watches the turn that holds the message and delivers its
final answer to `reply_to`. A chat that is running a turn is only queued; `live`
refuses without queueing when the chat is running or cannot be woken.
`CLAUDE_CODEX_LINK_CODEX_WAKE=off` restores queue-only delivery. Design,
evidence and limits: [Codex wake-up](../decisions/codex-wake.md).

Messages and receipts use private files under the `.claude-codex-link` directory in the user home (0700
directories, 0600 files). They remain until explicitly removed by the owner.
`CLAUDE_CODEX_LINK_DIR` overrides this directory. Reusing a UUID with an identical
payload returns the existing receipt without retrying; a changed payload is
rejected. A confirmed failure needs a corrected send with a new UUID. Failed or
unfinished sends are hidden from the inbox; `stored` mail for Claude is shown. Unreadable records are skipped so
one interrupted writer cannot prevent reading unrelated messages. After a
lost acknowledgement, delivery is `unknown` and is never automatically retried.
A recipient acknowledgement is reported by the calling agent, not cryptographic
proof of its identity or proof that the requested work is complete.

A Link-managed Antigravity conversation has an `antigravity:<UUID>` address.
Its first send starts the native CLI conversation with the conversation's
model: `gemini-4-neon-high` by default, or the `model` given to
`link_open_antigravity` (short name or full id from `agy models`, checked at
open). Records from before 0.11.0 have no model and keep `gemini-4-carbon-high`.
Choice, validation and migration:
[Antigravity model choice](../decisions/antigravity-model-choice.md).
Subsequent sends resume the saved native ID under an exclusive per-conversation
lock; messages wait while an earlier turn runs. `link_status` includes the
response, `conversation_model`, the model verified from the CLI initialization event, live
`progress`, and on failure `error_code`, `next_step`, `journal` and
`stderr_tail`. The finished turn is delivered to `reply_to` as a `kind: reply`
message, which never triggers another notification. `link_cancel` stops a turn.
Journal, recovery, permissions and the outbox:
[Carbon worker turns](../decisions/carbon-worker-turns.md). Codex and Claude Code use the same local registry and
message records. Without a workspace the conversation is scoped to text
discussion in a private folder. `link_open_antigravity` can take an absolute
`workspace` and `mode` (`agent` by default, or `review`); both stay fixed for
the conversation. Flags and rationale:
[Carbon workspace modes](../decisions/carbon-workspace-modes.md).

## Shared rooms

Codex, Claude Code, and Antigravity can open, list, read, and post to the same
local room. The host plugin supplies its author role. Posts can reference an
existing parent in that room and become visible on the participants' next
read. In Antigravity, install the native plugin with `agy plugin install`.
Its MCP entry exposes the room tools.

## Install

The root README contains the host-specific commands. Installing under the new
identity does not migrate or delete the old plugin. Finish old consultations,
then disable the old plugin to avoid duplicate tools. Legacy `CLAUDE_ASK_*`
variables and job storage remain supported.

## Verify

Run `npm run check` and `npm test`. The default tests use fake executables and
consume no model usage. For live verification use a disposable Claude receiver
and an isolated Codex thread; do not use unrelated user conversations.

Never edit transcript or queue databases directly. A Codex chat is loaded in a
second process only by the wake-up path, after its grace period and never while
the chat is running a turn; do not resume a chat by any other means.

## Verification on 2026-11-08

The old consultation test suite and 11 new message tests pass locally. A real
Opus 5.5 courier delivered to an isolated running Claude session, which replied
from that same session. A real Codex queue message survived closing the sending
app-server and was consumed when its isolated test thread resumed. This verifies
deferred delivery, not automatic Desktop wake-up.

A second isolated Claude receiver loaded the MCP server and called `link_ack`;
the sender observed `acknowledged`. The receiver may acknowledge before the
courier finishes saving its transport receipt, so both states are retained.

## Verification on 2026-11-20

Codex wake-up was run live against disposable Codex chats with codex-cli
0.170.0: an idle chat ran the queued message and its answer reached the sending
Claude session as a reply notification in 26 to 27 seconds. A chat with a queue
paused by an interrupted turn needed `thread/queue/start`. A chat open in Codex
Desktop was not tested.
