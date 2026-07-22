import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const ignored = new Set(['.git', '.next', 'coverage', 'dist', 'node_modules', 'playwright-report']);
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
      if (pattern.value.test(content)) {
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
