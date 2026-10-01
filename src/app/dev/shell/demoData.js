// Demo data copied from the design artboards, for the dev-only shell gallery.

export const TZ = 'Asia/Kolkata';

// Wednesday 30 September 2026, 3:10 PM in India (09:40 UTC).
export const NOW = '2026-09-30T09:40:00Z';
export const CHECK_IN = '2026-09-30T04:02:00Z'; // 9:32

export const WEEK = [
  { label: 'Mon', value: 8.5, display: '8.5h' },
  { label: 'Tue', value: 8, display: '8h' },
  { label: 'Wed', value: 5.6, display: '5.6h', highlight: true, faded: true },
  { label: 'Thu', value: 0, display: null },
  { label: 'Fri', value: 0, display: null },
];

export const MY_TASKS = [
  {
    id: 1,
    title: 'Content changes',
    project: { name: 'iwilltillimwell', color: 'orange' },
    status: 'in_progress',
    updated: 'Today',
  },
  {
    id: 2,
    title: 'Working on backend',
    project: { name: 'internal-tool', color: 'blue' },
    status: 'in_progress',
    updated: 'Since Monday',
  },
  {
    id: 3,
    title: 'Payment settings page',
    project: { name: 'acme-store', color: 'green' },
    status: 'blocked',
    updated: 'Tuesday',
  },
  {
    id: 4,
    title: 'Contact form fixes',
    project: { name: 'iwilltillimwell', color: 'orange' },
    status: 'done',
    updated: 'Yesterday',
  },
];

export const HOURS_BY_PROJECT = [
  { label: 'internal-tool', value: 88, display: '88h', color: 'blue' },
  { label: 'acme-store', value: 72, display: '72h', color: 'green' },
  { label: 'acme-seo', value: 64, display: '64h', color: 'violet' },
  { label: 'iwilltillimwell', value: 46, display: '46h', color: 'orange' },
  { label: 'Proposals', value: 40, display: '40h', color: 'teal' },
  { label: 'Hiring', value: 18, display: '18h', color: 'pink' },
];

export const HOURS_COMPANY = [
  ...HOURS_BY_PROJECT.slice(0, 5),
  { label: 'acme-app', value: 31, display: '31h', color: 'pink' },
  { label: 'Hiring', value: 18, display: '18h', color: 'pink' },
];

export const HOURS_PERSON = [
  { label: 'internal-tool', value: 86, display: '86h', color: 'blue' },
  { label: 'iwilltillimwell', value: 38, display: '38h', color: 'orange' },
  { label: 'acme-store', value: 18, display: '18h', color: 'green' },
];

export const DEPARTMENTS = [
  { label: 'Development', value: 12, display: '12', color: 'blue' },
  { label: 'SEO', value: 5, display: '5', color: 'violet' },
  { label: 'Delivery', value: 3, display: '3', color: 'teal' },
  { label: 'HR', value: 2, display: '2', color: 'pink' },
  { label: 'Sales', value: 2, display: '2', color: 'green' },
  { label: 'Leadership', value: 2, display: '2', color: 'navy' },
];

export const ATTENDANCE_TODAY = [
  { label: 'Office', value: 20, color: 'primary' },
  { label: 'Working from home', value: 4, color: 'violet' },
  { label: 'Not checked in', value: 2, color: 'red' },
];

const stack = (office, wfh, missing) => [
  { label: 'Office', value: office, color: 'primary' },
  { label: 'WFH', value: wfh, color: 'violet' },
  { label: 'Not checked in', value: missing, color: 'red' },
];

export const ATTENDANCE_WEEK = [
  { label: 'Mon', segments: stack(22, 3, 1) },
  { label: 'Tue', segments: stack(21, 4, 1) },
  { label: 'Wed', segments: stack(20, 4, 2), highlight: true },
  { label: 'Thu', segments: [] },
  { label: 'Fri', segments: [] },
];

const P = {
  iwill: { name: 'iwilltillimwell', color: 'orange' },
  internal: { name: 'internal-tool', color: 'blue' },
  store: { name: 'acme-store', color: 'green' },
  seo: { name: 'acme-seo', color: 'violet' },
  proposals: { name: 'Proposals', color: 'teal' },
};

const at = (clock) => {
  const [h, m] = clock.split(':').map(Number);
  const utcMinutes = h * 60 + m - 330;
  const hh = String(Math.floor(utcMinutes / 60)).padStart(2, '0');
  const mm = String(utcMinutes % 60).padStart(2, '0');
  return `2026-09-30T${hh}:${mm}:00Z`;
};

export const TEAM_GROUPS = [
  {
    key: 'office',
    title: 'In office',
    tone: 'primary',
    total: 20,
    rows: [
      {
        id: 1,
        name: 'Vishal Saini',
        designation: 'Frontend developer',
        in: at('9:32'),
        logged: '8h',
        report: 'submitted',
        projects: [P.iwill, P.internal],
      },
      {
        id: 2,
        name: 'Rohit Verma',
        designation: 'Full stack developer',
        in: at('10:08'),
        late: 38,
        logged: '0h',
        report: 'missing',
        projects: [],
      },
      {
        id: 3,
        name: 'Aman Singh',
        designation: 'Bidder',
        in: at('9:30'),
        out: at('18:15'),
        logged: '8h',
        report: 'submitted',
        projects: [P.proposals],
      },
    ],
  },
  {
    key: 'wfh',
    title: 'Working from home',
    tone: 'violet',
    total: 4,
    rows: [
      {
        id: 4,
        name: 'Priya Sharma',
        designation: 'SEO executive',
        in: at('9:41'),
        late: 11,
        logged: '7h 30m',
        report: 'submitted',
        projects: [P.seo],
      },
      {
        id: 5,
        name: 'Simran Kaur',
        designation: 'Full stack developer',
        in: at('9:35'),
        logged: '8h 30m',
        report: 'submitted',
        projects: [P.store],
      },
    ],
  },
  {
    key: 'missing',
    title: 'Not checked in',
    tone: 'red',
    total: 2,
    rows: [
      {
        id: 6,
        name: 'Karan Mehta',
        designation: 'Frontend developer',
        report: 'not_checked_in',
        projects: [],
      },
      {
        id: 7,
        name: 'Deepak Joshi',
        designation: 'SEO executive',
        report: 'not_checked_in',
        projects: [],
      },
    ],
  },
];

export const REPORT_HISTORY = [
  {
    id: 1,
    date: 'Wed, 30 Sep',
    where: 'office',
    in: '9:32',
    out: '6:34',
    present: '9h 2m',
    logged: '8h',
    projects: [P.iwill, P.internal],
    report: 'submitted',
  },
  {
    id: 2,
    date: 'Tue, 29 Sep',
    where: 'office',
    in: '9:28',
    out: '6:31',
    present: '9h 3m',
    logged: '8.5h',
    projects: [P.internal, P.iwill],
    report: 'submitted',
  },
  {
    id: 3,
    date: 'Mon, 28 Sep',
    where: 'office',
    in: '9:30',
    out: '6:40',
    present: '9h 10m',
    logged: '8.5h',
    projects: [P.internal],
    report: 'submitted',
  },
  {
    id: 4,
    date: 'Fri, 25 Sep',
    where: 'office',
    in: '9:31',
    out: '6:30',
    present: '8h 59m',
    logged: '8h',
    projects: [P.internal, P.store],
    report: 'edited',
  },
  {
    id: 5,
    date: 'Thu, 24 Sep',
    where: 'wfh',
    in: '9:40',
    out: '6:35',
    present: '8h 55m',
    logged: '8h',
    projects: [P.store],
    report: 'submitted',
  },
];

const d = (day, tone, extra = {}) => ({
  date: `2026-09-${String(day).padStart(2, '0')}`,
  day,
  tone,
  ...extra,
});
const future = (day) => ({ date: `2026-10-${String(day).padStart(2, '0')}`, day, tone: 'future' });

export const SEPTEMBER = [
  [{ tone: 'empty' }, d(1, 'office'), d(2, 'office'), d(3, 'wfh'), d(4, 'office')],
  [d(7, 'office'), d(8, 'late'), d(9, 'office'), d(10, 'missing'), d(11, 'office')],
  [d(14, 'office'), d(15, 'wfh'), d(16, 'office'), d(17, 'late'), d(18, 'office')],
  [d(21, 'office'), d(22, 'office'), d(23, 'office'), d(24, 'wfh'), d(25, 'office')],
  [d(28, 'office'), d(29, 'office'), d(30, 'office', { isToday: true }), future(1), future(2)],
];
