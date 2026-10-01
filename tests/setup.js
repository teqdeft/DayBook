// Runs before each test file. Service tests call resetDatabase() in beforeAll.
import { afterAll } from 'vitest';
import { setNowForTests } from '@/lib/time';

afterAll(async () => {
  setNowForTests(null);
  const { db } = await import('@/lib/db');
  await db.destroy();
});
