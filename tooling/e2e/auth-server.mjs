#!/usr/bin/env node
/**
 * Supabase Auth (GoTrue) test double for the Dockerless end-to-end stack.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS A TEST DOUBLE. It is not Supabase Auth.
 *
 * Production Hanaply authenticates against hosted Supabase Auth over HTTPS,
 * using `@supabase/ssr` in the browser and in Next.js, and `getClaims()` in the
 * API. Hosted Supabase publishes no Windows GoTrue binary and this project's
 * browser suite must run without Docker, so `pnpm e2e` serves the subset of the
 * GoTrue HTTP API that this application actually calls, backed by the same
 * throwaway PostgreSQL cluster the pgTAP suites use.
 *
 * It is only registered as the stack's auth server by
 * `tooling/e2e/stack.mjs`. Nothing in `apps/**`, `services/**` or
 * `packages/**` knows it exists: the application talks to it exactly as it
 * talks to Supabase — through `@supabase/ssr`, `@supabase/supabase-js` and the
 * service-role admin API. If a behaviour cannot be reproduced faithfully, the
 * suite must fail rather than the application being changed.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Fidelity notes:
 *   * Access tokens are HS256 JWTs signed with the stack's shared secret and
 *     carry no `kid`, so `supabase.auth.getClaims()` (auth-js 2.110.8) takes its
 *     symmetric-key fallback and validates the token through `GET /auth/v1/user`.
 *     For that reason `GET /auth/v1/user` must reject a token whose `session_id`
 *     no longer exists in `auth.sessions` — that is what makes session
 *     revocation observable in the browser.
 *   * Passwords are hashed and verified with PostgreSQL `crypt()` from pgcrypto,
 *     the same bcrypt the real service uses. Plaintext is never compared in
 *     JavaScript.
 *   * Tokens for the three Supabase-Auth-owned emails are rendered from the real
 *     `templates/*.html` files with the real subjects from
 *     `supabase/config.toml`, and are single-use, which the suite asserts.
 *   * `session_id` is a real `auth.sessions` row because
 *     `services/api/src/auth.ts` verifies it against the database through
 *     `public.is_auth_session_active`.
 *
 * Usage: node tooling/e2e/auth-server.mjs --port <port> --db-port <port> [...]
 */

import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { appendEmail, defaultSender } from './mailbox.mjs';
import { PostgresClient, literal } from './pg.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const instanceId = '00000000-0000-0000-0000-000000000000';
const recognizedGrantTypes = new Set(['password', 'refresh_token', 'pkce']);
const refreshTokenReuseIntervalSeconds = 10;

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** Issues an HS256 JWT. Deliberately no `kid`: see the header note above. */
export function signToken(payload, secret) {
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const body = base64urlJson(payload);
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  if (expected !== signature) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  return payload;
}

/** The publishable ("anon") and service-role API keys Supabase clients send. */
export function buildApiKeys(secret, { issuedAt = Math.floor(Date.now() / 1000) } = {}) {
  const shared = { iss: 'supabase', iat: issuedAt, exp: issuedAt + 10 * 365 * 24 * 3600 };
  return {
    publishableKey: signToken({ ...shared, role: 'anon' }, secret),
    serviceRoleKey: signToken({ ...shared, role: 'service_role' }, secret),
  };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** Mirrors `supabase/config.toml`; the config file is the source of truth. */
export const emailTemplates = Object.freeze({
  confirmation: {
    subject: 'Verify your Hanaply email',
    file: 'confirmation.html',
    templateId: 'verify-email',
  },
  recovery: {
    subject: 'Reset your Hanaply password',
    file: 'recovery.html',
    templateId: 'password-reset',
  },
  passwordChanged: {
    subject: 'Your Hanaply password was changed',
    file: 'password-changed.html',
    templateId: 'password-changed',
  },
});

/**
 * Reads the configured subjects out of `supabase/config.toml` so a template
 * change is reflected here without editing this file. Falls back to the
 * documented defaults when the config cannot be read.
 */
export function readConfiguredSubjects() {
  try {
    const config = readFileSync(resolve(root, 'supabase', 'config.toml'), 'utf8');
    const section = (name) => {
      const match = new RegExp(
        `\\[${name.replaceAll('.', '\\.')}\\]([\\s\\S]*?)(?:\\n\\[|$)`,
        'u',
      ).exec(config);
      return /subject\s*=\s*"([^"]*)"/u.exec(match?.[1] ?? '')?.[1];
    };
    return {
      confirmation:
        section('auth.email.template.confirmation') ?? emailTemplates.confirmation.subject,
      recovery: section('auth.email.template.recovery') ?? emailTemplates.recovery.subject,
      passwordChanged:
        section('auth.email.notification.password_changed') ??
        emailTemplates.passwordChanged.subject,
    };
  } catch {
    return {
      confirmation: emailTemplates.confirmation.subject,
      recovery: emailTemplates.recovery.subject,
      passwordChanged: emailTemplates.passwordChanged.subject,
    };
  }
}

function decodeEntities(value) {
  return value
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/**
 * Converts a rendered template to the plain-text alternative a mail client (and
 * Mailpit) would show.
 *
 * Block boundaries become line breaks, everything else collapses to single
 * spaces the way a mail client reflows markup — the suite asserts on phrases
 * that HTML source formatting splits across lines. Link targets are kept so
 * one-time action URLs survive in the text part.
 */
export function htmlToText(html) {
  const marker = '\u0001';
  const withoutHead = html
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<head[\s\S]*?<\/head>/giu, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/giu, '');
  // Prettier wraps `</a>` as `</a\n>`, so the closing tag must tolerate space.
  const withLinks = withoutHead.replace(
    /<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a\s*>/giu,
    (_match, href, label) =>
      `${String(label)
        .replace(/<[^>]*>/gu, '')
        .trim()} (${href})`,
  );
  const blocked = withLinks
    .replace(/<br\s*\/?>/giu, marker)
    .replace(/<hr\s*\/?>/giu, marker)
    .replace(/<\/(?:p|div|h1|h2|h3|h4|li|tr|table|td|section|header|footer)\s*>/giu, marker);
  return decodeEntities(blocked.replace(/<[^>]*>/gu, ''))
    .replace(/\s+/gu, ' ')
    .split(marker)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/** Substitutes GoTrue's `{{ .Variable }}` template syntax. */
export function renderTemplate(html, variables) {
  return html.replace(/\{\{\s*\.(\w+)\s*\}\}/gu, (_match, name) => variables[name] ?? '');
}

/**
 * `sha256(lower(email) + token)`, hex encoded — the shape GoTrue puts in the
 * `{{ .TokenHash }}` template variable and recomputes on `POST /verify`.
 */
export function tokenHash(email, token) {
  return createHash('sha256').update(`${email.trim().toLowerCase()}${token}`).digest('hex');
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function sendJson(response, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body ?? {});
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  response.end(payload);
}

export function goTrueError(status, errorCode, message, extra = {}) {
  return { code: status, error_code: errorCode, msg: message, ...extra };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export async function createAuthServer(options) {
  const {
    port,
    host = '127.0.0.1',
    database = { host: '127.0.0.1', port: 54_333, user: 'postgres', database: 'hanaply' },
    jwtSecret,
    siteUrl = 'http://localhost:3100',
    mailboxFile,
    jwtExpirySeconds = 3600,
    templatesDirectory = resolve(root, 'templates'),
    logger = () => {
      /* no-op by default: the stack passes its own logger */
    },
  } = options;

  if (!jwtSecret) throw new Error('The auth test double requires a JWT secret.');
  if (!mailboxFile) throw new Error('The auth test double requires a mailbox file.');

  const subjects = readConfiguredSubjects();
  const templates = new Map();
  for (const [key, template] of Object.entries(emailTemplates)) {
    templates.set(key, readFileSync(resolve(templatesDirectory, template.file), 'utf8'));
  }

  const client = await PostgresClient.connect({ ...database, applicationName: 'hanaply-e2e-auth' });
  await client.execute('set search_path = public, extensions, auth');
  // One connection serialises every statement, which is what keeps the
  // in-process state (PKCE codes, session bookkeeping) consistent.
  let queue = Promise.resolve();
  const serialized = (task) => {
    const result = queue.then(task, task);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  /** code -> { userId, redirectTo, createdAt } for grant_type=pkce. */
  const pkceCodes = new Map();

  function log(message) {
    logger(message);
  }

  // -- user helpers ---------------------------------------------------------

  const userColumns = `
    id, aud, role, email, email_confirmed_at, last_sign_in_at, raw_app_meta_data,
    raw_user_meta_data, created_at, updated_at, banned_until, deleted_at,
    is_anonymous, phone, confirmation_token, confirmation_sent_at, recovery_token,
    recovery_sent_at, email_change_token_new, email_change_token_current, encrypted_password
  `;

  async function findUserByEmail(email) {
    return client.json(
      `select to_json(u)::text from (select ${userColumns} from auth.users where lower(email) = lower(${literal(email)}) limit 1) u`,
    );
  }

  async function findUserById(id) {
    return client.json(
      `select to_json(u)::text from (select ${userColumns} from auth.users where id = ${literal(id)}::uuid limit 1) u`,
    );
  }

  async function serializeIdentities(userId) {
    return (
      (await client.json(
        `select coalesce(json_agg(json_build_object(
            'identity_id', id, 'id', provider_id, 'user_id', user_id,
            'identity_data', identity_data, 'provider', provider,
            'last_sign_in_at', last_sign_in_at, 'created_at', created_at, 'updated_at', updated_at,
            'email', email
          ) order by created_at), '[]'::json)::text
         from auth.identities where user_id = ${literal(userId)}::uuid`,
      )) ?? []
    );
  }

  async function publicUser(row, { identities = true } = {}) {
    if (!row) return null;
    return {
      id: row.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: row.email,
      email_confirmed_at: row.email_confirmed_at ?? undefined,
      phone: row.phone ?? '',
      confirmed_at: row.email_confirmed_at ?? undefined,
      last_sign_in_at: row.last_sign_in_at ?? undefined,
      app_metadata: row.raw_app_meta_data ?? { provider: 'email', providers: ['email'] },
      user_metadata: row.raw_user_meta_data ?? {},
      identities: identities ? await serializeIdentities(row.id) : [],
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_anonymous: row.is_anonymous ?? false,
      ...(row.confirmation_sent_at ? { confirmation_sent_at: row.confirmation_sent_at } : {}),
      ...(row.recovery_sent_at ? { recovery_sent_at: row.recovery_sent_at } : {}),
    };
  }

  async function insertUser({
    email,
    password,
    userMetadata = {},
    appMetadata = { provider: 'email', providers: ['email'] },
    emailConfirmed = false,
  }) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const confirmationToken = randomBytes(16).toString('hex');
    const encrypted = password
      ? `extensions.crypt(${literal(password)}, extensions.gen_salt('bf', 10))`
      : 'null';
    await client.execute(
      `insert into auth.users (
         instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
         confirmation_token, confirmation_sent_at, raw_app_meta_data, raw_user_meta_data,
         created_at, updated_at, is_sso_user, is_anonymous, phone_change,
         phone_change_token, email_change, email_change_token_new, email_change_token_current,
         reauthentication_token, is_super_admin, email_change_confirm_status
       ) values (
         ${literal(instanceId)}::uuid, ${literal(id)}::uuid, 'authenticated', 'authenticated',
         ${literal(email)}, ${encrypted},
         ${emailConfirmed ? `${literal(now)}::timestamptz` : 'null'},
         ${emailConfirmed ? "''" : literal(confirmationToken)},
         ${emailConfirmed ? 'null' : `${literal(now)}::timestamptz`},
         ${literal(appMetadata)}::jsonb, ${literal(userMetadata)}::jsonb,
         ${literal(now)}::timestamptz, ${literal(now)}::timestamptz, false, false, '', '', '', '', '', '', false, 0
       )`,
    );
    await client.execute(
      `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values (
         ${literal(id)}, ${literal(id)}::uuid,
         ${literal({ sub: id, email, email_verified: emailConfirmed, phone_verified: false })}::jsonb,
         'email', ${literal(now)}::timestamptz, ${literal(now)}::timestamptz, ${literal(now)}::timestamptz
       )`,
    );
    return { id, confirmationToken };
  }

  // -- mail -----------------------------------------------------------------

  function sendTemplateEmail({ template, to, variables }) {
    const definition = emailTemplates[template];
    const html = renderTemplate(templates.get(template) ?? '', variables);
    const text = htmlToText(html);
    const subject =
      template === 'confirmation'
        ? subjects.confirmation
        : template === 'recovery'
          ? subjects.recovery
          : subjects.passwordChanged;
    appendEmail(mailboxFile, {
      from: defaultSender,
      to: [{ name: '', address: to }],
      subject,
      text,
      html,
      templateId: definition.templateId,
    });
    log(`captured "${subject}" for ${to}`);
  }

  async function sendConfirmation(user) {
    // An already-consumed token is never reused: a resend always mints a new one.
    const token = user.confirmationToken || randomBytes(16).toString('hex');
    await client.execute(
      `update auth.users set confirmation_token = ${literal(token)},
         confirmation_sent_at = now(), updated_at = now() where id = ${literal(user.id)}::uuid`,
    );
    sendTemplateEmail({
      template: 'confirmation',
      to: user.email,
      variables: {
        SiteURL: siteUrl,
        TokenHash: tokenHash(user.email, token),
        Email: user.email,
        RedirectTo: siteUrl,
      },
    });
  }

  async function sendRecovery(user) {
    const token = randomBytes(16).toString('hex');
    await client.execute(
      `update auth.users set recovery_token = ${literal(token)}, recovery_sent_at = now(),
         updated_at = now() where id = ${literal(user.id)}::uuid`,
    );
    sendTemplateEmail({
      template: 'recovery',
      to: user.email,
      variables: {
        SiteURL: siteUrl,
        TokenHash: tokenHash(user.email, token),
        Email: user.email,
        RedirectTo: siteUrl,
      },
    });
  }

  function sendPasswordChanged(user) {
    sendTemplateEmail({
      template: 'passwordChanged',
      to: user.email,
      variables: { SiteURL: siteUrl, Email: user.email },
    });
  }

  // -- sessions -------------------------------------------------------------

  function sessionPayload(row, sessionId) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const accessToken = signToken(
      {
        iss: `${siteUrl}/auth/v1`,
        sub: row.id,
        aud: 'authenticated',
        exp: issuedAt + jwtExpirySeconds,
        iat: issuedAt,
        email: row.email,
        phone: '',
        app_metadata: row.raw_app_meta_data ?? { provider: 'email', providers: ['email'] },
        user_metadata: row.raw_user_meta_data ?? {},
        role: 'authenticated',
        aal: 'aal1',
        amr: [{ method: 'password', timestamp: issuedAt }],
        session_id: sessionId,
        is_anonymous: false,
      },
      jwtSecret,
    );
    return accessToken;
  }

  async function createSession(row, { userAgent = null, ip = null, parent = null } = {}) {
    const sessionId = randomUUID();
    const refreshToken = randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    await client.execute(
      `insert into auth.sessions (id, user_id, created_at, updated_at, factor_id, aal, not_after, refreshed_at, user_agent, ip, tag)
       values (${literal(sessionId)}::uuid, ${literal(row.id)}::uuid, ${literal(now)}::timestamptz,
         ${literal(now)}::timestamptz, null, 'aal1', null, now(), ${literal(userAgent)}, ${
           ip ? `${literal(ip)}::inet` : 'null'
         }, null)`,
    );
    await client.execute(
      `insert into auth.refresh_tokens (instance_id, token, user_id, revoked, created_at, updated_at, parent, session_id)
       values (${literal(instanceId)}::uuid, ${literal(refreshToken)}, ${literal(row.id)}, false,
         ${literal(now)}::timestamptz, ${literal(now)}::timestamptz, ${parent ? literal(parent) : 'null'},
         ${literal(sessionId)}::uuid)`,
    );
    return {
      sessionId,
      access_token: sessionPayload(row, sessionId),
      token_type: 'bearer',
      expires_in: jwtExpirySeconds,
      expires_at: Math.floor(Date.now() / 1000) + jwtExpirySeconds,
      refresh_token: refreshToken,
    };
  }

  async function sessionResponse(row, sessionOptions) {
    const session = await createSession(row, sessionOptions);
    return { ...session, user: await publicUser(row) };
  }

  async function findRefreshToken(token) {
    return client.json(
      `select to_json(t)::text from (
         select refresh.id, refresh.token, refresh.revoked, refresh.session_id, refresh.user_id,
                refresh.updated_at
         from auth.refresh_tokens refresh
         where refresh.token = ${literal(token)} limit 1
       ) t`,
    );
  }

  async function findSession(sessionId) {
    return client.json(
      `select to_json(s)::text from (select id, user_id, created_at, updated_at, user_agent, ip from auth.sessions where id = ${literal(sessionId)}::uuid limit 1) s`,
    );
  }

  async function revokeSession(sessionId) {
    await client.execute(`delete from auth.sessions where id = ${literal(sessionId)}::uuid`);
  }

  // -- request authentication ----------------------------------------------

  function bearerToken(request) {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    const token = header.slice('Bearer '.length).trim();
    return token || null;
  }

  function isServiceRequest(request) {
    const token = bearerToken(request);
    if (!token) return false;
    const claims = verifyToken(token, jwtSecret);
    return claims?.role === 'service_role';
  }

  function requestContext(request) {
    return {
      userAgent: (request.headers['user-agent'] ?? '').slice(0, 300) || null,
      ip: (request.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim() || null,
    };
  }

  // -- route handlers -------------------------------------------------------

  async function handleSignup(request, response) {
    const body = await readBody(request);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      sendJson(
        response,
        400,
        goTrueError(400, 'validation_failed', 'Unable to validate email address: invalid format'),
      );
      return;
    }
    const reasons = [];
    if (password.length < 8) reasons.push('length');
    if (!/[a-z]/u.test(password) || !/[A-Z]/u.test(password) || !/[0-9]/u.test(password)) {
      reasons.push('characters');
    }
    if (reasons.length > 0) {
      sendJson(
        response,
        422,
        goTrueError(422, 'weak_password', 'Password is too weak.', {
          weak_password: {
            reasons,
            message: 'Password should be at least 8 characters and contain letters and digits.',
          },
        }),
      );
      return;
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      if (existing.email_confirmed_at) {
        // GoTrue obfuscates a duplicate confirmed signup when confirmations are
        // enabled: a synthetic user with no identities, and no email sent.
        sendJson(response, 200, {
          id: randomUUID(),
          aud: 'authenticated',
          role: 'authenticated',
          email,
          phone: '',
          confirmation_sent_at: new Date().toISOString(),
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: {},
          identities: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_anonymous: false,
        });
        return;
      }
      const resent = {
        id: existing.id,
        email: existing.email,
        confirmationToken: existing.confirmation_token,
      };
      await sendConfirmation(resent);
      sendJson(response, 200, await publicUser(await findUserById(existing.id)));
      return;
    }

    const created = await insertUser({
      email,
      password,
      userMetadata: typeof body.data === 'object' && body.data !== null ? body.data : {},
    });
    await sendConfirmation({ id: created.id, email, confirmationToken: created.confirmationToken });
    sendJson(response, 200, await publicUser(await findUserById(created.id)));
  }

  async function handlePasswordGrant(request, response) {
    const body = await readBody(request);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const row = await findUserByEmail(email);
    const matches =
      row && password
        ? await client.json(
            `select to_json(coalesce(encrypted_password is not null and encrypted_password = extensions.crypt(${literal(password)}, encrypted_password), false))::text from auth.users where id = ${literal(row.id)}::uuid`,
          )
        : false;
    if (!row || !matches) {
      sendJson(response, 400, goTrueError(400, 'invalid_credentials', 'Invalid login credentials'));
      return;
    }
    if (row.deleted_at) {
      sendJson(response, 400, goTrueError(400, 'user_not_found', 'User not found'));
      return;
    }
    if (!row.email_confirmed_at) {
      sendJson(response, 400, goTrueError(400, 'email_not_confirmed', 'Email not confirmed'));
      return;
    }
    if (row.banned_until && new Date(row.banned_until).getTime() > Date.now()) {
      sendJson(response, 400, goTrueError(400, 'user_banned', 'User is banned'));
      return;
    }
    const context = requestContext(request);
    const authenticated = await sessionResponse(row, context);
    await client.execute(
      `update auth.users set last_sign_in_at = now(), updated_at = now() where id = ${literal(row.id)}::uuid`,
    );
    sendJson(response, 200, authenticated);
  }

  async function handleRefreshGrant(request, response) {
    const body = await readBody(request);
    const token = typeof body.refresh_token === 'string' ? body.refresh_token : '';
    if (!token) {
      sendJson(
        response,
        400,
        goTrueError(
          400,
          'refresh_token_not_found',
          'Invalid Refresh Token: Refresh Token Not Found',
        ),
      );
      return;
    }
    const stored = await findRefreshToken(token);
    if (!stored) {
      sendJson(
        response,
        400,
        goTrueError(
          400,
          'refresh_token_not_found',
          'Invalid Refresh Token: Refresh Token Not Found',
        ),
      );
      return;
    }
    if (stored.revoked || !stored.session_id) {
      const ageSeconds = stored.updated_at
        ? (Date.now() - new Date(stored.updated_at).getTime()) / 1000
        : Number.POSITIVE_INFINITY;
      if (!stored.session_id || ageSeconds > refreshTokenReuseIntervalSeconds) {
        if (stored.session_id) await revokeSession(stored.session_id);
        sendJson(
          response,
          400,
          goTrueError(400, 'refresh_token_already_used', 'Invalid Refresh Token: Already Used'),
        );
        return;
      }
    }
    const row = await findUserById(String(stored.user_id));
    if (!row || row.deleted_at) {
      sendJson(response, 400, goTrueError(400, 'user_not_found', 'User not found'));
      return;
    }
    const session = await findSession(stored.session_id);
    if (!session) {
      sendJson(
        response,
        400,
        goTrueError(
          400,
          'session_not_found',
          'Session from session_id claim in JWT does not exist',
        ),
      );
      return;
    }
    const refreshToken = randomBytes(16).toString('hex');
    await client.execute(
      `update auth.refresh_tokens set revoked = true, updated_at = now() where token = ${literal(token)}`,
    );
    await client.execute(
      `insert into auth.refresh_tokens (instance_id, token, user_id, revoked, created_at, updated_at, parent, session_id)
       values (${literal(instanceId)}::uuid, ${literal(refreshToken)}, ${literal(row.id)}, false, now(), now(), ${literal(token)}, ${literal(session.id)}::uuid)`,
    );
    await client.execute(
      `update auth.sessions set refreshed_at = now(), updated_at = now() where id = ${literal(session.id)}::uuid`,
    );
    const issuedAt = Math.floor(Date.now() / 1000);
    sendJson(response, 200, {
      access_token: sessionPayload(row, session.id),
      token_type: 'bearer',
      expires_in: jwtExpirySeconds,
      expires_at: issuedAt + jwtExpirySeconds,
      refresh_token: refreshToken,
      user: await publicUser(row),
    });
  }

  async function handlePkceGrant(request, response) {
    const body = await readBody(request);
    const code = typeof body.auth_code === 'string' ? body.auth_code : '';
    const stored = pkceCodes.get(code);
    if (!stored) {
      sendJson(
        response,
        400,
        goTrueError(400, 'flow_state_not_found', 'invalid flow state, no valid flow state found'),
      );
      return;
    }
    pkceCodes.delete(code);
    const row = await findUserById(stored.userId);
    if (!row) {
      sendJson(response, 400, goTrueError(400, 'user_not_found', 'User not found'));
      return;
    }
    sendJson(response, 200, await sessionResponse(row, requestContext(request)));
  }

  async function handleVerify(request, response) {
    const body = await readBody(request);
    const type = typeof body.type === 'string' ? body.type : '';
    const hash = typeof body.token_hash === 'string' ? body.token_hash : '';
    if (!hash) {
      sendJson(response, 403, goTrueError(403, 'otp_expired', 'Token has expired or is invalid'));
      return;
    }
    const column =
      type === 'recovery'
        ? 'recovery_token'
        : type === 'email_change'
          ? 'email_change_token_new'
          : 'confirmation_token';
    const row = await client.json(
      `select to_json(u)::text from (
         select ${userColumns} from auth.users auth_user
         where ${column} is not null and ${column} <> ''
           and encode(extensions.digest(lower(email) || ${column}, 'sha256'), 'hex') = lower(${literal(hash)})
         limit 1
       ) u`,
    );
    if (!row) {
      sendJson(response, 403, goTrueError(403, 'otp_expired', 'Token has expired or is invalid'));
      return;
    }
    // Every one-time token is consumed on use: the suite asserts that a second
    // visit to the same link is rejected.
    await client.execute(
      `update auth.users set ${column} = '', email_confirmed_at = coalesce(email_confirmed_at, now()),
         last_sign_in_at = now(), updated_at = now() where id = ${literal(row.id)}::uuid`,
    );
    const confirmed = await findUserById(row.id);
    sendJson(response, 200, await sessionResponse(confirmed, requestContext(request)));
  }

  async function handleRecover(request, response) {
    const body = await readBody(request);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const row = email ? await findUserByEmail(email) : null;
    // Always 200: recovery must not disclose whether an address exists.
    if (row && row.email_confirmed_at) await sendRecovery(row);
    sendJson(response, 200, {});
  }

  async function handleResend(request, response) {
    const body = await readBody(request);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const row = email ? await findUserByEmail(email) : null;
    if (row && !row.email_confirmed_at) {
      const token = randomBytes(16).toString('hex');
      await sendConfirmation({ id: row.id, email: row.email, confirmationToken: token });
    }
    sendJson(response, 200, {});
  }

  async function handleGetUser(request, response) {
    const token = bearerToken(request);
    const claims = token ? verifyToken(token, jwtSecret) : null;
    if (!claims?.sub) {
      sendJson(
        response,
        401,
        goTrueError(401, 'bad_jwt', 'invalid JWT: unable to parse or verify signature'),
      );
      return;
    }
    if (claims.exp && claims.exp * 1000 < Date.now()) {
      sendJson(response, 401, goTrueError(401, 'bad_jwt', 'invalid JWT: token is expired'));
      return;
    }
    const sessionId = typeof claims.session_id === 'string' ? claims.session_id : null;
    if (!sessionId || !(await findSession(sessionId))) {
      // This is the failure the API and the SSR client rely on after a session
      // is revoked: the JWT is well-formed but its session no longer exists.
      sendJson(
        response,
        401,
        goTrueError(
          401,
          'session_not_found',
          'Session from session_id claim in JWT does not exist',
        ),
      );
      return;
    }
    const row = await findUserById(claims.sub);
    if (!row || row.deleted_at) {
      sendJson(
        response,
        404,
        goTrueError(404, 'user_not_found', 'User from sub claim in JWT does not exist'),
      );
      return;
    }
    sendJson(response, 200, await publicUser(row));
  }

  async function handleUpdateUser(request, response) {
    const token = bearerToken(request);
    const claims = token ? verifyToken(token, jwtSecret) : null;
    if (!claims?.sub) {
      sendJson(
        response,
        401,
        goTrueError(401, 'bad_jwt', 'invalid JWT: unable to parse or verify signature'),
      );
      return;
    }
    if (!claims.session_id || !(await findSession(claims.session_id))) {
      sendJson(
        response,
        401,
        goTrueError(
          401,
          'session_not_found',
          'Session from session_id claim in JWT does not exist',
        ),
      );
      return;
    }
    const row = await findUserById(claims.sub);
    if (!row) {
      sendJson(response, 404, goTrueError(404, 'user_not_found', 'User not found'));
      return;
    }
    const body = await readBody(request);
    const updates = [];
    let passwordChanged = false;

    if (typeof body.password === 'string' && body.password) {
      // `[auth.email] secure_password_change = true` in supabase/config.toml:
      // a password change requires a sign-in within the last 24 hours.
      const recent =
        row.last_sign_in_at &&
        Date.now() - new Date(row.last_sign_in_at).getTime() < 24 * 3600 * 1000;
      if (!recent) {
        sendJson(
          response,
          403,
          goTrueError(403, 'reauthentication_needed', 'Password change requires a recent sign-in'),
        );
        return;
      }
      updates.push(
        `encrypted_password = extensions.crypt(${literal(body.password)}, extensions.gen_salt('bf', 10))`,
      );
      passwordChanged = true;
    }
    if (typeof body.email === 'string' && body.email && body.email.toLowerCase() !== row.email) {
      sendJson(
        response,
        422,
        goTrueError(
          422,
          'email_change_disabled',
          'Email change requires the double-confirm change flow',
        ),
      );
      return;
    }
    if (typeof body.data === 'object' && body.data !== null) {
      updates.push(
        `raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || ${literal(body.data)}::jsonb`,
      );
    }
    if (updates.length === 0) {
      sendJson(response, 200, await publicUser(row));
      return;
    }
    updates.push('updated_at = now()');
    await client.execute(
      `update auth.users set ${updates.join(', ')} where id = ${literal(row.id)}::uuid`,
    );
    const updated = await findUserById(row.id);
    if (passwordChanged) sendPasswordChanged(updated);
    sendJson(response, 200, await publicUser(updated));
  }

  async function handleLogout(request, response, url) {
    const scope = url.searchParams.get('scope') ?? 'global';
    const token = bearerToken(request);
    const claims = token ? verifyToken(token, jwtSecret) : null;
    const body = await readBody(request);
    let sessionId = typeof claims?.session_id === 'string' ? claims.session_id : null;
    let userId = typeof claims?.sub === 'string' ? claims.sub : null;
    if (!sessionId && typeof body.refresh_token === 'string') {
      const stored = await findRefreshToken(body.refresh_token);
      if (stored) {
        sessionId = stored.session_id;
        userId = String(stored.user_id);
      }
    }
    if (scope === 'others' && userId && sessionId) {
      await client.execute(
        `delete from auth.sessions where user_id = ${literal(userId)}::uuid and id <> ${literal(sessionId)}::uuid`,
      );
    } else if (scope === 'global' && userId) {
      await client.execute(`delete from auth.sessions where user_id = ${literal(userId)}::uuid`);
    } else if (sessionId) {
      await revokeSession(sessionId);
    }
    response.writeHead(204).end();
  }

  async function handleAdminListUsers(request, response, url) {
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
    const perPage = Math.min(
      1000,
      Math.max(1, Number(url.searchParams.get('per_page') ?? '50') || 50),
    );
    const total = await client.json('select to_json(count(*))::text from auth.users');
    const rows =
      (await client.json(
        `select coalesce(json_agg(to_json(u) order by u.created_at), '[]'::json)::text from (
           select ${userColumns} from auth.users order by created_at offset ${(page - 1) * perPage} limit ${perPage}
         ) u`,
      )) ?? [];
    // Serialised deliberately: one PostgreSQL connection serves this process, so
    // per-user identity lookups must not overlap.
    const users = [];
    for (const row of rows) users.push(await publicUser(row));
    sendJson(response, 200, {
      users,
      aud: 'authenticated',
      next_page: page * perPage < Number(total) ? page + 1 : null,
      last_page: Math.max(1, Math.ceil(Number(total) / perPage)),
      total: Number(total),
    });
  }

  async function handleAdminCreateUser(request, response) {
    const body = await readBody(request);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' && body.password ? body.password : null;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      sendJson(
        response,
        400,
        goTrueError(400, 'validation_failed', 'Unable to validate email address: invalid format'),
      );
      return;
    }
    if (password) {
      if (password.length < 8) {
        sendJson(
          response,
          422,
          goTrueError(422, 'weak_password', 'Password is too weak.', {
            weak_password: {
              reasons: ['length'],
              message: 'Password should be at least 8 characters.',
            },
          }),
        );
        return;
      }
    }
    if (await findUserByEmail(email)) {
      sendJson(
        response,
        422,
        goTrueError(
          422,
          'email_exists',
          'A user with this email address has already been registered',
        ),
      );
      return;
    }
    const created = await insertUser({
      email,
      password,
      userMetadata:
        typeof body.user_metadata === 'object' && body.user_metadata !== null
          ? body.user_metadata
          : {},
      appMetadata:
        typeof body.app_metadata === 'object' && body.app_metadata !== null
          ? body.app_metadata
          : { provider: 'email', providers: ['email'] },
      emailConfirmed: body.email_confirm === true,
    });
    sendJson(response, 200, await publicUser(await findUserById(created.id)));
  }

  async function handleAdminUser(request, response, id) {
    const row = await findUserById(id);
    if (!row) {
      sendJson(response, 404, goTrueError(404, 'user_not_found', 'User not found'));
      return;
    }
    if (request.method === 'GET') {
      sendJson(response, 200, await publicUser(row));
      return;
    }
    if (request.method === 'DELETE') {
      await client.execute(`delete from auth.users where id = ${literal(id)}::uuid`);
      sendJson(response, 200, { user: await publicUser(row) });
      return;
    }
    const body = await readBody(request);
    const updates = [];
    if (typeof body.password === 'string' && body.password) {
      updates.push(
        `encrypted_password = extensions.crypt(${literal(body.password)}, extensions.gen_salt('bf', 10))`,
      );
    }
    if (typeof body.user_metadata === 'object' && body.user_metadata !== null) {
      updates.push(
        `raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || ${literal(body.user_metadata)}::jsonb`,
      );
    }
    if (typeof body.email === 'string') {
      updates.push(`email = ${literal(body.email.trim().toLowerCase())}`);
    }
    if (body.email_confirm === true) {
      updates.push('email_confirmed_at = coalesce(email_confirmed_at, now())');
    } else if (body.email_confirm === false) {
      updates.push('email_confirmed_at = null');
    }
    if (typeof body.ban_duration === 'string' && body.ban_duration !== 'none') {
      updates.push("banned_until = now() + interval '876000 hours'");
    } else if (body.ban_duration === 'none') {
      updates.push('banned_until = null');
    }
    if (updates.length > 0) {
      updates.push('updated_at = now()');
      await client.execute(
        `update auth.users set ${updates.join(', ')} where id = ${literal(id)}::uuid`,
      );
    }
    sendJson(response, 200, await publicUser(await findUserById(id)));
  }

  // -- router ---------------------------------------------------------------

  async function handle(request, response) {
    const url = new URL(request.url ?? '/', `http://${host}:${port}`);
    if (!url.pathname.startsWith('/auth/v1')) {
      sendJson(response, 404, goTrueError(404, 'not_found', 'Route does not exist'));
      return;
    }
    const path = url.pathname.slice('/auth/v1'.length);
    const method = request.method ?? 'GET';

    if (path === '/health' || path === '/settings') {
      sendJson(response, 200, {
        version: 'hanaply-e2e-auth/1.0.0',
        name: 'Hanaply GoTrue test double',
        description: 'Dockerless Supabase Auth stand-in for pnpm e2e. Not for production.',
        external: {},
        disable_signup: false,
        mailer_autoconfirm: false,
        phone_autoconfirm: false,
        sms_provider: '',
        mfa_enabled: false,
      });
      return;
    }
    // Deliberately no JWKS endpoint: HS256 tokens carry no `kid`, so auth-js
    // takes the `GET /user` fallback path instead of verifying against JWKS.
    if (path.startsWith('/.well-known')) {
      sendJson(response, 404, goTrueError(404, 'not_found', 'Route does not exist'));
      return;
    }
    if (path === '/signup' && method === 'POST') return handleSignup(request, response);
    if (path === '/token' && method === 'POST') {
      const grantType = url.searchParams.get('grant_type') ?? '';
      if (!recognizedGrantTypes.has(grantType)) {
        sendJson(
          response,
          400,
          goTrueError(400, 'unsupported_grant_type', `Unsupported grant type: ${grantType}`),
        );
        return;
      }
      if (grantType === 'password') return handlePasswordGrant(request, response);
      if (grantType === 'refresh_token') return handleRefreshGrant(request, response);
      return handlePkceGrant(request, response);
    }
    if (path === '/verify' && method === 'POST') return handleVerify(request, response);
    if (path === '/recover' && method === 'POST') return handleRecover(request, response);
    if (path === '/resend' && method === 'POST') return handleResend(request, response);
    if (path === '/user' && method === 'GET') return handleGetUser(request, response);
    if (path === '/user' && method === 'PUT') return handleUpdateUser(request, response);
    if (path === '/logout' && method === 'POST') return handleLogout(request, response, url);
    if (path === '/admin/users' && method === 'GET') {
      if (!isServiceRequest(request)) {
        sendJson(response, 401, goTrueError(401, 'bad_jwt', 'The service role key is required'));
        return;
      }
      return handleAdminListUsers(request, response, url);
    }
    if (path === '/admin/users' && method === 'POST') {
      if (!isServiceRequest(request)) {
        sendJson(response, 401, goTrueError(401, 'bad_jwt', 'The service role key is required'));
        return;
      }
      return handleAdminCreateUser(request, response);
    }
    const adminUserMatch = /^\/admin\/users\/([0-9a-fA-F-]{36})$/u.exec(path);
    if (adminUserMatch && ['GET', 'PUT', 'DELETE'].includes(method)) {
      if (!isServiceRequest(request)) {
        sendJson(response, 401, goTrueError(401, 'bad_jwt', 'The service role key is required'));
        return;
      }
      return handleAdminUser(request, response, adminUserMatch[1]);
    }
    sendJson(
      response,
      404,
      goTrueError(404, 'not_found', `Route ${method} ${path} does not exist`),
    );
  }

  const server = createServer((request, response) => {
    serialized(async () => {
      try {
        await handle(request, response);
      } catch (error) {
        log(`auth error: ${error?.stack ?? error}`);
        if (!response.headersSent) {
          sendJson(
            response,
            500,
            goTrueError(500, 'unexpected_failure', String(error?.message ?? error)),
          );
        } else {
          response.end();
        }
      }
    });
  });

  return {
    server,
    client,
    async listen() {
      await new Promise((settle, reject) => {
        server.once('error', reject);
        server.listen(port, host, settle);
      });
      return server.address().port;
    },
    async close() {
      await new Promise((settle) => server.close(settle));
      client.close();
    },
    /** Exposed for the stack's health check. */
    signToken: (payload) => signToken(payload, jwtSecret),
  };
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const auth = await createAuthServer({
    port: Number(argument('--port', process.env.HANAPLY_E2E_AUTH_PORT ?? '0')),
    host: argument('--host', '127.0.0.1'),
    jwtSecret: argument('--jwt-secret', process.env.HANAPLY_E2E_JWT_SECRET),
    siteUrl: argument('--site-url', process.env.HANAPLY_E2E_APP_URL ?? 'http://localhost:3100'),
    mailboxFile: argument('--mailbox-file', process.env.HANAPLY_E2E_MAILBOX_FILE),
    database: {
      host: argument('--db-host', '127.0.0.1'),
      port: Number(argument('--db-port', process.env.HANAPLY_LOCAL_DB_PORT ?? '55433')),
      user: argument('--db-user', 'postgres'),
      database: argument('--db-name', process.env.HANAPLY_LOCAL_DB_NAME ?? 'hanaply'),
    },
    logger: (message) => process.stdout.write(`[auth] ${message}\n`),
  });
  const boundPort = await auth.listen();
  process.stdout.write(`hanaply-e2e auth listening on 127.0.0.1:${boundPort}\n`);
}
