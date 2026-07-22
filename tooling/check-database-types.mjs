import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const generatedTypesPath = resolve(root, 'packages/database/src/generated.types.ts');
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) {
  process.stderr.write('Run database type generation through a pnpm script.\n');
  process.exit(1);
}
const generation = spawnSync(
  process.execPath,
  [pnpmCli, 'exec', 'supabase', 'gen', 'types', 'typescript', '--local', '--schema', 'public'],
  { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
);

if (generation.status !== 0) {
  process.stderr.write(
    generation.stderr || generation.error?.message || 'Database type generation failed.\n',
  );
  process.exit(1);
}

const generated = generation.stdout;
if (process.argv[2] === '--write') {
  await writeFile(generatedTypesPath, generated, 'utf8');
  process.stdout.write('Generated database types from the local schema.\n');
  process.exit(0);
}
if (process.argv[2] !== '--check') {
  process.stderr.write('Use --write or --check.\n');
  process.exit(1);
}

const committed = await readFile(generatedTypesPath, 'utf8');
const normalize = (value) => value.replaceAll('\r\n', '\n');

if (normalize(committed) !== normalize(generated)) {
  process.stderr.write('Generated database type drift detected. Run `pnpm db:types`.\n');
  process.exitCode = 1;
} else {
  process.stdout.write('Generated database types match the local schema.\n');
}
