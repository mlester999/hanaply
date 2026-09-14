#!/usr/bin/env node
/**
 * Single-origin Supabase edge for the Dockerless end-to-end stack.
 *
 * Supabase clients are configured with one base URL and expect Supabase's
 * gateway (Kong) to route `/auth/v1`, `/rest/v1` and `/storage/v1` behind it.
 * `pnpm e2e` reproduces that routing without Docker: the published URL is this
 * gateway, which forwards
 *
 *   /auth/v1/*     → the GoTrue test double (tooling/e2e/auth-server.mjs)
 *   /rest/v1/*     → PostgREST, the same server Supabase runs, against the
 *                    throwaway local cluster
 *   /storage/v1/*  → the object-storage test double
 *                    (tooling/e2e/storage-server.mjs), which serves the resume
 *                    and payment-proof pipelines
 *
 * This is test tooling only.
 *
 * Usage: node tooling/e2e/gateway.mjs --port <port> --auth <url> --rest <url> [--storage <url>]
 */

import { createServer, request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';

function originOf(value) {
  const url = new URL(value);
  return { host: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)) };
}

function proxy(target, request, response, body, rewritePath) {
  const upstream = httpRequest(
    {
      host: target.host,
      port: target.port,
      method: request.method,
      path: rewritePath ? rewritePath(request.url ?? '/') : request.url,
      headers: { ...request.headers, host: `${target.host}:${target.port}` },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on('error', (error) => {
    const payload = JSON.stringify({ message: `Upstream unavailable: ${error.message}` });
    response.writeHead(502, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    });
    response.end(payload);
  });
  if (body.length > 0) upstream.write(body);
  upstream.end();
}

export function createGatewayServer({ authUrl, restUrl, storageUrl }) {
  const auth = originOf(authUrl);
  const rest = originOf(restUrl);
  const storage = storageUrl ? originOf(storageUrl) : null;
  return createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const pathname = new URL(request.url ?? '/', 'http://gateway.local').pathname;

    const cors = {
      'access-control-allow-origin': request.headers.origin ?? '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'access-control-allow-credentials': 'true',
      'access-control-expose-headers': '*',
    };
    if (request.method === 'OPTIONS') {
      response.writeHead(204, cors).end();
      return;
    }
    response.setHeader('access-control-allow-origin', cors['access-control-allow-origin']);
    response.setHeader('access-control-allow-credentials', 'true');

    if (pathname === '/health') {
      const payload = JSON.stringify({
        status: 'ok',
        auth: authUrl,
        rest: restUrl,
        storage: storageUrl ?? null,
      });
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      });
      response.end(payload);
      return;
    }
    if (pathname.startsWith('/auth/v1')) {
      proxy(auth, request, response, body);
      return;
    }
    if (pathname.startsWith('/rest/v1')) {
      // Supabase's gateway strips the `/rest/v1` prefix before PostgREST, which
      // serves its tables and RPCs from the root.
      proxy(rest, request, response, body, (url) => url.replace(/^\/rest\/v1/u, '') || '/');
      return;
    }
    if (pathname.startsWith('/storage/v1')) {
      if (storage) {
        // Supabase Storage serves its object routes under `/object`, and the
        // client already includes that prefix, so only `/storage/v1` is
        // stripped here.
        proxy(storage, request, response, body, (url) => url.replace(/^\/storage\/v1/u, '') || '/');
        return;
      }
      const payload = JSON.stringify({
        statusCode: '501',
        error: 'Not Implemented',
        message: 'The Dockerless e2e stack was started without object storage.',
      });
      response.writeHead(501, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      });
      response.end(payload);
      return;
    }
    const payload = JSON.stringify({ code: 404, error_code: 'not_found', msg: 'Not found' });
    response.writeHead(404, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    });
    response.end(payload);
  });
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(argument('--port', '0'));
  const server = createGatewayServer({
    authUrl: argument('--auth', 'http://127.0.0.1:54321'),
    restUrl: argument('--rest', 'http://127.0.0.1:54322'),
    storageUrl: argument('--storage', ''),
  });
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`gateway listening on ${port}\n`);
  });
}
