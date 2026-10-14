// The Attendance page's "Work from home requests" card (CONTRACT 17): which requests show where,
// the viewer's own request, expired ones (nobody decided before their days were over), and the
// wording of "Sent ..." and the handled lines.
import { describe, expect, it } from 'vitest';
import {
  handledLine,
  handledSinceFor,
  isExpired,
  ownRequestNote,
  sentLabel,
  wfhCard,
} from '@/app/(app)/attendance/wfhCard';

const TZ = 'Asia/Kolkata';
const TODAY = '2026-10-13'; // a Tuesday
const neha = { id: 2, name: 'Neha Gupta', role: 'hr' };
const ceo = { id: 3, name: 'Ravi Kapoor', role: 'admin' };

/** A request as attendance.listWfhRequests returns it. */
function request(overrides = {}) {
  return {
    id: 1,
    user: {
      id: 10,
      name: 'Vishal Saini',
      initials: 'VS',
      designation: 'Frontend developer',
      role: 'employee',
      status: 'active',
    },
    fromDate: '2026-10-14',
    toDate: '2026-10-14',
    days: 'Wed, 14 Oct',
    reason: 'Plumber visit in the morning',
    status: 'pending',
    handledBy: null,
    handledAt: null,
    declineReason: null,
    createdAt: new Date('2026-10-13T04:42:00Z'), // 10:12 in India
    ...overrides,
  };
}

describe('handledSinceFor', () => {
  it('keeps the decisions of the last 7 days', () => {
    expect(handledSinceFor(TODAY)).toBe('2026-10-06');
    expect(handledSinceFor('2026-10-01')).toBe('2026-09-24');
  });
});

describe('sentLabel', () => {
  it('says today, yesterday or the day, with morning times without "AM"', () => {
    expect(sentLabel(new Date('2026-10-13T04:42:00Z'), TZ, TODAY)).toBe('Sent today at 10:12');
    expect(sentLabel(new Date('2026-10-12T11:50:00Z'), TZ, TODAY)).toBe(
      'Sent yesterday at 5:20 PM',
    );
    expect(sentLabel(new Date('2026-10-09T03:45:00Z'), TZ, TODAY)).toBe('Sent Fri, 9 Oct at 9:15');
  });

  it('uses the company day, not the UTC one', () => {
    // 11 Oct 20:00 UTC is already 12 Oct (1:30 AM) in India.
    expect(sentLabel(new Date('2026-10-11T20:00:00Z'), TZ, TODAY)).toBe('Sent yesterday at 1:30');
  });
});

describe('ownRequestNote', () => {
  it("says who decides on the viewer's own request", () => {
    expect(ownRequestNote(neha)).toBe('Your own request. Another HR person or an Admin decides.');
    expect(ownRequestNote(ceo)).toBe('Your own request. Another Admin decides.');
  });
});

describe('handledLine', () => {
  const ctx = { viewerId: neha.id, tz: TZ, today: TODAY };

  it('names who approved and when', () => {
    const approved = request({
      status: 'approved',
      handledBy: { id: 4, name: 'Sunita Rao' },
      handledAt: new Date('2026-10-13T05:00:00Z'),
    });
    expect(handledLine(approved, ctx)).toBe('Approved by Sunita Rao today');
    expect(handledLine({ ...approved, handledBy: { id: neha.id, name: 'Neha Gupta' } }, ctx)).toBe(
      'Approved by you today',
    );
  });

  it("adds a decline's reason", () => {
    const declined = request({
      status: 'declined',
      handledBy: { id: neha.id, name: 'Neha Gupta' },
      handledAt: new Date('2026-10-12T06:00:00Z'),
      declineReason: 'Client visit that day',
    });
    expect(handledLine(declined, ctx)).toBe('Declined by you yesterday: Client visit that day');
    expect(handledLine({ ...declined, declineReason: null }, ctx)).toBe(
      'Declined by you yesterday',
    );
  });

  it('says the person cancelled it, or "You" for your own', () => {
    const cancelled = request({
      status: 'cancelled',
      handledBy: { id: 10, name: 'Vishal Saini' },
      handledAt: new Date('2026-10-08T06:00:00Z'),
    });
    expect(handledLine(cancelled, ctx)).toBe('They cancelled it on Thu, 8 Oct');
    expect(handledLine(cancelled, { ...ctx, viewerId: 10 })).toBe('You cancelled it on Thu, 8 Oct');
  });

  it('leaves out who and when when they are unknown', () => {
    expect(handledLine(request({ status: 'approved' }), ctx)).toBe('Approved');
  });

  it('says an expired request was not decided in time', () => {
    expect(handledLine(request({ status: 'expired' }), ctx)).toBe('Not decided in time');
  });
});

describe('wfhCard', () => {
  const ctx = { viewer: neha, tz: TZ, today: TODAY };

  it('is null when there is nothing to show, so the page leaves the card out', () => {
    expect(wfhCard(null, 0, ctx)).toBeNull();
    expect(wfhCard({ items: [], total: 0 }, 0, ctx)).toBeNull();
  });

  it('splits pending requests from handled ones and keeps their order', () => {
    const items = [
      request({ id: 5, fromDate: TODAY, toDate: '2026-10-15', days: 'Tue, 13 – Thu, 15 Oct' }),
      request({ id: 6, user: { ...request().user, id: neha.id, name: 'Neha Gupta' } }),
      request({
        id: 7,
        status: 'approved',
        handledBy: { id: neha.id, name: 'Neha Gupta' },
        handledAt: new Date('2026-10-13T05:00:00Z'),
      }),
      request({ id: 8, status: 'cancelled', handledAt: new Date('2026-10-12T05:00:00Z') }),
    ];
    const card = wfhCard({ items, total: 6 }, 1, ctx);
    expect(card.waiting).toBe(1);
    expect(card.more).toBe(2);
    expect(card.pending.map((item) => item.id)).toEqual([5, 6]);
    expect(card.handled.map((item) => item.id)).toEqual([7, 8]);

    expect(card.pending[0]).toEqual({
      id: 5,
      user: { id: 10, name: 'Vishal Saini', initials: 'VS', role: 'employee', status: 'active' },
      days: 'Tue, 13 – Thu, 15 Oct',
      reason: 'Plumber visit in the morning',
      sent: 'Sent today at 10:12',
      today: true,
      own: false,
      ownNote: null,
    });
    // The viewer's own request has no buttons (the API answers FORBIDDEN), just who decides.
    expect(card.pending[1]).toMatchObject({
      today: false,
      own: true,
      ownNote: 'Your own request. Another HR person or an Admin decides.',
    });
    expect(card.handled[0]).toMatchObject({
      status: 'approved',
      days: 'Wed, 14 Oct',
      line: 'Approved by you today',
    });
    expect(card.handled[1]).toMatchObject({
      status: 'cancelled',
      line: 'They cancelled it yesterday',
    });
  });

  it('moves pending requests whose days are over to the handled ones, as expired', () => {
    const over = (id, fromDate, toDate) => request({ id, fromDate, toDate });
    expect(isExpired(over(1, '2026-10-12', '2026-10-12'), TODAY)).toBe(true);
    expect(isExpired(over(1, '2026-10-12', TODAY), TODAY)).toBe(false);
    expect(isExpired(request({ status: 'approved', toDate: '2026-10-01' }), TODAY)).toBe(false);

    const items = [
      over(11, '2026-10-06', '2026-10-07'),
      over(12, '2026-10-12', '2026-10-12'),
      over(13, '2026-10-12', TODAY),
      request({ id: 14, status: 'declined', handledAt: new Date('2026-10-12T05:00:00Z') }),
    ];
    const card = wfhCard({ items, total: 4 }, 1, ctx);
    expect(card.pending.map((item) => item.id)).toEqual([13]);
    expect(card.handled.map((item) => [item.id, item.status, item.line])).toEqual([
      [12, 'expired', 'Not decided in time'],
      [11, 'expired', 'Not decided in time'],
      [14, 'declined', 'Declined yesterday'],
    ]);
  });

  it('shows the card with only handled requests', () => {
    const items = [request({ status: 'declined', declineReason: 'Busy week' })];
    const card = wfhCard({ items, total: 1 }, 0, ctx);
    expect(card).toMatchObject({ waiting: 0, pending: [], more: 0 });
    expect(card.handled[0].line).toBe('Declined: Busy week');
  });
});
