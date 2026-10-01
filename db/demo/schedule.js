// The hand-written part of the history: Vishal's month (03, 06), this week's team hours (05, 11)
// and today's attendance (09). Days are working-day offsets: 0 = the anchor ("Wed 30 Sep"),
// 1 = "Tue 29 Sep", 2 = "Mon 28 Sep", 3 = "Fri 25 Sep", ... 21 = "Tue 1 Sep".
//
// Late marks: the canvas never flags check-ins up to 9:40 (Vishal 9:31, 9:32 and 9:40, Simran
// 9:35) but flags 9:41 as "Late 11m", so the demo records late minutes only past a 10-minute grace
// (minutes are still counted from 9:30). The app's own rule has no grace; see the seed notes.
export const LATE_GRACE_MINUTES = 10;

// Entries are [projectKey, hours, tasks]; tasks are [title, status]. A task that continues a task
// of the same title and project in an earlier report of the same person is linked to it as
// carried over and keeps its first_reported_on.
const t = (title, status = 'done') => [title, status];

/** Vishal's days, offsets 0-21 (September on the canvas). 142h: internal 86, iwill 38, store 18. */
export const VISHAL_DAYS = [
  /* 0 Wed 30 */ day('09:32', '18:34', [
    ['iwill', 2, [t('Content changes')]],
    ['internal', 6, [t('Working on backend', 'in_progress')]],
  ]),
  /* 1 Tue 29 */ day('09:28', '18:31', [
    ['internal', 6, [t('Working on backend', 'in_progress')]],
    ['iwill', 2.5, [t('Contact form fixes')]],
  ]),
  /* 2 Mon 28 */ day('09:30', '18:40', [
    ['internal', 8.5, [t('Working on backend', 'in_progress')]],
  ]),
  /* 3 Fri 25 */ day(
    '09:31',
    '18:30',
    [
      ['internal', 6, [t('API for leave form', 'in_progress')]],
      ['store', 2, [t('Payment settings page', 'blocked')]],
    ],
    { revisions: 2 },
  ),
  /* 4 Thu 24 */ day(
    '09:40',
    '18:35',
    [['store', 8, [t('Checkout page fixes'), t('Payment settings page', 'in_progress')]]],
    { where: 'wfh' },
  ),
  /* 5 Wed 23 */ day('09:30', '18:32', [
    ['internal', 8, [t('API for leave form', 'in_progress'), t('Leave form validation')]],
  ]),
  /* 6 Tue 22 */ day('09:37', '18:36', [
    ['internal', 3.5, [t('Leave form review')]],
    ['iwill', 2.5, [t('Services page copy')]],
  ]),
  /* 7 Mon 21 */ day('09:38', '18:41', [
    ['internal', 5, [t('Attendance table')]],
    ['iwill', 1.5, [t('Testimonials section')]],
  ]),
  /* 8 Fri 18 */ day('09:35', '18:33', [
    ['internal', 6, [t('Login page polish'), t('Attendance table', 'in_progress')]],
  ]),
  /* 9 Thu 17 */ day('09:46', '18:44', [
    ['iwill', 5.5, [t('Contact page'), t('Image optimisation')]],
  ]),
  /* 10 Wed 16 */ day('09:36', '18:38', [
    ['internal', 3, [t('Export button')]],
    ['store', 4, [t('Cart drawer')]],
  ]),
  /* 11 Tue 15 */ day('09:39', '18:34', [['internal', 6, [t('Export button', 'in_progress')]]], {
    where: 'wfh',
  }),
  /* 12 Mon 14 */ day('09:33', '18:37', [
    ['iwill', 6.5, [t('Blog listing page'), t('Footer links')]],
  ]),
  /* 13 Fri 11 */ day('09:37', '18:32', [
    ['store', 4, [t('Product page layout')]],
    ['internal', 2, [t('Date picker fix')]],
  ]),
  /* 14 Thu 10 */ { absent: true },
  /* 15 Wed 9 */ day('09:34', '18:39', [
    ['internal', 6, [t('Role badge styles'), t('Settings page cleanup')]],
  ]),
  /* 16 Tue 8 */ day('09:42', '18:45', [['iwill', 6, [t('Blog listing page', 'in_progress')]]]),
  /* 17 Mon 7 */ day('09:39', '18:35', [
    ['internal', 3.5, [t('Table sorting')]],
    ['iwill', 3, [t('About page layout')]],
  ]),
  /* 18 Fri 4 */ day('09:36', '18:31', [
    ['internal', 6.5, [t('User list filters'), t('Table sorting', 'in_progress')]],
  ]),
  /* 19 Thu 3 */ day(
    '09:40',
    '18:36',
    [['iwill', 6, [t('Homepage hero section'), t('Mobile menu fixes')]]],
    { where: 'wfh' },
  ),
  /* 20 Wed 2 */ day('09:35', '18:33', [
    ['internal', 4, [t('Leave form layout')]],
    ['iwill', 2.5, [t('Homepage hero section', 'in_progress')]],
  ]),
  /* 21 Tue 1 */ day('09:38', '18:40', [['internal', 6, [t('Leave form layout', 'in_progress')]]]),
];

/** Vishal's report for "Fri 25 Sep" was edited once before it locked (06 shows "Edited"). */
export const VISHAL_FRI_FIRST_VERSION = {
  offset: 3,
  // Revision 1 had the acme-store task still in progress; revision 2 marked it blocked.
  change: { project: 'store', title: 'Payment settings page', status: 'in_progress' },
};

// This week's hours for everyone else, offsets 0-2 (Wed, Tue, Mon). With Vishal's days they
// give the whole-team numbers on 05 and 11 (see WEEK_TARGETS). `null` = no report that day.
// PMs log no hours (company rule); Nikhil, Ritu and Yash took over what the canvas had them log.
const W = (...entries) => entries;
export const WEEK_HOURS = {
  rohit: [null, W(['internal', 4], ['app', 3]), W(['internal', 5], ['app', 2])],
  simran: [W(['store', 8.5]), W(['store', 3], ['iwill', 3.5]), W(['store', 3], ['iwill', 4.5])],
  karan: [null, W(['app', 7]), W(['app', 7])],
  arjun: [W(['internal', 4]), W(['internal', 4]), W(['internal', 4])],
  pooja: [
    W(['store', 3], ['iwill', 2]),
    W(['store', 3], ['iwill', 2]),
    W(['store', 3], ['iwill', 2]),
  ],
  sahil: [null, W(['internal', 4], ['store', 1]), W(['internal', 4], ['store', 1.5])],
  rahul: [W(['internal', 4]), W(['internal', 4]), W(['internal', 4])],
  sneha: [W(['internal', 3], ['store', 2]), null, W(['internal', 3], ['store', 2])],
  manish: [
    W(['internal', 4], ['store', 1]),
    W(['internal', 3], ['store', 1]),
    W(['internal', 3], ['store', 1]),
  ],
  kavya: [
    W(['store', 3], ['iwill', 2]),
    W(['store', 3], ['iwill', 2]),
    W(['store', 3], ['iwill', 2]),
  ],
  harsh: [
    W(['internal', 1.5], ['app', 2]),
    W(['internal', 1.5], ['app', 2]),
    W(['internal', 1.5], ['app', 2]),
  ],
  divya: [
    W(['store', 3], ['iwill', 2]),
    W(['store', 3], ['iwill', 2]),
    W(['store', 3], ['iwill', 2]),
  ],
  nikhil: [
    W(['internal', 2], ['app', 2]),
    W(['internal', 2], ['app', 2]),
    W(['internal', 2], ['app', 2]),
  ],
  ritu: [
    W(['store', 4], ['iwill', 1]),
    W(['store', 4], ['iwill', 1]),
    W(['store', 4], ['iwill', 1]),
  ],
  yash: [
    W(['store', 3], ['iwill', 2]),
    W(['store', 3], ['iwill', 2]),
    W(['store', 3], ['iwill', 2]),
  ],
  priya: [W(['seo', 7.5]), W(['seo', 6]), W(['seo', 6])],
  ankit: [null, W(['seo', 6]), W(['seo', 6])],
  deepak: [null, W(['seo', 5]), W(['seo', 5])],
  meena: [W(['seo', 3], ['iwill', 2.5]), W(['seo', 3], ['iwill', 2]), W(['seo', 3], ['iwill', 2])],
  varun: [W(['seo', 5.5]), W(['seo', 4]), W(['seo', 4])],
  neha: [W(['hiring', 3]), W(['hiring', 3]), W(['hiring', 3])],
  anjali: [W(['hiring', 3]), W(['hiring', 3]), W(['hiring', 3])],
  aman: [W(['proposals', 8]), W(['proposals', 7]), W(['proposals', 7])],
  farhan: [W(['proposals', 6]), W(['proposals', 6]), null],
  meera: [W(['proposals', 2]), W(['proposals', 2]), W(['proposals', 2])],
};

/** Hours by project this week (Monday to the anchor) for the whole team, from 05 and 11. */
export const WEEK_TARGETS = {
  internal: 88,
  store: 72,
  seo: 64,
  iwill: 46,
  proposals: 40,
  app: 31,
  hiring: 18,
};

// Attendance on the three days of this week. 11 shows Mon: 22 office, 3 WFH, 1 not checked in;
// Tue: 21 office, 4 WFH, 1 not checked in; Wed: 20 office, 4 WFH, 2 not checked in.
export const WEEK_DAYS = [
  { absent: ['karan', 'deepak'], wfh: ['priya', 'simran', 'meena', 'divya'] },
  { absent: ['sneha'], wfh: ['pooja', 'meena', 'harsh', 'kavya'] },
  { absent: ['farhan'], wfh: ['simran', 'meena', 'rahul'] },
];

// Today's rows on Attendance (09) and the Team board (05). Everyone else checks in on time.
// `report`: 'none' (no report yet) or 'draft' (started, not submitted); 21 of 24 submitted.
export const TODAY = {
  vishal: { in: '09:32', out: '18:34' },
  priya: { in: '09:41', out: '18:45', note: 'Plumber visit, online by 9:40' },
  rohit: { in: '10:08', report: 'none' },
  ankit: { in: '09:58', unverified: true, note: 'Office Wi-Fi was down', report: 'draft' },
  aman: { in: '09:30', out: '18:15' },
  simran: { in: '09:35' },
  sahil: { report: 'none' },
};

// Tue 29: Deepak forgot to check out; the midnight job marked it missing (09).
export const MISSING_CHECKOUT = { key: 'deepak', offset: 1, in: '09:24' };

// Reports that later screens point at must exist: requests on 08, the correction on 09.
export const FORCE_PRESENT = [
  ['ankit', 3],
  ['simran', 6],
  ['deepak', 8],
  ['priya', 10],
  ['karan', 12],
];

function day(checkIn, checkOut, entries, extra = {}) {
  return { in: checkIn, out: checkOut, where: 'office', entries, revisions: 1, ...extra };
}
