#!/usr/bin/env node
/**
 * Local email capture for the Dockerless end-to-end stack.
 *
 * Production sends through Supabase Auth (signup confirmation, password
 * recovery, password-change notification) and, for application mail, through
 * `@hanaply/email`. `pnpm e2e` runs without Docker, so there is no Mailpit: this
 * module replaces it with a dependency-free capture that speaks Mailpit's HTTP
 * API and keeps every message in a JSON-lines file under `.localdb/`.
 *
 * The store is a plain file (`mailbox.jsonl`) so that every process in the stack
 * can write to it without coordinating: the GoTrue test double appends the
 * authentication emails it renders, and the API process appends whatever its
 * capture email provider renders (`EMAIL_CAPTURE_FILE`). Tests read through the
 * Mailpit-compatible endpoints, so `tests/e2e/mailpit.ts` is unchanged.
 *
 * Record shape (one JSON object per line):
 *   { id, from: { name, address }, to: [{ name, address }], subject,
 *     text, html, createdAt, templateId }
 *
 * This is a test double. It never sends mail and must never be used outside
 * `pnpm e2e`.
 *
 * Usage: node tooling/e2e/mailbox.mjs --port <port> --file <path>
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const defaultSender = { name: 'Hanaply', address: 'no-reply@hanaply.test' };

/** Appends one captured message to the store. Safe for concurrent appenders. */
export function appendEmail(file, message) {
  const record = {
    id: message.id ?? randomUUID(),
    from: message.from ?? defaultSender,
    to: message.to ?? [],
    subject: message.subject ?? '(no subject)',
    text: message.text ?? '',
    html: message.html ?? '',
    createdAt: message.createdAt ?? new Date().toISOString(),
    templateId: message.templateId ?? null,
  };
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

/** Reads every complete record currently in the store, oldest first. */
export function readMailbox(file) {
  let contents;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const messages = [];
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed));
    } catch {
      // A torn final line can only come from a concurrent writer mid-append.
      // The next read sees the completed record.
    }
  }
  return messages;
}

export function clearMailbox(file) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '', 'utf8');
}

/**
 * Mailpit encodes addresses as `{ Name, Address }`. `tests/e2e/mailpit.ts` reads
 * `message.To[].Address`, so the capture must use exactly that shape.
 */
function mailboxAddress(address) {
  return { Name: address?.name ?? '', Address: address?.address ?? '' };
}

function summary(message) {
  return {
    ID: message.id,
    MessageID: message.id,
    Read: true,
    From: mailboxAddress(message.from),
    To: (message.to ?? []).map(mailboxAddress),
    Cc: [],
    Bcc: [],
    ReplyTo: [],
    Subject: message.subject,
    Created: message.createdAt,
    Size: Buffer.byteLength(message.html ?? '', 'utf8'),
    Attachments: 0,
  };
}

function detail(message) {
  return {
    ...summary(message),
    Date: message.createdAt,
    Text: message.text,
    HTML: message.html,
    Tags: message.templateId ? [message.templateId] : [],
  };
}

function send(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

export function createMailboxServer({ file }) {
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://mailbox.local');
    const messages = readMailbox(file);

    if (url.pathname === '/api/v1/messages' && request.method === 'DELETE') {
      clearMailbox(file);
      send(response, 200, { deleted: messages.length });
      return;
    }
    if (url.pathname === '/api/v1/messages' && request.method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? '50');
      const start = Number(url.searchParams.get('start') ?? '0');
      const ordered = [...messages].reverse();
      const page = ordered.slice(
        Number.isFinite(start) && start > 0 ? start : 0,
        (Number.isFinite(start) && start > 0 ? start : 0) + (Number.isFinite(limit) ? limit : 50),
      );
      send(response, 200, {
        total: messages.length,
        unread: 0,
        count: page.length,
        start: Number.isFinite(start) ? start : 0,
        messages: page.map(summary),
      });
      return;
    }
    if (url.pathname.startsWith('/api/v1/message/') && request.method === 'GET') {
      const id = decodeURIComponent(url.pathname.slice('/api/v1/message/'.length));
      const message = messages.find((candidate) => candidate.id === id);
      if (!message) {
        send(response, 404, { error: 'message not found' });
        return;
      }
      send(response, 200, detail(message));
      return;
    }
    if (url.pathname.startsWith('/api/v1/message/') && request.method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.slice('/api/v1/message/'.length));
      const remaining = messages.filter((candidate) => candidate.id !== id);
      writeFileSync(
        file,
        remaining.map((message) => `${JSON.stringify(message)}\n`).join(''),
        'utf8',
      );
      send(response, 200, { deleted: messages.length - remaining.length });
      return;
    }
    if (url.pathname === '/api/v1/info' && request.method === 'GET') {
      send(response, 200, { Version: 'hanaply-e2e-capture', Messages: messages.length });
      return;
    }
    if (url.pathname === '/health') {
      send(response, 200, { status: 'ok' });
      return;
    }
    send(response, 404, { error: `unsupported mailbox route ${request.method} ${url.pathname}` });
  });
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = argument('--file', '.localdb/mailbox.jsonl');
  const port = Number(argument('--port', '0'));
  if (argument('--clear', null) !== null) {
    rmSync(file, { force: true });
  }
  const server = createMailboxServer({ file });
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`mailbox listening on ${port}\n`);
  });
}
