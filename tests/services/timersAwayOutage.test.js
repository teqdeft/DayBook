// A Daybook outage is never asked about (CONTRACT 25 A, No-data gap): while Daybook is down nobody
// reports, but each person's last heartbeat before it and first after it are staggered by up to
// a beat, so a colleague's segment edges fall just inside the person's gap. Real 60 s heartbeats
// through activity.recordHeartbeat; only screen time recorded more than 150 s inside the gap
// counts, so a laptop asleep while a colleague works on is still asked about.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setNowForTests } from '@/lib/time';
import { activity } from '@/modules/activity';
import { timers } from '@/modules/timers';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, checkIn, createProject } from './dashboardKit.js';
import { insertEntry, setClock, TODAY } from './timersKit.js';

let acme;
let count = 0;

const SETTINGS = {
  timers_mode: 'optional',
  timer_away_minutes: 25,
  activity_tracking_enabled: true,
  activity_idle_minutes: 5,
};

/** A checked-in timer user (09:30) with acme running from 09:35. */
async function person(name) {
  count += 1;
  const user = await createUser({ name: `${name} ${count}` });
  await addMembers(acme, [user]);
  await checkIn(user, TODAY, { in: '09:30' });
  await insertEntry(user, acme, { from: '09:35' });
  return user;
}

const clockSeconds = (clock) => {
  const [hours, minutes, seconds = 0] = clock.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
};
const clockOf = (total) =>
  [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');

/** Active Idle Detection heartbeats every 60 s from one local clock to another ('13:09:30'). */
async function beats(user, from, to) {
  for (let total = clockSeconds(from); total <= clockSeconds(to); total += 60) {
    setClock(clockOf(total));
    await activity.recordHeartbeat({ user, state: 'active', source: 'system' });
  }
}

beforeAll(async () => {
  await resetDatabase();
  await setSettings(SETTINGS);
  const pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  acme = await createProject(pm, { name: 'acme-app' });
});

beforeEach(() => timers.forgetAway());

afterEach(() => setNowForTests(null));

describe('a Daybook outage', () => {
  it('is not asked about, though Asha beats on :00 and Vishal on :30', async () => {
    // Nobody reports from 13:10:15 to 13:49:50. Vishal's gap is 13:09:30 to 13:50:30, and Asha's
    // segments end at 13:10 and start again at 13:50, just inside it.
    const [asha, vishal] = [await person('Asha'), await person('Vishal')];
    await beats(asha, '13:00:00', '13:10:00');
    await beats(vishal, '13:00:30', '13:09:30');
    await beats(asha, '13:50:00', '14:00:00');
    await beats(vishal, '13:50:30', '14:00:30');
    setClock('14:01');
    expect((await timers.getState({ user: vishal })).away).toBeNull();
    expect((await timers.getState({ user: asha })).away).toBeNull();
    // A laptop asleep instead: Simran reported all through Vishal's gap, so he is asked.
    const simran = await person('Simran');
    await beats(simran, '13:00:15', '14:00:15');
    setClock('14:01');
    expect((await timers.getState({ user: vishal })).away).toMatchObject({
      fromClock: '13:09',
      toClock: '13:50',
      kind: 'no_data',
    });
  });

  it('after the day end does not offer "I had left" at its start', async () => {
    const [asha, vishal] = [await person('Asha'), await person('Vishal')];
    await beats(asha, '18:32:00', '18:42:00');
    await beats(vishal, '18:31:30', '18:41:30');
    await beats(asha, '19:30:00', '19:40:00');
    await beats(vishal, '19:30:30', '19:40:30');
    setClock('19:41');
    expect((await timers.getState({ user: vishal })).away).toBeNull();
  });
});
