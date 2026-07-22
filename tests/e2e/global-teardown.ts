import { removeTestUsers } from './test-data.js';

export default async function globalTeardown(): Promise<void> {
  await removeTestUsers();
}
