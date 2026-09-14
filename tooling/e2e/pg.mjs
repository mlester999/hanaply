/**
 * Minimal PostgreSQL client for the Dockerless end-to-end stack.
 *
 * The local cluster provisioned by `tooling/db/local-cluster.mjs` authenticates
 * loopback connections with `trust`, so the GoTrue test double only needs the
 * PostgreSQL v3 frontend/backend protocol's simple query path: startup, `Q`, and
 * the row/command/error responses. Implementing it directly keeps the stack
 * dependency-free — no `pg`, no `postgres`, no container runtime.
 *
 * This is test tooling. It is deliberately small: one connection, one query at a
 * time, UTF-8 text results, and every row returned as JSON so callers never have
 * to decode the binary wire representation themselves.
 */

import { createConnection } from 'node:net';

const MESSAGE_READY = 0x5a; // Z

/** Quotes a value as a PostgreSQL literal. Never interpolate raw user input. */
export function literal(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Cannot encode a non-finite number.');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return `'${value.toISOString()}'::timestamptz`;
  if (typeof value === 'object') return `${literal(JSON.stringify(value))}::jsonb`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** Quotes an identifier (schema, table, column) for generated SQL. */
export function identifier(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function cstring(value) {
  return Buffer.concat([Buffer.from(value, 'utf8'), Buffer.from([0])]);
}

function frame(payload) {
  const header = Buffer.allocUnsafe(4);
  header.writeInt32BE(payload.length + 4, 0);
  return Buffer.concat([header, payload]);
}

function startupMessage({ user, database, applicationName }) {
  const body = Buffer.concat([
    Buffer.from([0, 3, 0, 0]),
    cstring('user'),
    cstring(user),
    cstring('database'),
    cstring(database),
    cstring('application_name'),
    cstring(applicationName),
    cstring('client_encoding'),
    cstring('UTF8'),
    Buffer.from([0]),
  ]);
  return frame(body);
}

function parseError(payload) {
  const fields = new Map();
  let offset = 0;
  while (offset < payload.length && payload[offset] !== 0) {
    const code = String.fromCharCode(payload[offset]);
    offset += 1;
    const end = payload.indexOf(0, offset);
    fields.set(code, payload.toString('utf8', offset, end === -1 ? payload.length : end));
    offset = end === -1 ? payload.length : end + 1;
  }
  const error = new Error(
    `${fields.get('S') ?? 'ERROR'}: ${fields.get('M') ?? 'unknown PostgreSQL error'}`,
  );
  error.code = fields.get('C');
  error.detail = fields.get('D');
  error.hint = fields.get('H');
  error.severity = fields.get('S');
  return error;
}

export class PostgresClient {
  #socket;
  #buffer = Buffer.alloc(0);
  #pending = null;
  #queue = Promise.resolve();
  #closed = false;

  constructor(socket) {
    this.#socket = socket;
    socket.on('data', (chunk) => {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      this.#drain();
    });
    socket.on('error', (error) => {
      this.#settle({ error });
    });
    socket.on('close', () => {
      this.#closed = true;
      this.#settle({ error: new Error('The PostgreSQL connection closed unexpectedly.') });
    });
  }

  static connect({ host = '127.0.0.1', port, user = 'postgres', database, applicationName } = {}) {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host, port });
      const client = new PostgresClient(socket);
      const onError = (error) => {
        socket.destroy();
        reject(error);
      };
      socket.once('error', onError);
      socket.once('connect', () => {
        socket.removeListener('error', onError);
        client
          .#handshake({ user, database, applicationName: applicationName ?? 'hanaply-e2e' })
          .then(() => resolve(client), reject);
      });
    });
  }

  async #handshake(parameters) {
    const ready = this.#wait();
    this.#socket.write(startupMessage(parameters));
    await ready;
  }

  #wait() {
    if (this.#pending) throw new Error('The PostgreSQL client is already executing a query.');
    return new Promise((resolve) => {
      this.#pending = { resolve, rows: [], row: null };
    });
  }

  #settle(outcome) {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    pending.resolve(outcome);
  }

  #drain() {
    // PostgreSQL frames are a one-byte tag followed by a big-endian length that
    // includes the length itself but excludes the tag.
    while (this.#pending && this.#buffer.length >= 5) {
      const tag = this.#buffer[0];
      const length = this.#buffer.readInt32BE(1);
      if (this.#buffer.length < length + 1) return;
      const payload = this.#buffer.subarray(5, length + 1);
      this.#buffer = this.#buffer.subarray(length + 1);
      this.#handle(tag, payload);
    }
  }

  #handle(tag, payload) {
    const pending = this.#pending;
    if (!pending) return;
    switch (tag) {
      case 0x44: {
        // DataRow
        const columns = payload.readInt16BE(0);
        let offset = 2;
        const values = [];
        for (let index = 0; index < columns; index += 1) {
          const size = payload.readInt32BE(offset);
          offset += 4;
          if (size === -1) {
            values.push(null);
          } else {
            values.push(payload.toString('utf8', offset, offset + size));
            offset += size;
          }
        }
        pending.rows.push(values);
        break;
      }
      case 0x45: // ErrorResponse
        // Recorded, not settled: a simple Query always ends with ReadyForQuery,
        // even when it failed. Settling here would leave that terminating frame
        // in the buffer, and because `#drain` stops once nothing is pending, the
        // next query would read it as its own completion — returning zero rows
        // for a statement that never ran. That desynchronises the connection for
        // every later query, which is how a refused DELETE turns into an
        // unrelated "rows is not iterable" failure minutes afterwards.
        pending.error = parseError(payload);
        break;
      case MESSAGE_READY:
        if (pending.error) this.#settle({ error: pending.error });
        else this.#settle({ rows: pending.rows });
        break;
      default:
        // RowDescription, CommandComplete, ParameterStatus, NoticeResponse, ...
        break;
    }
  }

  /**
   * Runs one simple query and returns the raw text rows of the last result set.
   *
   * Statements are queued: one connection carries one query at a time, and a
   * caller that issues overlapping queries (a list handler that resolves
   * related rows per item, for example) gets correct results instead of an
   * error.
   */
  query(sql) {
    const run = this.#queue.then(
      () => this.#execute(sql),
      () => this.#execute(sql),
    );
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #execute(sql) {
    if (this.#closed) throw new Error('The PostgreSQL connection is closed.');
    const ready = this.#wait();
    const message = Buffer.concat([Buffer.from('Q'), frame(cstring(sql))]);
    this.#socket.write(message);
    const outcome = await ready;
    if (outcome.error) throw outcome.error;
    return outcome.rows;
  }

  /**
   * Runs a query whose single selected column is JSON and returns the parsed
   * value. `null` when the query returned no rows or a SQL NULL.
   */
  async json(sql) {
    const rows = await this.query(sql);
    const value = rows[0]?.[0];
    return value === null || value === undefined ? null : JSON.parse(value);
  }

  /** Runs a statement and ignores any rows it returns. */
  async execute(sql) {
    await this.query(sql);
  }

  close() {
    this.#closed = true;
    this.#socket.end();
  }
}
