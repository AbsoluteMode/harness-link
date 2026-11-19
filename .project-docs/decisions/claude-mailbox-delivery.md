---
id: claude-mailbox-delivery
type: decision
title: Claude delivery through the inbox socket, with the mailbox as the source of truth
summary: Mail for a Claude session is written to the session's own inbox socket without any model; the courier is only a fallback, a wake-up that provably failed leaves the message stored in the mailbox, and a plugin hook hands stored and unknown mail to the session once.
status: observed
tags: [claude, delivery, socket, uds, courier, mailbox, stored, hook, wake-up, receipts]
canonical_for: [claude-mailbox-delivery]
verified_at: 2026-11-19
sources:
  - type: repository
    reference: plugins/claude-codex-link/scripts/transports.mjs
    confirmed_at: 2026-11-19
  - type: repository
    reference: plugins/claude-codex-link/scripts/inbox-hook.mjs
    confirmed_at: 2026-11-19
  - type: repository
    reference: plugins/claude-codex-link/scripts/test-link.mjs
    confirmed_at: 2026-11-19
  - type: url
    reference: https://code.claude.com/docs/en/cross-session-messaging
    confirmed_at: 2026-11-19
  - type: trace
    reference: Local Harness Link message journal for 2026-11-08..18, and live runs against disposable Claude Code 2.1.325 sessions on 2026-11-19, described under What was tested.
    confirmed_at: 2026-11-19
related: [../processes/session-link.md, ../bugs/courier-rejections-reported-unknown.md]
---

# Claude delivery through the inbox socket, with the mailbox as the source of truth

## Context

Every message to a Claude session went through a courier: a separate
`claude -p` run on Opus 5.5 asked to call SendMessage. Delivery therefore
needed a working login, a model request and exact obedience. In the journal for
2026-11-08..18, 15 of 55 messages to Claude had no confirmed delivery: 10
`unknown` and 5 with no state. One courier changed the recipient or the text. A
message whose courier was rejected ended as `failed` and was hidden from the
recipient's inbox.

## Decision

1. **Inbox socket first.** Claude Code 2.1.224 and later gives every session a
   Unix socket, `<sockets dir>/<pid>.sock`; `claude agents --json` reports the
   pid. Harness Link writes one line,
   `{"type":"user","session_id":…,"message":{"role":"user","content":…}}`.
   `session_id` makes Claude Code drop the line if the pid now belongs to
   another session. Only a socket owned by the current user is used.
2. **Courier as fallback only**, when a live session has no usable socket (no
   file, not a socket, nobody listening) or when
   `CLAUDE_CODEX_LINK_CLAUDE_TRANSPORT=courier` is set.
3. **The mailbox is the source of truth.** A wake-up that provably did not
   happen is `stored`, not `failed`: the message is visible in `link_inbox`, can
   be acknowledged, and the sender is told not to resend.
4. **Hook.** The Claude plugin registers `inbox-hook.mjs` on SessionStart,
   UserPromptSubmit and Stop. It shows the session its `stored` and `unknown`
   mail once (marker `surfaced.json`), at most 10,000 characters, and points to
   `link_inbox` for longer messages. On Stop it blocks the stop so the session
   continues with the message. It ignores mail older than seven days and always
   exits 0.

## Why

- The socket removes the model, the login and the network from the delivery
  path, so nothing can reword or drop the text. A live send took 153 ms.
- Claude Code itself marks a socket message as coming from another session, not
  from the user, with the same permission warning SendMessage gives. The
  recipient's inbound policy still applies.
- A socket write starts a turn in an idle session, which a hook cannot do.
- Storing instead of failing means a sender that does not retry no longer
  loses the message, and the recipient sees one copy.

## What was tested

- The line format is not in the public documentation. It was taken from the
  debug hint Claude Code 2.1.325 prints at startup and confirmed live: an idle
  disposable session started a turn and answered.
- A real send through `link-runner.mjs` reached a disposable session through
  the socket; its transcript holds the exact envelope with origin `peer`.
- A message written by a process detached from any Claude session (parent pid
  1) reached an interactive Desktop session.
- A message stored for a session that was not running was injected by the
  SessionStart hook when that session started with the plugin loaded.
- `claude plugin validate` accepts the manifest with the hooks.
- Not tested live: the UserPromptSubmit and Stop paths inside Claude Code (the
  script is covered by tests), a recipient whose inbound policy is `hold` or
  `refuse`, Windows named pipes, and a sender running inside Codex or
  Antigravity.

## Limits

- The socket returns no receipt. `accepted` means the line was written; a
  message held or refused by the recipient's policy looks the same.
- A connection that breaks after it opened is `unknown` and is never resent
  through the courier, because the line may have been read.
- The hook exists only in Claude Code sessions that load this plugin version.
- The format is undocumented and may change with Claude Code; the courier
  fallback and the mailbox keep mail from being lost if it does.

## Rejected

- **Files only, no wake-up:** an idle session never reads them.
- **Courier sending a short ping instead of the text:** still needs a model and
  a login for every message.
- **Channels or terminal multiplexer injection:** not needed once the socket
  works; not investigated.
- **Showing `failed` mail in the inbox:** the sender was told to resend, so the
  recipient would get duplicates.
- **Managed Claude workers (`link_open_claude`):** a new feature, not a fix for
  delivery; left for later.

2026-11-19. Not yet committed or released.
