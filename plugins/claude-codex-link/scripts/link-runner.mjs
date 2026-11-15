import { existsSync } from 'node:fs';
import { uptime } from 'node:os';
import { join } from 'node:path';
import { LINK_DIR, loadMessage, messagePath, messageStatus, saveState, startMessage } from './link.mjs';
import { replyMessageId, sendAntigravity } from './antigravity.mjs';
import { postToRoom } from './rooms.mjs';
import { address, queueCodex, sendClaude } from './transports.mjs';

const id = process.argv[2];
const base = { pid: process.pid, boot_started_at: Date.now() - uptime() * 1000 };

// Carbon's outbox: the sender identity is always the conversation itself.
function deliverOutbox(message) {
  return item => {
    if (item.room_id) {
      const posted = postToRoom(LINK_DIR, { room_id: item.room_id, text: item.text, in_reply_to: item.in_reply_to }, { role: 'antigravity' });
      return { room_id: posted.room_id, room_message_id: posted.id };
    }
    const sent = startMessage({ from: message.to, to: item.to, reply_to: message.to, text: item.text,
      ...(item.in_reply_to ? { in_reply_to: item.in_reply_to } : {}) });
    return { to: item.to, message_id: sent.message_id };
  };
}

function replyText(message, state) {
  if (state.status === 'accepted') {
    return `Gemini 4 Carbon finished your message ${message.id}.\n\n${state.response}`;
  }
  return `Gemini 4 Carbon could not finish your message ${message.id} (${state.error_code || state.status}): ${state.error}` +
    (state.next_step ? `\nNext step: ${state.next_step}` : '') +
    (state.journal ? `\nJournal: ${state.journal}` : '');
}

// WHY: .project-docs/decisions/carbon-worker-turns.md
// A finished Carbon turn is delivered to reply_to over the recipient's normal transport. Reply
// notifications never produce another notification, so two agents cannot ping-pong automatically.
function notifyReply(message, state) {
  if (address(message.to).provider !== 'antigravity' || message.kind === 'reply' || message.notify === false) return null;
  if (state.status === 'cancelled' || !message.reply_to || message.reply_to === message.to) return null;
  try {
    const reply = startMessage({ message_id: replyMessageId(message.id), from: message.to, to: message.reply_to,
      reply_to: message.to, in_reply_to: message.id, text: replyText(message, state).slice(0, 50_000), kind: 'reply' });
    return reply.message_id;
  } catch { return null; }
}

let message = null;
let state;
try {
  message = loadMessage(id);
  saveState(id, { ...base, status: 'sending' });
  let result;
  const { provider } = address(message.to);
  if (provider === 'claude') result = await sendClaude(message);
  else if (provider === 'antigravity') {
    result = await sendAntigravity(LINK_DIR, message, {
      cancelled: () => existsSync(join(messagePath(id), 'cancel.json')),
      deliverOutbox: deliverOutbox(message),
    });
  } else {
    if (message.delivery === 'live') throw Object.assign(new Error('Live Codex transport is not connected. No message was queued; choose queue explicitly if delayed delivery is acceptable.'), { notSent: true });
    result = await queueCodex(message);
  }
  state = { ...base, ...result, completed_at: new Date().toISOString() };
} catch (error) {
  const extra = {};
  for (const key of ['next_step', 'journal', 'attempts', 'denied', 'outbox', 'recovered', 'transport', 'transport_id']) {
    if (error[key] !== undefined) extra[key] = error[key];
  }
  const status = error.status === 'cancelled' ? 'cancelled' : error.notSent ? 'failed' : error.status || 'unknown';
  state = { ...base, status, error: error.message, ...(error.code && typeof error.code === 'string' && !error.code.startsWith('E') ? { error_code: error.code } : {}),
    ...extra, completed_at: new Date().toISOString() };
}
saveState(id, state);
if (message) {
  const replyId = notifyReply(message, { ...state, ...messageStatus(id), response: state.response });
  if (replyId) saveState(id, { ...state, reply_message_id: replyId });
}
