// Settings → AI tells Admins the per-person polish cap the server enforces (CONTRACT 21: 40 a
// day). AiSection is a client component, so the number is written in its copy; this keeps the two
// from drifting apart.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERSON_DAILY_CAPS } from '@/modules/ai/usage';

const AI_SECTION = path.resolve(import.meta.dirname, '../../src/app/(app)/settings/AiSection.jsx');

describe('Settings → AI copy', () => {
  it("states the person's daily polish cap", () => {
    const source = readFileSync(AI_SECTION, 'utf8');
    expect(PERSON_DAILY_CAPS.polish).toBe(40);
    expect(source).toContain(`${PERSON_DAILY_CAPS.polish} a day per person.`);
    expect(source).not.toMatch(/\b20 a day per person/);
  });
});
