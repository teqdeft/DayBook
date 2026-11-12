// acme-store's files and notes and its AI summary (CONTRACT 22), for the demo. Only the text of a
// file is ever stored, so the "PDF" here is its pages of text. The summary is written by hand in the
// shape of the AI's answer (no AI was asked): projectPlanRows.js runs it through the same checks a
// real answer goes through, so every quote must be found in the document it names.
//
// `added` and `written` are 'week weekday' (see projectPlans.js) and a clock time. Documents are
// newest first, as the summary's prompt lists them (D1, D2, …).

const CALL_NOTE = [
  'Checkout designs are signed off.',
  'Card payments still fail on the last step of the checkout.',
  'Acme still has to send the payment gateway keys.',
  'The warehouse system has no API yet, so stock sync may slip.',
  "Product photos come from Acme's studio by Friday.",
  'Next call: show the checkout working end to end, then start testing.',
].join('\n');

const SOW_PAGES = [
  [
    'Statement of work: acme-store',
    'Client: Acme Retail',
    "A new online store for Acme Retail's shops, with card payments, cash on delivery and order tracking.",
  ],
  [
    'Scope',
    'Customers can browse products, search, filter and buy with a card or cash on delivery.',
    'Staff manage products, stock and orders in one admin screen.',
    'Gift cards and a loyalty programme are out of scope for this release.',
  ],
  [
    'Timeline',
    'Designs are signed off before development starts.',
    "Testing by Acme's team takes two weeks.",
    'The store goes live before the holiday sale.',
  ],
  [
    'Responsibilities',
    'Acme Retail sends the payment gateway keys and the product photos.',
    'We build, test and launch the store, and support it for one month after launch.',
  ],
].map((lines) => lines.join('\n'));

export const STORE_DOCUMENTS = [
  {
    ref: 'D1',
    kind: 'note',
    title: 'Weekly call with Acme Retail',
    phase: 'development',
    added: ['-1 Thu', '16:30'],
    pages: [CALL_NOTE],
  },
  {
    ref: 'D2',
    kind: 'file',
    title: 'Acme-store-SOW-v2.pdf',
    phase: 'requirement_gathering',
    added: ['-8 Tue', '15:10'],
    pages: SOW_PAGES,
  },
];

/** A point of the answer: what it says, the document it comes from and the words it rests on. */
const from = (doc, quote, fields) => ({ ...fields, doc, quote });

export const STORE_SUMMARY = {
  written: ['-1 Thu', '17:05'],
  answer: {
    overview:
      "An online store for Acme Retail's shops: customers buy with a card or cash on delivery, and " +
      'staff manage products, stock and orders in one admin screen. The checkout is being built; ' +
      'the payment gateway keys and the stock sync are holding it up.',
    scope: [
      from(
        'D2',
        'Customers can browse products, search, filter and buy with a card or cash on delivery.',
        { text: 'Browse, search, filter and buy with a card or cash on delivery' },
      ),
      from('D2', 'Staff manage products, stock and orders in one admin screen.', {
        text: 'One admin screen for products, stock and orders',
      }),
      from('D2', 'Gift cards and a loyalty programme are out of scope for this release.', {
        text: 'Gift cards and a loyalty programme',
        notInScope: true,
      }),
    ],
    deadlines: [
      from('D2', 'The store goes live before the holiday sale.', {
        text: 'The store goes live before the holiday sale',
        dateAsWritten: 'before the holiday sale',
      }),
      from('D2', "Testing by Acme's team takes two weeks.", {
        text: "Acme's team tests for two weeks",
        dateAsWritten: null,
      }),
      from('D1', "Product photos come from Acme's studio by Friday.", {
        text: "Product photos from Acme's studio",
        dateAsWritten: 'by Friday',
      }),
    ],
    risks: [
      from('D1', 'Card payments still fail on the last step of the checkout.', {
        text: 'Card payments still fail on the last step of the checkout',
        kind: 'risk',
      }),
      from('D1', 'The warehouse system has no API yet, so stock sync may slip.', {
        text: 'The warehouse system has no API yet, so the stock sync may slip',
        kind: 'risk',
      }),
      from('D1', 'Acme still has to send the payment gateway keys.', {
        text: 'When will Acme send the payment gateway keys?',
        kind: 'question',
      }),
    ],
    actions: [
      from('D1', 'Acme still has to send the payment gateway keys.', {
        owner: 'client',
        text: 'Send the payment gateway keys',
        dueAsWritten: null,
      }),
      from('D1', "Product photos come from Acme's studio by Friday.", {
        owner: 'client',
        text: 'Send the product photos',
        dueAsWritten: 'Friday',
      }),
      from('D1', 'Next call: show the checkout working end to end, then start testing.', {
        owner: 'us',
        text: 'Show the checkout working end to end',
        dueAsWritten: 'Next call',
      }),
    ],
    nextPhase: from('D1', 'show the checkout working end to end, then start testing', {
      phase: 'testing',
    }),
  },
};
