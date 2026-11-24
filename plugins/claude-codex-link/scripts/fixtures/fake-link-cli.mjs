#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const args = process.argv.slice(2);
const claudeId = '11111111-1111-4111-8111-111111111111';
const randomConversation = () => randomUUID();
const rejectionsOf = key => existsSync(process.env.LINK_TEST_DELIVERIES) ? readFileSync(process.env.LINK_TEST_DELIVERIES, 'utf8').split('\n').filter(l => l.includes(`"key":"${key}"`)).length : 0;
const record = value => appendFileSync(process.env.LINK_TEST_DELIVERIES, JSON.stringify(value) + '\n');
if (args[0] === 'models') {
  // Shape of `agy models` 1.5.16: a progress line on stderr, then "<id>\t<label>" lines on stdout.
  process.stderr.write('Fetching available models...\n');
  if (process.env.LINK_TEST_MODE === 'agy-models-offline') {
    process.stderr.write('Error: failed to fetch models: dial tcp: lookup antigravity: no such host\n');
    process.exit(1);
  }
  for (const [id, label] of [['gemini-4-neon-high', 'Gemini 4 Neon (High)'], ['gemini-4-neon-xhigh', 'Gemini 4 Neon (XHigh)'],
    ['gemini-4-neon-low', 'Gemini 4 Neon (Low)'], ['gemini-4-carbon-high', 'Gemini 4 Carbon (High)'],
    ['gemini-4-carbon-medium', 'Gemini 4 Carbon (Medium)'], ['gemini-4-argon-high', 'Gemini 4 Argon (High)']]) console.log(`${id}\t${label}`);
  process.exit(0);
}
if (args[0] === '--model') {
  const mode = process.env.LINK_TEST_MODE;
  const conversation = args.includes('--conversation')
    ? args[args.indexOf('--conversation') + 1]
    : randomConversation();
  let line = '';
  for await (const chunk of process.stdin) line += chunk;
  const input = JSON.parse(line);
  const content = input.message.content;
  // A continuation prompt carries no message JSON; like agy, recall the conversation's last request.
  const memory = `${process.env.LINK_TEST_DELIVERIES}.${conversation}`;
  let text = existsSync(memory) ? readFileSync(memory, 'utf8') : content;
  try { text = JSON.parse(content.split('\n').at(-1)).text ?? text; writeFileSync(memory, text); } catch {}
  record({ transport: 'antigravity', args, conversation, input, cwd: process.cwd(), phase: 'start', pid: process.pid });
  const emit = value => console.log(JSON.stringify(value));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const step = (index, state, tool, parameters, extra = {}) => emit({ event: 'step_update', step_update: {
    conversation_id: conversation, step_index: index, state, step_type: 'tool', tool_name: tool, tool_info: { name: tool, parameters, ...extra } } });
  const result = (response, extra = {}) => emit({ event: 'result', result: { conversation_id: conversation, status: 'SUCCESS', response, ...extra } });
  if (mode === 'antigravity-model-unavailable') {
    emit({ event: 'result', result: { status: 'ERROR', conversation_id: '' } });
    process.exit(1);
  }
  emit({ event: 'init', conversation_id: conversation,
    init: { model: mode === 'antigravity-model-mismatch' ? 'gemini-4-argon-high' : args[1] } });
  const denial = path => {
    step(2, 'ACTIVE', 'read_file', { Path: path });
    step(2, 'ERROR', 'read_file', { Path: path }, { error: { type: 'TOOL_ERROR',
      message: `permission check failed for read_file "${path}": user denied permission for read_file(${path})\nDo not attempt to circumvent this denial.` } });
    process.stderr.write('jetski: no output produced — a tool required the "read_file" permission that headless mode cannot prompt for, so it was auto-denied.\n');
    result('', { denied_actions: [{ action: 'read_file', display_name: 'ReadFile' }] });
  };
  if (text === 'FAKE:progress') {
    for (const [i, cmd] of ['swift build', 'swift test', 'ls shots'].entries()) {
      await wait(250);
      step(i + 2, 'ACTIVE', 'run_command', { CommandLine: cmd });
      step(i + 2, 'DONE', 'run_command', { CommandLine: cmd }, { output: 'ok' });
    }
    await wait(250);
    result('Progress done');
  } else if (text === 'FAKE:deny-once' || text === 'FAKE:deny-always') {
    if (text === 'FAKE:deny-once' && content.includes('your previous tool call was denied')) result('Continued without it');
    else if (content.includes('your previous tool call was denied') && !content.includes('read_file(/private/tmp/outside.png)')) result('lost the denial detail');
    else denial('/private/tmp/outside.png');
  } else if (text === 'FAKE:exit') {
    step(2, 'ACTIVE', 'run_command', { CommandLine: 'swift build' });
    process.stderr.write('panic: boom\nAGY_ERROR: {"short_error":"boom","status":"INTERNAL","reason":"crash"}\n');
    process.exit(3);
  } else if (text === 'FAKE:hang') {
    // Like agy's sandboxed commands: a child in its own process group.
    const command = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60_000)'], { detached: true, stdio: 'ignore' });
    command.unref();
    record({ transport: 'antigravity', phase: 'command', pid: command.pid, conversation });
    step(2, 'ACTIVE', 'run_command', { CommandLine: 'sleep 999' });
    await new Promise(() => setInterval(() => {}, 60_000));
  } else if (text === 'FAKE:kill-runner') {
    step(2, 'ACTIVE', 'run_command', { CommandLine: 'swift build' });
    await wait(150);
    process.kill(process.ppid, 'SIGKILL');
    await wait(100);
    process.exit(0);
  } else if (text === 'FAKE:slow') {
    await wait(1500);
    result('Slow done');
  } else if (text === 'FAKE:secret') {
    process.stderr.write('debug token=supersecretvalue123 and Bearer abcdefghijklmnopqrstuv\n');
    step(2, 'DONE', 'run_command', { CommandLine: 'export ANTHROPIC_API_KEY=sk-ant-api03-SECRETSECRETSECRETSECRET' }, { output: 'password: hunter2hunter2' });
    result('Secret handled');
  } else if (text === 'FAKE:latched-stream-error') {
    emit({ event: 'step_update', step_update: { conversation_id: conversation, step_index: 40, state: 'DONE', step_type: 'agent_response', text_delta: '' } });
    emit({ event: 'step_update', step_update: { conversation_id: conversation, step_index: 41, state: 'DONE', step_type: 'error_message' } });
    emit({ event: 'step_update', step_update: { conversation_id: conversation, step_index: 42, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Recovered ' } });
    emit({ event: 'step_update', step_update: { conversation_id: conversation, step_index: 42, state: 'DONE', step_type: 'agent_response', text_delta: 'after 503', duration_seconds: 12.4, usage: { total_tokens: 100 } } });
    process.stderr.write('AGY_ERROR: {"short_error":"UNAVAILABLE","status":"UNAVAILABLE","retryable":true}\n');
    emit({ event: 'result', result: { conversation_id: conversation, status: 'ERROR', response: '', finished_reason: 'error' } });
    process.exit(3);
  } else if (text === 'FAKE:cutoff-stream-error') {
    if (content.includes('stream or transport error')) {
      result('Completed on continuation');
    } else {
      emit({ event: 'step_update', step_update: { conversation_id: conversation, step_index: 10, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Half of a sen' } });
      process.stderr.write('AGY_ERROR: {"short_error":"stream interrupted","status":"UNAVAILABLE","retryable":true}\n');
      emit({ event: 'result', result: { conversation_id: conversation, status: 'ERROR', response: 'Half of a sen', finished_reason: 'error' } });
      process.exit(3);
    }
  } else if (text === 'FAKE:empty-once') {
    if (content.includes('finished without a text response')) result('Summarised after empty reply');
    else result('');
  } else if (text === 'FAKE:leaked-pipe') {
    const leaked = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60_000)'], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] });
    leaked.unref();
    record({ transport: 'antigravity', phase: 'leaked', pid: leaked.pid, conversation });
    result('Pipe drained cleanly');
    process.exit(0);
  } else if (text.startsWith('FAKE:outbox:')) {
    const outbox = args.filter((a, i) => args[i - 1] === '--add-dir').find(d => d.endsWith('/outbox'));
    const items = JSON.parse(text.slice('FAKE:outbox:'.length));
    items.forEach((item, i) => writeFileSync(`${outbox}/item-${i}.json`, JSON.stringify(item)));
    const receipts = [];
    for (let i = 0; i < items.length; i++) {
      for (let n = 0; n < 100 && !existsSync(`${outbox}/item-${i}.receipt.json`); n++) await wait(50);
      receipts.push(JSON.parse(readFileSync(`${outbox}/item-${i}.receipt.json`, 'utf8')).status);
    }
    result(`Outbox ${receipts.join(',')}`);
  } else {
    await new Promise(resolve => setTimeout(resolve, 150));
    record({ transport: 'antigravity', conversation, phase: 'finish' });
    const response = args.includes('--conversation') ? 'Remembered COBALT-17' : 'Ready';
    result(response);
  }
} else if (args[0] === 'agents') {
  // A real row carries the pid that names the session's inbox socket (<pid>.sock).
  const pid = Number(process.env.LINK_TEST_CLAUDE_PID);
  const session = { sessionId: claudeId, name: 'link-fixture', cwd: '/tmp', status: 'idle', ...(pid ? { pid } : {}) };
  const rows = process.env.LINK_TEST_MODE === 'ambiguous' ? [session, { ...session, sessionId: '22222222-2222-4222-8222-222222222222' }]
    : process.env.LINK_TEST_MODE === 'claude-not-live' ? [] : [session];
  console.log(JSON.stringify(rows));
} else if (args[0] === '-p') {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const data = JSON.parse(input);
  const courierMode = process.env.LINK_TEST_MODE;
  // Shapes copied from a real `claude -p --output-format stream-json` run that failed authentication.
  const courierKey = createHash('sha256').update(data.message).digest('hex').slice(0, 16);
  const rejected = (error, text, status = 401) => {
    record({ transport: 'claude-rejected', error, key: courierKey });
    console.log(JSON.stringify({ type: 'system', subtype: 'init' }));
    console.log(JSON.stringify({ type: 'assistant', error, is_api_error_message: true, api_error_status: status, message: { model: '<synthetic>', content: [{ type: 'text', text }] } }));
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, terminal_reason: 'api_error', api_error_status: status, result: text, modelUsage: {} }));
    process.exit(1);
  };
  if (courierMode === 'courier-auth-expired') rejected('authentication_failed', 'Failed to authenticate: OAuth session expired and could not be refreshed');
  if (courierMode === 'courier-overloaded') rejected('overloaded', 'API Error: 529 Overloaded', 529);
  if (courierMode === 'courier-refresh-race' || courierMode === 'courier-refresh-race-forever') {
    const seen = rejectionsOf(courierKey);
    if (courierMode.endsWith('forever') || seen < 2) rejected('authentication_failed', 'Failed to refresh OAuth token: another Claude Code process is refreshing it. Please retry in a minute.');
  }
  if (courierMode === 'courier-crash') {
    record({ transport: 'claude-crash' });
    process.stderr.write('Error: socket hang up\n    at connResetException\n');
    process.exit(1);
  }
  record({ transport: 'claude', args, body: data.message });
  if (courierMode === 'courier-interrupted') {
    // The tool call was issued and the process died before reporting: delivery may have happened.
    console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'SendMessage', input: { recipient: data.recipient_name, content: data.message } }] } }));
    console.log(JSON.stringify({ type: 'assistant', error: 'authentication_failed', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Failed to authenticate' }] } }));
    console.log(JSON.stringify({ type: 'result', is_error: true, result: 'Failed to authenticate' }));
    process.exit(1);
  }
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'SendMessage', input: { recipient: data.recipient_name, content: data.message } }] } }));
  console.log(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: JSON.stringify({ success: true, msg_id: 'accepted-1' }) }] } }));
  console.log(JSON.stringify({ type: 'result', modelUsage: { 'claude-opus-5-5': {} }, result: 'sent' }));
} else {
  // Codex chat state shared by every fake app-server process of one test mode: the queue and the turns.
  const mode = process.env.LINK_TEST_MODE || '';
  const wakeMode = mode.startsWith('codex-');
  const chatFile = `${process.env.LINK_TEST_DELIVERIES}.${mode}.chat.json`;
  const chat = () => existsSync(chatFile) ? JSON.parse(readFileSync(chatFile, 'utf8')) : { queue: [], turns: [] };
  const save = state => writeFileSync(chatFile, JSON.stringify(state));
  const runQueue = (state, status = 'completed') => {
    for (const item of state.queue.splice(0)) {
      state.turns.unshift({ id: `turn-${item.id}`, status, items: [
        { type: 'userMessage', id: `u-${item.id}`, content: item.input },
        ...(status === 'completed' ? [{ type: 'agentMessage', id: `a-${item.id}`, text: 'working' }, { type: 'agentMessage', id: `b-${item.id}`, text: `codex answer to ${item.id}` }] : []),
      ] });
    }
  };
  const reject = (id, message) => console.log(JSON.stringify({ id, error: { code: -32600, message } }));
  for await (const line of createInterface({ input: process.stdin })) {
    const m = JSON.parse(line);
    if (m.id === undefined) continue;
    let result = {};
    if (m.method === 'thread/read') result = { thread: { id: m.params.threadId } };
    if (m.method === 'thread/list') result = { data: [{ id: claudeId, name: 'test', cwd: '/tmp', status: { type: 'notLoaded' } }], nextCursor: null };
    if (wakeMode && m.method === 'thread/turns/list') {
      if (mode === 'codex-old') { reject(m.id, 'Method not found.'); continue; }
      const state = chat();
      result = { data: mode === 'codex-busy' ? [{ id: 'turn-busy', status: 'inProgress', items: [] }, ...state.turns] : state.turns.slice(0, m.params.limit), nextCursor: null };
    }
    if (wakeMode && m.method === 'thread/queue/list') result = { data: chat().queue.map(q => ({ id: q.id, clientUserMessageId: q.id, input: q.input })), nextCursor: null };
    if (wakeMode && ['thread/resume', 'thread/queue/start', 'turn/interrupt'].includes(m.method)) {
      record({ transport: 'codex', method: m.method, mode, ...m.params });
      const state = chat();
      if (m.method === 'thread/resume' && mode === 'codex-refuses') { reject(m.id, 'Thread cannot be loaded.'); continue; }
      if (m.method === 'thread/resume' && mode === 'codex-failed') runQueue(state, 'failed');
      if (m.method === 'thread/resume' && mode === 'codex-hangs') {
        for (const item of state.queue.splice(0)) state.turns.unshift({ id: `turn-${item.id}`, status: 'inProgress', items: [{ type: 'userMessage', id: `u-${item.id}`, content: item.input }] });
      }
      if (m.method === 'thread/resume' && mode === 'codex-wake') runQueue(state);
      // After an interrupted turn the real queue stays paused until an explicit start.
      if (m.method === 'thread/queue/start' && mode === 'codex-paused') runQueue(state);
      save(state);
    }
    if (m.method === 'thread/queue/add') {
      if (process.env.LINK_TEST_MODE === 'archived') {
        reject(m.id, 'Session is archived.'); continue;
      }
      record({ transport: 'codex', ...m.params });
      if (process.env.LINK_TEST_MODE === 'disconnect') process.exit(0);
      result = { queuedSubmission: { id: m.params.clientUserMessageId } };
      if (wakeMode) {
        const state = chat();
        state.queue.push({ id: m.params.clientUserMessageId, input: m.params.input });
        // A Codex process that already has the chat open runs the queue by itself.
        if (mode === 'codex-desktop') runQueue(state);
        save(state);
      }
    }
    console.log(JSON.stringify({ id: m.id, result }));
  }
}
