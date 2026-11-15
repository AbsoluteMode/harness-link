import { chmodSync, closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync, writeSync } from 'node:fs';

// WHY: .project-docs/decisions/carbon-worker-turns.md
// The journal is for diagnosis, not an archive of secrets. Well-known credential formats and
// key=value secrets are masked before anything reaches the disk. This is a tripwire, not a guarantee.
const PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /\bsk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{16,}/g,
  /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bya29\.[0-9A-Za-z_.-]{20,}/g,
  /\bdp\.(?:st|pt|ct|sa|scim|audit)\.[A-Za-z0-9_.-]{16,}/g,
  /\bnpm_[A-Za-z0-9]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi;
const KEYED = /((?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token|authorization)[A-Za-z0-9_-]*\\?["']?\s*[:=]\s*\\?["']?)(?![0-9.]+\b)([^\s"'\\,;}{]{6,})/gi;

export function redact(text) {
  let value = String(text);
  for (const pattern of PATTERNS) value = value.replace(pattern, '[REDACTED]');
  value = value.replace(BEARER, '$1 [REDACTED]');
  return value.replace(KEYED, '$1[REDACTED]');
}

/** Append-only private file with a byte cap; bytes past the cap are counted, not written. */
export class CappedFile {
  constructor(path, limit) {
    this.path = path;
    this.limit = limit;
    this.bytes = 0;
    this.dropped = 0;
    this.fd = openSync(path, 'a', 0o600);
  }

  write(text) {
    if (this.fd === null) return;
    const buffer = Buffer.from(redact(text));
    const room = Math.max(0, this.limit - this.bytes);
    if (room > 0) {
      const part = buffer.subarray(0, room);
      writeSync(this.fd, part);
      this.bytes += part.length;
    }
    this.dropped += Math.max(0, buffer.length - room);
  }

  close() {
    if (this.fd === null) return;
    if (this.dropped) writeSync(this.fd, `\n[journal truncated: ${this.dropped} more bytes not saved]\n`);
    try { closeSync(this.fd); } catch {}
    this.fd = null;
  }
}

/** Last `lines` lines of a text file, at most `bytes` bytes, redacted. */
export function tail(path, { lines = 20, bytes = 4000 } = {}) {
  if (!existsSync(path)) return '';
  const size = statSync(path).size;
  const start = Math.max(0, size - bytes);
  const buffer = Buffer.alloc(size - start);
  const fd = openSync(path, 'r');
  let read = 0;
  try {
    while (read < buffer.length) {
      const n = readSync(fd, buffer, read, buffer.length - read, start + read);
      if (!n) break;
      read += n;
    }
  } finally { closeSync(fd); }
  const text = buffer.subarray(0, read).toString('utf8');
  return redact(text.split('\n').filter(Boolean).slice(-lines).join('\n'));
}

/** Redacts a file written by another program and keeps only its last `limit` bytes. */
export function sanitizeFile(path, limit) {
  if (!existsSync(path)) return;
  let text = readFileSync(path, 'utf8');
  if (Buffer.byteLength(text) > limit) {
    text = `[log truncated to its last ${limit} bytes]\n` + Buffer.from(text).subarray(-limit).toString('utf8');
  }
  writeFileSync(path, redact(text), { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Creates an empty private file for another program to write into (it keeps the 0600 mode). */
export function privateEmptyFile(path) {
  writeFileSync(path, '', { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}
