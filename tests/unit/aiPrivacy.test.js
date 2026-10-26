// AI privacy helpers (CONTRACT 20): people as tokens and back, and contact details scrubbed from
// everything sent to Gemini.
import { describe, expect, it } from 'vitest';
import {
  createRedactor,
  PEOPLE_TOKEN_NOTE,
  pseudonymize,
  redactContacts,
  restoreNames,
} from '@/modules/ai/privacy';

describe('pseudonymize', () => {
  it('gives tokens in order and keeps one token per person', () => {
    const people = pseudonymize([
      { id: 7, name: 'Asha Rao' },
      { id: 3, name: 'Vikram Shah' },
      { id: 7, name: 'Asha Rao' },
    ]);
    expect(people.tokenFor(7)).toBe('Person 1');
    expect(people.tokenFor('3')).toBe('Person 2');
    expect(people.names).toEqual({ 'Person 1': 'Asha Rao', 'Person 2': 'Vikram Shah' });
  });

  it('refuses someone without a token, so a name never slips through', () => {
    const people = pseudonymize([{ id: 1, name: 'Asha Rao' }]);
    expect(() => people.tokenFor(2)).toThrow(/no token/);
  });

  it('explains the tokens for a system prompt', () => {
    expect(PEOPLE_TOKEN_NOTE).toContain('"Person 1"');
  });
});

describe('restoreNames', () => {
  const { names } = pseudonymize(
    Array.from({ length: 12 }, (_, index) => ({ id: index + 1, name: `Name ${index + 1}` })),
  );

  it('puts names back in text, telling Person 1 from Person 12', () => {
    expect(restoreNames('Person 1 helped Person 12. Person 1’s tasks are done.', names)).toBe(
      'Name 1 helped Name 12. Name 1’s tasks are done.',
    );
  });

  it('leaves priority labels and unknown tokens alone', () => {
    expect(restoreNames('P1 task done by Person 2; Person 99 is unknown.', names)).toBe(
      'P1 task done by Name 2; Person 99 is unknown.',
    );
  });

  it('restores every string of a JSON answer', () => {
    expect(
      restoreNames(
        { title: 'Person 3 shipped', body: '- Person 4: 2h 15m', items: ['Person 5', 7, null] },
        names,
      ),
    ).toEqual({ title: 'Name 3 shipped', body: '- Name 4: 2h 15m', items: ['Name 5', 7, null] });
  });
});

describe('redactContacts', () => {
  it.each([
    ['Mailed jane.doe+qa@acme.co.in about it', 'Mailed [email] about it'],
    ['Call +91 98765 43210 today', 'Call [phone] today'],
    ['Call 98765 43210 today', 'Call [phone] today'],
    ['Call (555) 123-4567', 'Call [phone]'],
    ['Call 9876543210', 'Call [phone]'],
    ['Server 192.168.1.20 was down', 'Server [ip] was down'],
    ['From 2001:db8:85a3::8a2e:370:7334 again', 'From [ip] again'],
    ['From fe80::1 again', 'From [ip] again'],
    ['Asked <@U01ABCDEF2> and W0123ABCD9', 'Asked [slack id] and [slack id]'],
    // A country or trunk code written without "+", as phone numbers are usually written.
    ['Called client on 91 98765 43210 re invoice', 'Called client on [phone] re invoice'],
    ['Call 91-98765-43210', 'Call [phone]'],
    ['Call 91 9876543210', 'Call [phone]'],
    ['Call 0 98765 43210', 'Call [phone]'],
    ['Toll free 1-800-555-0199', 'Toll free [phone]'],
    ['Office 1 415 555 0132', 'Office [phone]'],
    ['Call 0091 98765 43210', 'Call [phone]'],
    // Emails in any script.
    ['Wrote to rené@exemple.fr', 'Wrote to [email]'],
    ['Wrote to vishal@exämple.de', 'Wrote to [email]'],
    ['Wrote to राम@उदाहरण.भारत', 'Wrote to [email]'],
    ['Wrote to first_last%x@sub.example.com.', 'Wrote to [email].'],
  ])('redacts %s', (text, expected) => {
    expect(redactContacts(text)).toBe(expected);
  });

  it.each([
    'Worked 2026-10-01 to 2026-10-26',
    'Started 2026-10-26T04:00:00Z',
    'Minutes 120 45 300 60',
    'Meeting at 10:30:00 and 9:00',
    'UNASSIGNED tickets, P1 bug, v1.05, ticket #123456',
    'Hours: 8h 30m, 2h 15m',
    'Minutes 1 120 45 300',
    'Tickets 12 345 and 678',
    'Logged 8 450 600 minutes',
    'Café menu, naïve résumé',
  ])('keeps %s', (text) => {
    expect(redactContacts(text)).toBe(text);
  });
});

describe('createRedactor', () => {
  it('numbers each detail, reuses the number and puts the details back', () => {
    const redactor = createRedactor();
    const sent = redactor.redact('Mail a@b.io, then c@d.io, then a@b.io; call +91 98765 43210');
    expect(sent).toBe('Mail [email 1], then [email 2], then [email 1]; call [phone 1]');
    expect(redactor.restore(`Reply to [email 2] and [phone 1]; [email 9] stays`)).toBe(
      'Reply to c@d.io and +91 98765 43210; [email 9] stays',
    );
  });

  it('redacts and restores every string in a JSON value', () => {
    const redactor = createRedactor();
    const sent = redactor.redactDeep({ rows: [{ note: 'ping a@b.io', minutes: 30 }], ok: true });
    expect(sent).toEqual({ rows: [{ note: 'ping [email 1]', minutes: 30 }], ok: true });
    expect(redactor.restore({ title: 'Ask [email 1]', items: ['[email 1]', 2] })).toEqual({
      title: 'Ask a@b.io',
      items: ['a@b.io', 2],
    });
  });
});
