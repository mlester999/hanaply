import 'reflect-metadata';

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseApiEnvironment } from '@hanaply/config';

import { createApiApplication } from './bootstrap.js';

const rootEnvironmentFile = resolve(import.meta.dirname, '../../../.env.local');
if (existsSync(rootEnvironmentFile)) process.loadEnvFile(rootEnvironmentFile);

async function bootstrap(): Promise<void> {
  const environment = parseApiEnvironment(process.env);
  const app = await createApiApplication(environment);
  await app.listen(environment.API_PORT, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  process.stderr.write(`Hanaply API failed to start: ${message}\n`);
  process.exitCode = 1;
});
