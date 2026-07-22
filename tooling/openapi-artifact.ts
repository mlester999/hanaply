import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { generateOpenApiDocument } from '../packages/contracts/src/openapi.js';

const artifactPath = resolve(import.meta.dirname, '../packages/contracts/openapi.generated.json');
const generated = `${JSON.stringify(generateOpenApiDocument(), null, 2)}\n`;
const mode = process.argv[2];

if (mode === '--write') {
  await writeFile(artifactPath, generated, 'utf8');
  process.stdout.write('Generated canonical OpenAPI 3.1 artifact.\n');
} else if (mode === '--check') {
  const committed = await readFile(artifactPath, 'utf8').catch(() => '');
  if (committed.replaceAll('\r\n', '\n') !== generated.replaceAll('\r\n', '\n')) {
    process.stderr.write('OpenAPI artifact drift detected. Run `pnpm openapi:generate`.\n');
    process.exitCode = 1;
  } else {
    process.stdout.write('OpenAPI artifact matches the canonical contract registry.\n');
  }
} else {
  process.stderr.write('Use --write or --check.\n');
  process.exitCode = 1;
}
