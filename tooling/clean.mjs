import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const roots = ['.artifacts', '.turbo', 'coverage', 'playwright-report', 'test-results'];
const packages = ['apps/web', 'services/api', 'services/worker'];

for (const path of roots) {
  await rm(resolve(path), { recursive: true, force: true });
}

for (const path of packages) {
  await rm(resolve(path, 'dist'), { recursive: true, force: true });
  await rm(resolve(path, '.next'), { recursive: true, force: true });
}
