#!/usr/bin/env node
/**
 * Supabase-Storage-compatible test double for the Dockerless end-to-end stack.
 *
 * The gateway originally answered every `/storage/v1` request with 501 and the
 * note "No browser spec requires object storage". Two product flows do: a resume
 * upload is stored privately and served back through a signed link, and a manual
 * payment proof is stored the same way. Without this, the Career Documents
 * surface and the whole Activation Center submission path could not be clicked
 * through at all, so the browser suite would have proved nothing about them.
 *
 * Only the object surface those two pipelines use is implemented:
 *
 *   POST   /storage/v1/object/{bucket}/{path}        upload
 *   PUT    /storage/v1/object/{bucket}/{path}        upsert
 *   GET    /storage/v1/object/{bucket}/{path}        download
 *   DELETE /storage/v1/object/{bucket}               remove, body { prefixes }
 *   POST   /storage/v1/object/sign/{bucket}/{path}   create a signed URL
 *   GET    /storage/v1/object/sign/{bucket}/{path}   follow a signed URL
 *
 * Objects are written under the git-ignored `.localdb/storage/` directory, so a
 * `reset` can clear them with the rest of the throwaway state. This is test
 * tooling: there is no authorization model beyond "the path is the key", which
 * is exactly what the API under test already enforces through its own
 * permission checks before it ever reaches storage.
 */

import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';

const contentTypes = {
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function guessContentType(path) {
  const index = path.lastIndexOf('.');
  if (index === -1) return 'application/octet-stream';
  return contentTypes[path.slice(index).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolves a bucket-relative object path to a file inside the store.
 *
 * A traversal attempt is refused rather than normalised away, because a test
 * double that quietly writes outside its own directory is worse than one that
 * fails.
 */
function resolveObject(root, bucket, objectPath) {
  const target = resolve(root, bucket, normalize(objectPath).replace(/^([/\\])+/u, ''));
  if (target !== root && !target.startsWith(`${root}${sep}`)) return null;
  return target;
}

export function createStorageServer({ root }) {
  mkdirSync(root, { recursive: true });

  return createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(request.url ?? '/', 'http://storage.local');
    const segments = url.pathname.split('/').filter(Boolean);
    // `storage-js` calls `/storage/v1/object/sign/...`; the gateway strips the
    // `/storage/v1` prefix before forwarding, and a direct call keeps it. Slicing
    // from `object` makes both shapes the same list, so the signed-URL route is
    // `object/sign/{bucket}/{path}` and the object routes are
    // `object/{bucket}/{path}`.
    const start = segments.indexOf('object');
    const rest = start === -1 ? segments : segments.slice(start);
    const method = (request.method ?? 'GET').toUpperCase();

    if (rest[1] === 'sign') {
      const bucket = rest[2] ?? '';
      const objectPath = rest.slice(3).join('/');
      const file = resolveObject(root, bucket, objectPath);
      if (!bucket || !file) return sendJson(response, 400, { message: 'Invalid object path' });

      if (method === 'POST') {
        // storage-js prefixes this value with its own base URL, so the relative
        // form is what the client expects back.
        return sendJson(response, 200, {
          signedURL: `/object/sign/${bucket}/${objectPath}?token=local-e2e-signed-url`,
        });
      }
      if (method === 'GET') {
        if (!existsSync(file)) return sendJson(response, 404, { message: 'Object not found' });
        const bytes = readFileSync(file);
        response.writeHead(200, {
          'content-type': guessContentType(objectPath),
          'content-length': bytes.length,
        });
        response.end(bytes);
        return;
      }
      return sendJson(response, 405, { message: 'Method not allowed' });
    }

    if (rest[0] !== 'object') {
      return sendJson(response, 404, { message: 'Not found' });
    }

    const bucket = rest[1];
    const objectParts = rest.slice(2);
    if (!bucket) return sendJson(response, 400, { message: 'A bucket is required' });

    if (objectParts.length === 0 && method === 'DELETE') {
      let prefixes = [];
      try {
        const parsed = JSON.parse(body.toString('utf8') || '{}');
        if (Array.isArray(parsed.prefixes)) prefixes = parsed.prefixes;
      } catch {
        return sendJson(response, 400, { message: 'Invalid removal body' });
      }
      const removed = [];
      for (const prefix of prefixes) {
        const file = resolveObject(root, bucket, String(prefix));
        if (!file || !existsSync(file)) continue;
        rmSync(file, { force: true });
        removed.push({ name: String(prefix) });
      }
      return sendJson(response, 200, removed);
    }

    const objectPath = objectParts.join('/');
    const file = resolveObject(root, bucket, objectPath);
    if (!file) return sendJson(response, 400, { message: 'Invalid object path' });

    if (method === 'POST' || method === 'PUT') {
      const upsert = request.headers['x-upsert'] === 'true';
      if (!upsert && existsSync(file)) {
        return sendJson(response, 409, {
          statusCode: '409',
          error: 'Duplicate',
          message: 'The resource already exists',
        });
      }
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, body);
      return sendJson(response, 200, { Key: `${bucket}/${objectPath}` });
    }

    if (method === 'GET' || method === 'HEAD') {
      if (!existsSync(file)) {
        return sendJson(response, 400, {
          statusCode: '404',
          error: 'not_found',
          message: 'Object not found',
        });
      }
      const bytes = readFileSync(file);
      response.writeHead(200, {
        'content-type': guessContentType(objectPath),
        'content-length': bytes.length,
      });
      response.end(method === 'HEAD' ? undefined : bytes);
      return;
    }

    return sendJson(response, 405, { message: 'Method not allowed' });
  });
}

/** Clears every stored object, so a reset starts from empty storage. */
export function clearStorage(root) {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
}

if (process.argv[1]?.endsWith(join('e2e', 'storage-server.mjs'))) {
  const index = process.argv.indexOf('--root');
  const root = index === -1 ? join(process.cwd(), '.localdb', 'storage') : process.argv[index + 1];
  const portIndex = process.argv.indexOf('--port');
  const port = portIndex === -1 ? 0 : Number(process.argv[portIndex + 1]);
  const server = createStorageServer({ root });
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`storage listening on ${server.address().port}\n`);
  });
}
