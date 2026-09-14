import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const ignored = new Set([
  '.artifacts',
  '.git',
  // Git-ignored local build output of the database and end-to-end harnesses. It
  // holds generated, throwaway local JWTs (`.localdb/e2e-stack.json`) that never
  // leave this machine and are never committed.
  '.localdb',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);
const textExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.sql',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const patterns = [
  {
    name: 'Supabase service JWT',
    value: /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/u,
  },
  { name: 'Resend API key', value: /re_[a-zA-Z0-9]{20,}/u },
  { name: 'OpenAI API key', value: /sk-[a-zA-Z0-9_-]{20,}/u },
];

/**
 * A match is skipped when the value describes itself as a placeholder.
 *
 * The patterns above are deliberately broad, and a test fixture that has to look
 * like a key in order to prove the key never leaks will always match one. A
 * scanner that reports those is a scanner people learn to ignore, which costs
 * more than it catches. The markers are explicit words rather than heuristics,
 * so a real credential cannot slip through by accident.
 */
const placeholderMarkers = [
  'test',
  'fake',
  'example',
  'placeholder',
  'dummy',
  'sample',
  'redacted',
  'do-not-log',
  'changeme',
];

function isPlaceholder(match) {
  const lowered = match.toLowerCase();
  return placeholderMarkers.some((marker) => lowered.includes(marker));
}

async function visit(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const findings = [];

  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      findings.push(...(await visit(path)));
      continue;
    }
    if (!textExtensions.has(extname(entry.name)) && entry.name !== '.env.example') continue;
    const content = await readFile(path, 'utf8');
    for (const pattern of patterns) {
      const matches = content.match(new RegExp(pattern.value.source, 'gu')) ?? [];
      if (matches.some((match) => !isPlaceholder(match))) {
        findings.push(`${pattern.name}: ${relative(process.cwd(), path)}`);
      }
    }
  }

  return findings;
}

const findings = await visit(process.cwd());
if (findings.length > 0) {
  console.error(`Potential secrets found:\n${findings.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('No committed secret patterns detected.');
}
