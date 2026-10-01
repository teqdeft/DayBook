// Requests (08) and attendance corrections (09). Times are { offset, clock }: a working-day offset
// from the anchor day (0 = "today") and a local clock time.

/** Report edit requests. Pending ones are waiting for [PM name]; the rest are "Recently handled". */
export const EDIT_REQUESTS = [
  {
    key: 'ankit',
    offset: 3,
    reason: 'Forgot to add 1 hour on acme-seo keyword research.',
    sent: { offset: 0, clock: '10:12' },
    status: 'pending',
  },
  {
    key: 'vishal',
    offset: 3,
    reason: 'Hours for acme-store were 3, not 2.',
    sent: { offset: 0, clock: '09:48' },
    status: 'pending',
  },
  {
    key: 'simran',
    offset: 6,
    reason: 'Forgot to add the order emails task on acme-store.',
    sent: { offset: 5, clock: '14:10' },
    status: 'approved',
    handled: { offset: 5, clock: '16:30', by: 'pm' },
    resubmitted: { offset: 5, clock: '17:05' },
  },
  {
    key: 'deepak',
    offset: 8,
    reason: 'Add 2 hours of keyword research on acme-seo.',
    sent: { offset: 7, clock: '09:40' },
    status: 'declined',
    handled: { offset: 7, clock: '11:20', by: 'pm' },
    declineReason: "Those hours are already in the next day's report.",
  },
  {
    key: 'priya',
    offset: 10,
    reason: 'Forgot to add 2 hours on acme-seo.',
    sent: { offset: 9, clock: '13:30' },
    status: 'approved',
    handled: { offset: 9, clock: '15:05', by: 'pm' },
    resubmitted: { offset: 9, clock: '15:50' },
  },
];

/** Project requests: acme-blog is pending; acme-app was approved and created. */
export const PROJECT_REQUESTS = [
  {
    key: 'priya',
    name: 'acme-blog',
    note: 'Client wants monthly blog posts, starting this week.',
    sent: { offset: 1, clock: '17:20' },
    status: 'pending',
  },
  {
    key: 'rohit',
    name: 'acme-app',
    note: 'Acme Health signed the app project. Kickoff is this week.',
    sent: { offset: 7, clock: '11:00' },
    status: 'approved',
    handled: { offset: 6, clock: '16:15', by: 'pm' },
    project: 'app',
  },
];

/**
 * Attendance corrections. The card title on 09 is the reason; the second line is built from the
 * requested time ("Says he left at 6:40 PM on Tue, 29 Sep.").
 */
export const CORRECTIONS = [
  {
    key: 'deepak',
    offset: 1,
    type: 'check_out',
    requested: { offset: 1, clock: '18:40' },
    reason: 'Forgot to check out yesterday',
    sent: { offset: 0, clock: '09:15' },
    status: 'pending',
  },
  {
    key: 'rohit',
    offset: 0,
    type: 'check_in',
    requested: { offset: 0, clock: '09:35' },
    reason: 'Wrong check-in time',
    sent: { offset: 0, clock: '10:15' },
    status: 'pending',
  },
  {
    key: 'karan',
    offset: 12,
    type: 'check_out',
    requested: { offset: 12, clock: '18:35' },
    reason: 'Forgot to check out',
    sent: { offset: 11, clock: '09:20' },
    status: 'approved',
    handled: { offset: 11, clock: '10:05', by: 'neha' },
  },
];
