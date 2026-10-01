// Before the end-to-end tests: migrate the server's database and load the demo data, so every run
// starts from the same people, projects, attendance and reports.
import { resetDemoData } from './support/database.js';

export default async function globalSetup() {
  await resetDemoData();
}
