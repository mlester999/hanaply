import { createTestUsers } from './test-data.js';
import { clearMailbox } from './mailpit.js';

export default async function globalSetup(): Promise<void> {
  await clearMailbox();
  await createTestUsers();
}
