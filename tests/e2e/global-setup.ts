import { createTestUsers } from './test-data.js';

export default async function globalSetup(): Promise<void> {
  await createTestUsers();
}
