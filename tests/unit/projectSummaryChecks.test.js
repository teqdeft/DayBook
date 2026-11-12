// What Daybook keeps of an AI answer (CONTRACT 22): how quotes are compared, the page Daybook finds
// itself between form feeds, invented quotes dropped and counted, unknown phases dropped, lengths
// capped, and action keys that stay the same across rewrites.
import { describe, expect, it } from 'vitest';
import {
  actionKey,
  checkAnswer,
  findQuote,
  keepTaskIds,
  normalizeForMatch,
  sourceLabel,
} from '@/modules/projectSummaries/checks';

const FILE = {
  ref: 'D1',
  id: 11,
  kind: 'file',
  title: 'SOW-Acme-v3.pdf',
  pages: 4,
  text: 'Cover page\fPatients can book a visit.\fSMS reminders are out of scope.\fGo-live on 15 December.',
};
const NOTE = {
  ref: 'D2',
  id: 12,
  kind: 'note',
  title: 'Kickoff call notes',
  pages: null,
  text: 'Client approved the scope on the call. Send logo and brand files by Friday.',
};

const scopePoint = (overrides = {}) => ({
  text: 'Patient booking',
  notInScope: false,
  doc: 'D1',
  quote: 'Patients can book a visit',
  ...overrides,
});

const answerOf = (overrides = {}) => ({
  overview: 'A booking app.',
  scope: [],
  deadlines: [],
  risks: [],
  actions: [],
  nextPhase: { phase: null, doc: null, quote: null },
  ...overrides,
});

const check = (answer, documents = [FILE, NOTE], options) =>
  checkAnswer(answer, documents, options);

describe('normalizeForMatch', () => {
  it('applies NFKC, so compatibility forms compare equal', () => {
    expect(normalizeForMatch('\u{FB01}nal \u{FF31}\u{FF13} \u{FB00}')).toBe('final q3 ff');
    expect(normalizeForMatch('a\u{A0}b')).toBe('a b');
  });

  it('strips zero-width characters and soft hyphens', () => {
    expect(normalizeForMatch('sc\u{200B}o\u{200C}p\u{200D}e')).toBe('scope');
    expect(normalizeForMatch('re\u{AD}quire\u{AD}ment')).toBe('requirement');
  });

  it('collapses spaces, line breaks and form feeds', () => {
    expect(normalizeForMatch('  one\n\ntwo\t three\ffour  ')).toBe('one two three four');
  });

  it('unifies quote marks', () => {
    expect(normalizeForMatch('the \u{201C}client\u{201D}\u{2019}s \u{2018}call\u{2019}')).toBe(
      normalizeForMatch("the \"client\"'s 'call'"),
    );
    expect(normalizeForMatch('\u{AB}ok\u{BB}')).toBe('"ok"');
  });

  it('case-folds, including letters whose case changes their length', () => {
    expect(normalizeForMatch('GO-LIVE Scope')).toBe(normalizeForMatch('go-live scope'));
    expect(normalizeForMatch('STRASSE')).toBe(normalizeForMatch('straße'));
  });

  it('joins words hyphenated across lines', () => {
    expect(normalizeForMatch('imple-\nmentation')).toBe('implementation');
    expect(normalizeForMatch('imple-\r\n  mentation')).toBe('implementation');
    expect(normalizeForMatch('imple-\fmentation')).toBe('implementation');
    expect(normalizeForMatch('imple\u{2010}\nmentation')).toBe('implementation');
    expect(normalizeForMatch('imple- mentation')).toBe('implementation');
    // A dash between words isn't a broken word, and dates stay as they are.
    expect(normalizeForMatch('scope - signed')).toBe('scope - signed');
    expect(normalizeForMatch('2026-12-15')).toBe('2026-12-15');
  });

  it('copes with nothing', () => {
    expect(normalizeForMatch(null)).toBe('');
    expect(normalizeForMatch(undefined)).toBe('');
  });
});

describe('findQuote', () => {
  it('finds a quote whatever the case, spacing and quote marks', () => {
    const document = {
      text: 'The client said: \u{201C}Scope   is\nsigned off.\u{201D} Next week.',
    };
    expect(findQuote(document, '"scope is signed off."').found).toBe(true);
    expect(findQuote(document, 'SCOPE IS SIGNED OFF').found).toBe(true);
  });

  it('takes off the quote marks a model wraps a quote in', () => {
    expect(findQuote(NOTE, '"Client approved the scope"').found).toBe(true);
    expect(findQuote(NOTE, '\u{201C}Client approved the scope\u{201D}').found).toBe(true);
  });

  it('finds no invented quote', () => {
    expect(findQuote(NOTE, 'The client approved the budget')).toEqual({ found: false, page: null });
  });

  it('finds no quote too short to mean anything, or an empty one', () => {
    expect(findQuote(NOTE, 'on').found).toBe(false);
    expect(findQuote(NOTE, '   ').found).toBe(false);
    expect(findQuote(NOTE, '""').found).toBe(false);
  });

  it('gives the page between form feeds', () => {
    expect(findQuote(FILE, 'Cover page').page).toBe(1);
    expect(findQuote(FILE, 'Patients can book').page).toBe(2);
    expect(findQuote(FILE, 'SMS reminders').page).toBe(3);
    expect(findQuote(FILE, 'Go-live on 15 December').page).toBe(4);
  });

  it('counts an empty page', () => {
    expect(findQuote({ text: '\f\fThird page text' }, 'Third page').page).toBe(3);
  });

  it('gives the first page a repeated quote is on', () => {
    expect(findQuote({ text: 'nothing\fsame words\fsame words' }, 'same words').page).toBe(2);
  });

  it('gives the page a quote starts on when it runs over a page break', () => {
    const document = { text: 'One\fThe work ends\fon Friday\fFour' };
    expect(findQuote(document, 'The work ends on Friday')).toEqual({ found: true, page: 2 });
    const hyphenated = { text: 'One\fThe imple-\fmentation ends' };
    expect(findQuote(hyphenated, 'implementation ends')).toEqual({ found: true, page: 2 });
  });

  it('gives the page a quote starts on when it goes on after blank pages', () => {
    const quote = 'The client will send the logo by Friday';
    const blank = { text: 'Cover\fThe client will send\f\fthe logo by Friday.' };
    expect(findQuote(blank, quote)).toEqual({ found: true, page: 2 });
    const many = {
      text: `Cover\fIntro\fThe client will send\f${'\f'.repeat(30)}the logo by Friday.`,
    };
    expect(findQuote(many, quote)).toEqual({ found: true, page: 3 });
    const threePages = { text: 'One\fThe client\fwill send\fthe logo by Friday' };
    expect(findQuote(threePages, quote)).toEqual({ found: true, page: 2 });
  });

  it('gives a later page when the pages after the first hold the whole quote', () => {
    const document = { text: 'Cover ends with The client\f\fThe client will send\fthe logo' };
    expect(findQuote(document, 'The client will send the logo')).toEqual({ found: true, page: 3 });
  });

  it('finds the page in a long file without reading each page many times', () => {
    const pages = Array.from({ length: 100 }, (_, i) => `Page ${i} ${'words '.repeat(80)}`);
    const document = { text: [...pages, 'The work ends', '', 'on Friday'].join('\f') };
    const started = performance.now();
    expect(findQuote(document, 'The work ends on Friday')).toEqual({ found: true, page: 101 });
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('finds Hindi text, also with other zero-width marks and nukta forms', () => {
    const composed = 'ग्राहक ने दायरे को मं\u{95B}ूरी दी।'; // one character for "za"
    const decomposed = 'ग्राहक ने दायरे को मं\u{91C}\u{93C}ूरी दी'; // "ja" and a nukta
    expect(composed).not.toBe(decomposed);
    const document = { text: `पहला पन्ना\f${composed}` };
    expect(findQuote(document, decomposed)).toEqual({ found: true, page: 2 });
    expect(findQuote(document, 'ग्\u{200D}राहक ने दायरे').found).toBe(true);
    expect(findQuote(document, 'ग्राहक ने बजट को मंज़ूरी दी').found).toBe(false);
  });

  it('finds Punjabi text, also with nukta forms and joined across lines', () => {
    const composed = 'ਗਾਹਕ ਨੇ ਸਕੋਪ ਨੂੰ ਮਨ\u{A5B}ੂਰੀ ਦਿੱਤੀ'; // one character for "za"
    const decomposed = 'ਗਾਹਕ ਨੇ ਸਕੋਪ ਨੂੰ ਮਨ\u{A1C}\u{A3C}ੂਰੀ ਦਿੱਤੀ'; // "ja" and a nukta
    expect(composed).not.toBe(decomposed);
    const document = { text: `ਪਹਿਲਾ ਪੰਨਾ\f${composed}\fਤੀਜਾ` };
    expect(findQuote(document, decomposed)).toEqual({ found: true, page: 2 });
    expect(findQuote({ text: 'ਸਕੋਪ\nਨੂੰ' }, 'ਸਕੋਪ ਨੂੰ').found).toBe(true);
    expect(findQuote({ text: 'ਮਨ-\nਜ਼ੂਰੀ ਦਿੱਤੀ' }, 'ਮਨਜ਼ੂਰੀ ਦਿੱਤੀ').found).toBe(true);
    expect(findQuote(document, 'ਗਾਹਕ ਨੇ ਬਜਟ').found).toBe(false);
  });

  it('finds a word hyphenated at a line end, written either way', () => {
    const document = { text: 'The imple-\nmentation of the well-\nknown calendar.' };
    expect(findQuote(document, 'implementation of the').found).toBe(true);
    expect(findQuote(document, 'imple-\nmentation of the').found).toBe(true);
    expect(findQuote(document, 'well-known calendar').found).toBe(true);
    expect(findQuote(document, 'wellknown calendar').found).toBe(true);
  });
});

describe('sourceLabel', () => {
  it('names a file and its page, a note by its title alone', () => {
    expect(sourceLabel(FILE, 3)).toBe('SOW-Acme-v3.pdf, page 3');
    expect(sourceLabel(NOTE, 1)).toBe('Kickoff call notes');
  });

  it('leaves the page out of a file without pages', () => {
    expect(sourceLabel({ kind: 'file', title: 'brief.txt', pages: null }, 1)).toBe('brief.txt');
    expect(sourceLabel(FILE, null)).toBe('SOW-Acme-v3.pdf');
  });
});

describe('checkAnswer', () => {
  it('keeps a point whose quote is in its document, with the page found by Daybook', () => {
    const { body, droppedCount } = check(
      answerOf({ scope: [scopePoint({ page: 99, source: 'made up', html: '<b>x</b>' })] }),
    );
    expect(droppedCount).toBe(0);
    expect(body.scope).toEqual([
      {
        text: 'Patient booking',
        notInScope: false,
        documentId: 11,
        page: 2,
        source: 'SOW-Acme-v3.pdf, page 2',
        quote: 'Patients can book a visit',
      },
    ]);
  });

  it('gives a note its title as the source', () => {
    const { body } = check(
      answerOf({
        deadlines: [{ text: 'Files', dateAsWritten: 'Friday', doc: 'D2', quote: 'by Friday' }],
      }),
    );
    expect(body.deadlines[0]).toMatchObject({
      source: 'Kickoff call notes',
      dateAsWritten: 'Friday',
    });
  });

  it('drops and counts an invented quote', () => {
    const { body, droppedCount } = check(
      answerOf({
        scope: [scopePoint(), scopePoint({ text: 'Invented', quote: 'Unlimited free support' })],
      }),
    );
    expect(body.scope.map((point) => point.text)).toEqual(['Patient booking']);
    expect(droppedCount).toBe(1);
  });

  it('drops a quote that is real but in another document', () => {
    const { body, droppedCount } = check(answerOf({ scope: [scopePoint({ doc: 'D2' })] }));
    expect(body.scope).toEqual([]);
    expect(droppedCount).toBe(1);
  });

  it('drops a document that was never sent, also odd ids', () => {
    for (const doc of ['D9', 'd1', '__proto__', 'constructor']) {
      const { body, droppedCount } = check(answerOf({ scope: [scopePoint({ doc })] }));
      expect(body.scope, doc).toEqual([]);
      expect(droppedCount, doc).toBe(1);
    }
  });

  it('drops points of the wrong shape', () => {
    const { body, droppedCount } = check(
      answerOf({
        scope: ['just a string', null, 7, scopePoint({ text: '' }), scopePoint({ text: 5 })],
        risks: [{ text: 'A', kind: 'threat', doc: 'D2', quote: 'Client approved' }],
        actions: [{ owner: 'martians', text: 'Land', doc: 'D2', quote: 'Client approved' }],
      }),
    );
    expect(body.scope).toEqual([]);
    expect(body.risks).toEqual([]);
    expect(body.actions).toEqual([]);
    expect(droppedCount).toBe(7);
  });

  it('keeps at most 5 points of each kind and counts the rest', () => {
    const { body, droppedCount } = check(
      answerOf({ scope: Array.from({ length: 8 }, (_, i) => scopePoint({ text: `Point ${i}` })) }),
    );
    expect(body.scope).toHaveLength(5);
    expect(droppedCount).toBe(3);
  });

  it('caps every string and keeps text plain', () => {
    const long = 'x'.repeat(5000);
    const { body } = check(
      answerOf({
        overview: `${long}\n<script>alert(1)</script>`,
        deadlines: [
          { text: long, dateAsWritten: long, doc: 'D2', quote: 'Client approved the scope' },
        ],
        actions: [{ owner: 'us', text: long, dueAsWritten: long, doc: 'D2', quote: `by Friday` }],
      }),
    );
    expect(body.overview).toHaveLength(400);
    expect(body.deadlines[0].text).toHaveLength(200);
    expect(body.deadlines[0].dateAsWritten).toHaveLength(80);
    expect(body.actions[0].text).toHaveLength(200);
    expect(body.actions[0].dueAsWritten).toHaveLength(80);
  });

  it('keeps markup as plain words and never reads it', () => {
    const { body } = check(answerOf({ overview: '<img src=x onerror=alert(1)> A booking app.' }));
    expect(body.overview).toBe('<img src=x onerror=alert(1)> A booking app.');
  });

  it('never cuts an emoji in half', () => {
    const { body } = check(answerOf({ overview: `${'x'.repeat(399)}😀 end` }));
    expect(body.overview).toBe('x'.repeat(399));
  });

  it('accepts a point with no date and a null owner date', () => {
    const { body } = check(
      answerOf({
        deadlines: [{ text: 'Soon', doc: 'D2', quote: 'by Friday' }],
        actions: [
          { owner: 'unclear', text: 'Call', dueAsWritten: null, doc: 'D2', quote: 'on the call' },
        ],
      }),
    );
    expect(body.deadlines[0].dateAsWritten).toBeNull();
    expect(body.actions[0].dueAsWritten).toBeNull();
  });

  it('turns notInScope into a real boolean', () => {
    const { body } = check(
      answerOf({
        scope: [
          scopePoint({ notInScope: true, doc: 'D1', quote: 'SMS reminders' }),
          scopePoint({ notInScope: null }),
        ],
      }),
    );
    expect(body.scope.map((point) => point.notInScope)).toEqual([true, false]);
    const wrong = check(answerOf({ scope: [scopePoint({ notInScope: 'yes' })] }));
    expect(wrong.body.scope).toEqual([]);
  });

  it('runs finish on what is kept, after the quote was checked', () => {
    const documents = [
      { ...NOTE, text: 'Person 1 approved the scope.', title: 'Notes on Person 1' },
    ];
    const finish = (text) => text.replace('Person 1', 'Riya Kapoor');
    const { body } = check(
      answerOf({
        overview: 'Led by Person 1.',
        scope: [{ text: 'Person 1 said yes', doc: 'D2', quote: 'Person 1 approved' }],
      }),
      documents,
      { finish },
    );
    expect(body.overview).toBe('Led by Riya Kapoor.');
    expect(body.scope[0]).toMatchObject({
      text: 'Riya Kapoor said yes',
      quote: 'Riya Kapoor approved',
      source: 'Notes on Riya Kapoor',
    });
  });

  it('caps again after finish made a string longer', () => {
    const documents = [{ ...NOTE, text: 'Person 1 approved the scope.' }];
    const finish = (text) => text.replace('Person 1', 'R'.repeat(50));
    const { body } = check(
      answerOf({
        overview: `Person 1 ${'x'.repeat(390)}`,
        actions: [
          {
            owner: 'us',
            text: `Person 1 ${'y'.repeat(190)}`,
            doc: 'D2',
            quote: 'Person 1 approved',
          },
        ],
      }),
      documents,
      { finish },
    );
    expect(body.overview).toHaveLength(400);
    expect(body.actions[0].text).toHaveLength(200);
  });

  it('answers null for no answer or nothing to show', () => {
    for (const nothing of [null, undefined, 'text', 7, [], ['overview']]) {
      expect(check(nothing), String(nothing)).toBeNull();
    }
    expect(check({})).toBeNull();
    expect(
      check(answerOf({ overview: '  ', scope: [scopePoint({ quote: 'not there at all' })] })),
    ).toBeNull();
  });

  it('keeps an overview when every point was dropped', () => {
    const result = check(answerOf({ scope: [scopePoint({ quote: 'not there at all' })] }));
    expect(result.body.overview).toBe('A booking app.');
    expect(result.droppedCount).toBe(1);
  });
});

describe('nextPhase', () => {
  const suggestion = { phase: 'design', doc: 'D2', quote: 'Client approved the scope' };

  it('keeps a known phase with a found quote', () => {
    const { body, droppedCount } = check(answerOf({ nextPhase: suggestion }));
    expect(droppedCount).toBe(0);
    expect(body.nextPhase).toEqual({
      phase: 'design',
      documentId: 12,
      page: 1,
      source: 'Kickoff call notes',
      quote: 'Client approved the scope',
    });
  });

  it('is not a dropped point when the AI suggests nothing', () => {
    for (const nextPhase of [undefined, null, { phase: null, doc: null, quote: null }]) {
      const { body, droppedCount } = check(answerOf({ nextPhase }));
      expect(body.nextPhase).toBeNull();
      expect(droppedCount).toBe(0);
    }
  });

  it('needs its quote', () => {
    const { body, droppedCount } = check(
      answerOf({ nextPhase: { phase: 'design', doc: 'D2', quote: 'The client loved it' } }),
    );
    expect(body.nextPhase).toBeNull();
    expect(droppedCount).toBe(1);
    expect(check(answerOf({ nextPhase: { phase: 'design' } })).body.nextPhase).toBeNull();
  });

  it('drops an unknown phase, even with a real quote', () => {
    for (const phase of ['launched', 'Launch', 'design; DROP TABLE', '', 3, {}]) {
      const { body, droppedCount } = check(answerOf({ nextPhase: { ...suggestion, phase } }));
      expect(body.nextPhase, String(phase)).toBeNull();
      expect(droppedCount, String(phase)).toBe(1);
    }
  });

  it('answers only the fields Daybook knows', () => {
    const { body } = check(answerOf({ nextPhase: { ...suggestion, moveNow: true } }));
    expect(body.nextPhase).not.toHaveProperty('moveNow');
  });
});

describe('action keys', () => {
  const action = (overrides = {}) => ({
    owner: 'client',
    text: 'Send logo and brand files',
    dueAsWritten: 'Friday',
    doc: 'D2',
    quote: 'Send logo and brand files by Friday',
    ...overrides,
  });

  it('gives each item a stable key from its normalised owner and text', () => {
    expect(actionKey('client', 'Send  LOGO files')).toBe(actionKey('CLIENT', 'send logo files'));
    expect(actionKey('client', 'Send logo')).not.toBe(actionKey('us', 'Send logo'));
    expect(actionKey('us', 'Send logo')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('adds the key and an empty task to each stored item', () => {
    const { body } = check(answerOf({ actions: [action()] }));
    expect(body.actions[0]).toMatchObject({
      key: actionKey('client', 'Send logo and brand files'),
      owner: 'client',
      taskId: null,
      source: 'Kickoff call notes',
    });
  });

  it('makes the key from the text with the names back, so tokens can renumber', () => {
    const swap = (token) => (text) => text.replace(token, 'Neha Arora');
    const one = check(
      answerOf({ actions: [action({ text: 'Person 1 sends the logo' })] }),
      undefined,
      { finish: swap('Person 1') },
    );
    const two = check(
      answerOf({ actions: [action({ text: 'Person 2 sends the logo' })] }),
      undefined,
      { finish: swap('Person 2') },
    );
    expect(one.body.actions[0].key).toBe(two.body.actions[0].key);
  });

  it('drops the same item twice', () => {
    const { body, droppedCount } = check(
      answerOf({ actions: [action(), action({ text: 'send logo  and brand files' })] }),
    );
    expect(body.actions).toHaveLength(1);
    expect(droppedCount).toBe(1);
  });

  it('drops an action too short to be a task', () => {
    const { body, droppedCount } = check(answerOf({ actions: [action({ text: 'x' })] }));
    expect(body.actions).toEqual([]);
    expect(droppedCount).toBe(1);
  });

  it('keeps the task of an item with the same key on a rewrite', () => {
    const actions = [
      { key: 'a', taskId: null },
      { key: 'b', taskId: null },
    ];
    const previous = [
      { key: 'a', taskId: 7 },
      { key: 'gone', taskId: 8 },
    ];
    expect(keepTaskIds(actions, previous)).toEqual([
      { key: 'a', taskId: 7 },
      { key: 'b', taskId: null },
    ]);
    expect(keepTaskIds(actions)).toEqual(actions);
  });
});
