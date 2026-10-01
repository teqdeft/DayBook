// After the end-to-end tests: load the demo data again, so the database is left in the normal demo
// state (the tests check people in, submit reports and handle requests).
import { resetDemoData } from './support/database.js';

export default async function globalTeardown() {
  await resetDemoData();
}
