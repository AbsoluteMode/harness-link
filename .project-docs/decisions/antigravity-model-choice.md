---
id: antigravity-model-choice
type: decision
title: Antigravity model choice with Gemini 4 Neon as the default
summary: link_open_antigravity takes an optional model (short name or full agy id), checked against agy models at open and fixed for the conversation; the default moves from gemini-4-carbon-high to gemini-4-neon-high, and records without a model keep Carbon.
status: observed
tags: [antigravity, neon, carbon, agy, model, default, migration]
canonical_for: [antigravity-model-choice]
verified_at: 2026-11-24
sources:
  - type: user-confirmed
    reference: The owner decided on 2026-11-24 to move Antigravity work from Carbon to Neon because of Carbon limits, and approved adding model choice to Harness Link.
    confirmed_at: 2026-11-24
  - type: repository
    reference: plugins/claude-codex-link/scripts/antigravity.mjs
    confirmed_at: 2026-11-24
  - type: repository
    reference: plugins/claude-codex-link/scripts/test-link.mjs
    confirmed_at: 2026-11-24
  - type: trace
    reference: Live runs with agy 1.5.16 on 2026-11-24 against an isolated CLAUDE_CODEX_LINK_DIR, described under Rationale.
    confirmed_at: 2026-11-24
related: [../processes/session-link.md, carbon-workspace-modes.md, carbon-worker-turns.md]
---

# Antigravity model choice with Gemini 4 Neon as the default

## Context

Every Link-managed Antigravity turn ran `agy --model gemini-4-carbon-high`; the
model was a constant. Carbon limits ran out, and the owner decided to move
Antigravity work to Gemini 4 Neon and use it more often. Without a model
parameter the only way to reach Neon was a direct `agy -p --model ...` run,
which the owner's rule (agents talk to other agents only through Link)
forbids.

## Decision

- `link_open_antigravity` (CLI `open-antigravity --model`) takes an optional
  `model`. Without it the model is `gemini-4-neon-high`.
- Accepted forms: a short name `neon`, `carbon`, `argon` or `hydrogen` with an
  optional level `-low|-medium|-high|-xhigh` (level `high` by default), with or
  without the `gemini-4-` prefix, case-insensitive; or any full id.
- At open the id is checked against `agy models` (one `spawnSync`, 20 s
  limit). An id that is not listed fails before any record is created, with the
  full available list and the short-name rule.
- If `agy models` fails or times out, the conversation is opened with
  `model_verified: false` and a `warning`. Conversations already open never call
  `agy models`; their sends use the stored model.
- The model id and its label are stored in `session.json` and passed as
  `--model` on every turn. The init event must confirm the same id, otherwise
  the turn fails with `model_mismatch` and the conversation is blocked (the
  existing rule, now against the stored model instead of the constant).
- `link_sessions` / `link_read` show `model`, `model_label` and
  `last_resolved_model`; `link_status` shows `conversation_model` and, after a
  response, `resolved_model` taken from the init event.
- A record without `model` (opened before 0.11.0) is read as
  `gemini-4-carbon-high`, the model it was started with. No file is rewritten.
- The default name is the model label without the level, for example
  "Gemini 4 Neon".
- Error codes `carbon_error` and `carbon_unavailable` keep their names for
  compatibility; their texts no longer name Carbon.
- Rooms are unchanged: Link does not start an Antigravity participant in a
  room. Antigravity posts to rooms from its own app session through the native
  plugin, where the user picks the model in Antigravity.

## Rationale

Level `high` for the default: Carbon has always run at `high`
(`gemini-4-carbon-high`), so Neon at `high` keeps the same reasoning level;
`xhigh` exists only for Neon and Hydrogen and stays available by name.

Checking at open moves a typo from the first send (a failed turn after agy
starts) to the call that chose the model. Accepting unverified when `agy
models` is down keeps Link usable offline; the first send then fails
cleanly with `carbon_unavailable` or `model_mismatch` if the model is wrong.

Reading a missing `model` as Carbon instead of the new default keeps a
conversation on the model whose native context it holds: switching it to Neon
would resume a Carbon conversation under another model, and the init check
would block it.

Live runs with agy 1.5.16 on 2026-11-24, isolated `CLAUDE_CODEX_LINK_DIR`,
one short advisory message each:

- opened without `model`: `--model gemini-4-neon-high`, init confirmed
  `gemini-4-neon-high`, response in 12 s, `resolved_model`
  `gemini-4-neon-high`;
- opened with `model: carbon`: init confirmed `gemini-4-carbon-high`,
  response in 13 s;
- `model: carbon-xhigh` failed at open with the 27 listed models.

`agy models` prints "Fetching available models..." on stderr and
`<id>\t<label>` lines on stdout.

## Alternatives

- A model parameter on `link_send`: one address would answer with different
  models and mix native contexts; rejected, the model stays per conversation
  like workspace and mode.
- Validate on first send only: the error would arrive after the caller already
  shared the address.
- Refuse to open when `agy models` is unavailable: an outage of the listing
  would block new work even with a correct model.
- Rewrite old records with `model: gemini-4-carbon-high`: the read-time default
  gives the same result without touching files another runner may hold.
- Keep a hard-coded allow-list of models: agy's catalog changes; `agy models`
  is the source of truth.

## Consequences

Callers that relied on Carbon by default now get Neon; they pass
`model: carbon` to keep Carbon. Not tested: `agy models` on a signed-out
account (the offline path was tested with a fake CLI only).

## Resolution

Implemented in version 0.11.0 on branch
`claude/elated-proskuriakova-a05e96`.
