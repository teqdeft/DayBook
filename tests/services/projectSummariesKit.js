// Shared set-up for the project summary tests: a fake Gemini (the real API is never called) and a
// sample answer that matches the sample documents.
import { expect } from 'vitest';
import { ai } from '@/modules/ai';
import { projectSummaries } from '@/modules/projectSummaries';

export const T0 = '2026-10-30T06:00:00Z'; // Friday 30 October 2026, 11:30 AM in Kolkata

export const SOW_TEXT = [
  'Statement of work for Acme Clinics.',
  'Patients can book, move or cancel a visit.',
  'SMS reminders are out of scope for phase one.',
  'Go-live on 15 December.',
].join('\f');
export const NOTE_TEXT =
  'Client approved the scope on the call. Payment provider not chosen yet. Client will send logo and brand files by Friday.';

/** D1 is the note (newest), D2 the file. */
export const SAMPLE_ANSWER = Object.freeze({
  overview: 'A booking app for the 12 Acme clinics.',
  scope: [
    {
      text: 'Patient booking',
      notInScope: false,
      doc: 'D2',
      quote: 'Patients can book, move or cancel a visit.',
    },
    {
      text: 'SMS reminders',
      notInScope: true,
      doc: 'D2',
      quote: 'SMS reminders are out of scope',
    },
  ],
  deadlines: [
    {
      text: 'Go-live: 15 December',
      dateAsWritten: '15 December',
      doc: 'D2',
      quote: 'Go-live on 15 December',
    },
  ],
  risks: [
    {
      text: 'Payment provider not chosen yet',
      kind: 'risk',
      doc: 'D1',
      quote: 'Payment provider not chosen yet',
    },
  ],
  actions: [
    {
      owner: 'client',
      text: 'Send logo and brand files',
      dueAsWritten: 'Friday',
      doc: 'D1',
      quote: 'send logo and brand files by Friday',
    },
    {
      owner: 'us',
      text: 'Share the clickable wireframes',
      dueAsWritten: null,
      doc: 'D1',
      quote: 'Client approved the scope',
    },
  ],
  nextPhase: { phase: 'design', doc: 'D1', quote: 'Client approved the scope on the call' },
});

/**
 * Gemini answers with this JSON (or what a function of the request returns).
 * @returns {Array<{ model: string, body: object }>} the requests sent, as they fill up
 */
export function geminiAnswers(answer, { status = 200 } = {}) {
  const requests = [];
  ai.setTransportForTests(async (request) => {
    requests.push(structuredClone({ model: request.model, body: request.body }));
    const data = typeof answer === 'function' ? answer(request) : answer;
    return { status, data: ai.fakeGeminiResponse({ data }) };
  });
  return requests;
}

export const promptOf = (request) => request.body.contents[0].parts[0].text;
export const systemOf = (request) => request.body.systemInstruction.parts[0].text;
export const markerOf = (request) => /^([A-Z]{24}) BEGIN D1$/m.exec(promptOf(request))[1];

/** The text of one document between its markers, as the request sent it. */
export function sentDocument(request, ref) {
  const marker = markerOf(request);
  const prompt = promptOf(request);
  const start = prompt.indexOf(`${marker} BEGIN ${ref}\n`);
  const end = prompt.indexOf(`${marker} END ${ref}`);
  return start === -1 || end === -1 ? null : prompt.slice(start, end);
}

export async function expectAppError(promise, code) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  expect(error, `expected ${code}`).not.toBeNull();
  expect(error.code).toBe(code);
  return error;
}

/** Adds the sample file and then the sample note. */
export async function addSampleDocuments(user, project) {
  const file = await projectSummaries.addDocument({
    user,
    projectId: project.id,
    input: {
      phase: 'requirement_gathering',
      kind: 'file',
      title: 'SOW-Acme-v3.pdf',
      text: SOW_TEXT,
      pages: 4,
      pagesTotal: 4,
    },
    ip: '10.0.0.1',
  });
  const note = await projectSummaries.addDocument({
    user,
    projectId: project.id,
    input: {
      phase: 'requirement_gathering',
      kind: 'note',
      title: 'Kickoff call notes',
      text: NOTE_TEXT,
    },
    ip: '10.0.0.1',
  });
  return { file, note };
}
