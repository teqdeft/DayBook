// Shared set-up for the AI summary tests (CONTRACT 20): a fake Gemini that records each request
// and answers from the prompt, and checks that no real name went out. The network is blocked:
// nothing here can reach Google.
import { expect, vi } from 'vitest';
import { ai } from '@/modules/ai';
import { setSettings } from '../helpers/db.js';

/** Every request the fake Gemini got: { model, system, prompt, body }. */
export const requests = [];

/** The JSON part of a summary prompt (everything after the first line that starts with "{"). */
export function promptData(prompt) {
  return JSON.parse(prompt.slice(prompt.indexOf('\n{') + 1));
}

/**
 * Answers each request with `reply(request)`: an object { title, body } (sent as JSON), or
 * { status, data } for a raw HTTP answer, or an Error to throw like fetch does.
 */
export function fakeGemini(reply) {
  requests.length = 0;
  ai.setTransportForTests(async ({ model, body }) => {
    const request = {
      model,
      body: structuredClone(body),
      system: body.systemInstruction?.parts?.[0]?.text ?? '',
      prompt: body.contents?.[0]?.parts?.[0]?.text ?? '',
    };
    requests.push(request);
    const answer = await reply(request);
    if (answer instanceof Error) throw answer;
    if (answer && 'status' in answer) return answer;
    return { status: 200, data: ai.fakeGeminiResponse({ data: answer }) };
  });
}

/** Blocks the network and turns AI on with the summary features. */
export async function setUpAi(values = {}) {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('No network in tests')));
  await setSettings({
    ai_enabled: true,
    ai_daily_limit: 200,
    ai_pm_summary_enabled: true,
    ai_hr_notes_enabled: true,
    ai_summary_slack: true,
    slack_enabled: true,
    ...values,
  });
}

export function tearDownAi() {
  ai.setTransportForTests(null);
  ai.setApiKeyForTests(undefined);
}

/** No request text (system or prompt) contains any of these names, emails or Slack ids. */
export function expectNothingPersonal(people) {
  expect(requests.length).toBeGreaterThan(0);
  for (const request of requests) {
    const sent = `${request.system}\n${request.prompt}`;
    for (const person of people) {
      const parts = [person.name, ...person.name.split(' '), person.email, person.slackUserId];
      for (const part of parts.filter(Boolean)) expect(sent).not.toContain(part);
    }
  }
}

/** Finds a person's token in the prompt data by one of their task titles or numbers. */
export function tokenOf(entries, match) {
  const found = entries.find(match);
  expect(found, 'person in the prompt').toBeTruthy();
  return found.person;
}
