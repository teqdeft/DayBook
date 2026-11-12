// Project plans (CONTRACT 22) for three demo projects, so the Projects list and the project page show
// every health: acme-store is off track, internal-tool at risk and iwilltillimwell on track. The other
// projects have no plan: their priority tasks (priority.js) wait under "No phase yet".
//
// A date is 'week weekday': week 0 is the week of the company's today, -1 the week before; 'today'
// is the demo's day. A phase is [planned start, planned end, actual start, actual end]. A task is
// [title, owner, due, priority, done, details]; the owner is a person key ('pm' is the project's
// PM, the only owner besides members) and done is the day the PM ticked it. Speed counts tasks done
// in the last 3 full weeks (weeks -1 to -3), so the numbers below give the same health on any day:
// - acme-store: 6 done in 3 weeks, 10 left, deadline Wednesday of week 3: 12 to 18 days late.
// - internal-tool: 7 done (with "Leave form validation"), 11 left, deadline Friday of week 4:
//   1 to 7 days late.
// - iwilltillimwell: 9 done (with "Contact page"), 5 left, deadline Friday of week 3: 7 to 13 days
//   early.
// projectPlanRows.js checks this with the real forecast before anything is written.
//
// New tasks are never for Vishal or for anyone on the project, so his Today and My projects cards
// keep the canvas counts. Only acme-store has files and notes (projectDocuments.js).
import { STORE_DOCUMENTS, STORE_SUMMARY } from './projectDocuments.js';

const t = (title, owner, due, priority, done = null, details = null) => ({
  title,
  owner,
  due,
  priority,
  done,
  details,
});

const phase = (plannedStart, plannedEnd, actualStart = null, actualEnd = null) => ({
  planned: [plannedStart, plannedEnd],
  actual: [actualStart, actualEnd],
});

const STORE = {
  project: 'store',
  health: 'off',
  currentPhase: 'development',
  deadline: '3 Wed',
  phases: {
    requirement_gathering: phase('-9 Mon', '-8 Fri', '-9 Mon', '-7 Wed'),
    design: phase('-7 Mon', '-5 Fri', '-7 Wed', '-4 Wed'),
    development: phase('-4 Mon', '0 Fri', '-4 Wed'),
    testing: phase('1 Mon', '2 Fri'),
    launch: phase('3 Mon', '3 Wed'),
    support: phase('3 Thu', '7 Fri'),
  },
  // Priority tasks the PM had already added, filed into a phase with a due date.
  existing: {
    'Checkout fix before client demo': ['development', '0 Fri'],
    'Payment settings page': ['development', '-1 Fri'],
    'Product image zoom': ['development', '1 Wed'],
  },
  tasks: {
    requirement_gathering: [
      t('Kickoff call with Acme Retail', 'pm', '-9 Mon', 'p2', '-9 Mon'),
      t('List the product categories', 'simran', '-9 Wed', 'p3', '-9 Wed'),
      t('Write the scope document', 'pm', '-9 Fri', 'p2', '-8 Tue'),
      t('Agree on the payment methods', 'pm', '-8 Tue', 'p2', '-8 Thu'),
      t('Collect the shipping rules', 'simran', '-8 Thu', 'p3', '-8 Fri'),
      t('Scope signed off by Acme', 'pm', '-8 Fri', 'p1', '-7 Wed'),
    ],
    design: [
      t('Wireframes for the product pages', 'simran', '-7 Wed', 'p2', '-6 Mon'),
      t('Wireframes for the checkout', 'simran', '-7 Fri', 'p2', '-6 Wed'),
      t('Pick the colours and fonts', 'simran', '-6 Tue', 'p3', '-6 Fri'),
      t('Design the cart and checkout', 'simran', '-6 Thu', 'p2', '-5 Tue'),
      t('Mobile layouts', 'simran', '-5 Tue', 'p2', '-5 Thu'),
      t('Plan the database tables', 'simran', '-5 Thu', 'p2', '-4 Mon'),
      t('Checkout designs signed off by Acme', 'pm', '-5 Fri', 'p1', '-4 Wed'),
    ],
    development: [
      t('Set up the servers', 'simran', '-4 Fri', 'p2', '-3 Tue'),
      t('Product list page', 'simran', '-3 Wed', 'p2', '-3 Thu'),
      t('Product page', 'simran', '-3 Fri', 'p2', '-2 Tue'),
      t('Search and filters', 'simran', '-2 Wed', 'p3', '-2 Fri'),
      t('Cart', 'simran', '-2 Fri', 'p2', '-1 Tue'),
      t('Order emails', 'simran', '-1 Wed', 'p3', '-1 Thu'),
      t('Get the payment gateway keys from Acme', 'pm', '-1 Wed', 'p1', null, 'Asked twice.'),
      t('Shipping options at checkout', 'simran', '1 Tue', 'p2'),
      t(
        'Stock sync with the warehouse',
        'simran',
        '1 Fri',
        'p2',
        null,
        "The warehouse system has no API yet. Acme's IT team is looking into an export file.",
      ),
    ],
    testing: [
      t('Write the test plan', 'pm', '1 Mon', 'p2'),
      t('Test on phones', 'simran', '2 Tue', 'p2'),
      t('Acme testing round', 'pm', '2 Thu', 'p1'),
    ],
    launch: [t('Go live', 'simran', '3 Wed', 'p1')],
  },
  documents: STORE_DOCUMENTS,
  summary: STORE_SUMMARY,
};

const INTERNAL = {
  project: 'internal',
  health: 'risk',
  currentPhase: 'development',
  deadline: '4 Fri',
  phases: {
    requirement_gathering: phase('-10 Mon', '-9 Fri', '-10 Mon', '-9 Fri'),
    design: phase('-8 Mon', '-7 Fri', '-9 Fri', '-7 Thu'),
    development: phase('-6 Mon', '1 Fri', '-7 Thu'),
    testing: phase('2 Mon', '3 Fri'),
    launch: phase('4 Thu', '4 Fri'),
    support: phase('5 Mon', '8 Fri'),
  },
  existing: {
    'API for leave form': ['development', '0 Fri'],
    'Leave form validation': ['development', '-1 Mon'],
    'Session timeout fix': ['development', '1 Tue'],
    'Permissions check': ['testing', '2 Wed'],
  },
  tasks: {
    requirement_gathering: [
      t('Collect what HR needs from the leave form', 'pm', '-10 Wed', 'p2', '-10 Wed'),
      t('List the reports the team uses', 'rohit', '-10 Fri', 'p3', '-10 Fri'),
      t('Agree on the roles and permissions', 'pm', '-9 Wed', 'p2', '-9 Wed'),
    ],
    design: [
      t('Screens for the leave form', 'simran', '-8 Wed', 'p2', '-8 Wed'),
      t('Team page layout', 'simran', '-7 Tue', 'p3', '-7 Tue'),
      t('Plan the database tables', 'rohit', '-7 Thu', 'p2', '-7 Thu'),
    ],
    development: [
      t('Leave balance API', 'rohit', '-3 Tue', 'p2', '-3 Tue'),
      t('Team page filters', 'simran', '-3 Thu', 'p3', '-3 Thu'),
      t('Audit log view', 'rohit', '-2 Mon', 'p2', '-2 Mon'),
      t('Holiday calendar', 'simran', '-2 Wed', 'p3', '-2 Thu'),
      t('Notification settings', 'rohit', '-1 Tue', 'p3', '-1 Tue'),
      t('Search API', 'rohit', '-1 Wed', 'p2', '-1 Thu'),
      t('Timesheet API', 'rohit', '0 Thu', 'p2'),
      t('Report export', 'rohit', '1 Wed', 'p2', null, 'Excel, like the other downloads.'),
      t('Dashboard widgets', 'simran', '1 Thu', 'p3'),
      t('Error pages', 'simran', '1 Fri', 'p3'),
    ],
    testing: [
      t('Unit tests for reports', 'rohit', '2 Tue', 'p2'),
      t('HR tries the leave form', 'pm', '3 Mon', 'p2'),
      t('Bug fixes from QA', 'simran', '3 Thu', 'p2'),
    ],
    launch: [t('Release to the whole company', 'pm', '4 Fri', 'p1')],
  },
};

const IWILL = {
  project: 'iwill',
  health: 'on',
  currentPhase: 'development',
  deadline: '3 Fri',
  phases: {
    requirement_gathering: phase('-8 Mon', '-8 Fri', '-8 Mon', '-8 Fri'),
    design: phase('-7 Mon', '-5 Fri', '-8 Fri', '-5 Wed'),
    development: phase('-4 Mon', '1 Fri', '-5 Wed'),
    testing: phase('2 Mon', '2 Fri'),
    launch: phase('3 Thu', '3 Fri'),
    support: phase('4 Mon', '7 Fri'),
  },
  existing: {
    'Homepage content changes': ['development', 'today'],
    'Contact page': ['development', '-2 Wed'],
    'SEO meta tags': ['development', '1 Tue'],
  },
  tasks: {
    requirement_gathering: [
      t('Kickoff call with the client', 'pm', '-8 Mon', 'p2', '-8 Mon'),
      t('Sitemap for the new site', 'pm', '-8 Thu', 'p2', '-8 Thu'),
    ],
    design: [
      t('Homepage design', 'simran', '-6 Tue', 'p2', '-6 Tue'),
      t('Inner page designs', 'simran', '-5 Tue', 'p2', '-5 Tue'),
      t('Designs signed off by the client', 'pm', '-5 Wed', 'p1', '-5 Wed'),
    ],
    development: [
      t('Header redesign', 'simran', '-3 Mon', 'p2', '-3 Mon'),
      t('Pricing page', 'simran', '-3 Wed', 'p2', '-3 Wed'),
      t('FAQ section', 'simran', '-3 Fri', 'p3', '-3 Fri'),
      t('Gallery page', 'simran', '-2 Tue', 'p3', '-2 Tue'),
      t('Newsletter signup form', 'simran', '-2 Thu', 'p3', '-2 Thu'),
      t('Cookie banner', 'simran', '-1 Mon', 'p3', '-1 Mon'),
      t('Page speed fixes', 'simran', '-1 Wed', 'p2', '-1 Wed'),
      t('Homepage content review', 'pm', '-1 Fri', 'p2', '-1 Fri'),
    ],
    testing: [
      t('Test on phones and tablets', 'simran', '2 Tue', 'p2'),
      t('Client review of the site', 'pm', '2 Thu', 'p2'),
    ],
    launch: [t('Go live', 'simran', '3 Fri', 'p1')],
  },
};

export const PROJECT_PLANS = [STORE, INTERNAL, IWILL];
