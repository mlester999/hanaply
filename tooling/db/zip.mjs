/**
 * Minimal zip reader for the local harnesses.
 *
 * Both `tooling/db/local-cluster.mjs` (pgTAP) and the end-to-end stack
 * (PostgREST on Windows) provision a tool from a GitHub release archive. Reading
 * the archive directly keeps the harnesses dependency-free: no `unzip`, no
 * `tar`, no container runtime. Only the two compression methods those releases
 * use are supported — stored (0) and deflate (8).
 */

import { inflateRawSync } from 'node:zlib';

export function readZipDirectory(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66_000); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error('zip central directory not found');
  }
  const total = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < total; i += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('zip central directory entry is malformed');
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    entries.push({ name, method, compressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function readZipEntry(buffer, entry) {
  const offset = entry.localOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error('zip local header is malformed');
  }
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const payload = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) {
    return Buffer.from(payload);
  }
  if (entry.method === 8) {
    return inflateRawSync(payload);
  }
  throw new Error(`zip compression method ${entry.method} is unsupported`);
}
