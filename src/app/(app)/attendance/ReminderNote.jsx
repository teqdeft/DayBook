// The muted "Reminded 10:05 by Neha" line (CONTRACT 25, item 5): the person's latest reminder of
// the row's kind, by the sender's first name ("by Daybook" for the automatic one), "Reminded Tue,
// 17 Nov by Neha" for an earlier day. Within the 30 minutes it gets the title "You can remind
// again at 10:35". 12 px, at most 2 lines. `bare` drops "Reminded " (the Missing check-outs list's
// Reminded column, which sets its own size). No hooks: it renders in Server and Client Components.
import { formatDayShort, formatTime, workDate } from '@/lib/time';
import styles from './ReminderNote.module.css';

/** "Neha" from "Neha Kapoor"; Daybook when nobody sent it. */
function senderOf(sentBy) {
  const name = sentBy?.name?.trim();
  return name ? name.split(/\s+/)[0] : 'Daybook';
}

/**
 * The line's words: "Reminded 10:05 by Neha" (today, company time) or "Reminded Tue, 17 Nov by
 * Neha", and the title while HR can't remind again yet.
 * @param {{ reminded: { sentAt: Date | string, sentBy: { name: string } | null },
 *   nextAt?: Date | string | null, tz: string, bare?: boolean }} input
 * @returns {{ text: string, title: string | null }}
 */
export function reminderNoteText({ reminded, nextAt, tz, bare = false }) {
  const day = workDate(tz, reminded.sentAt);
  const when = day === workDate(tz) ? formatTime(reminded.sentAt, tz) : formatDayShort(day);
  const text = `${bare ? '' : 'Reminded '}${when} by ${senderOf(reminded.sentBy)}`;
  return { text, title: nextAt ? `You can remind again at ${formatTime(nextAt, tz)}` : null };
}

/**
 * @param {{ reminded: { sentAt: Date | string, sentBy: { id: number, name: string } | null,
 *   tz?: string } | null, nextAt?: Date | string | null, tz?: string, bare?: boolean }} props
 *   tz = the company time zone (Client Components can't read settings); loaders that can't pass
 *   it put it on `reminded.tz` (remindData.js). nextAt is set while the 30 minutes since the last
 *   reminder haven't passed
 */
export default function ReminderNote({ reminded, nextAt = null, tz, bare = false }) {
  const zone = tz ?? reminded?.tz;
  if (!reminded?.sentAt || !zone) return null;
  const { text, title } = reminderNoteText({ reminded, nextAt, tz: zone, bare });
  return (
    <span className={`${styles.note} ${bare ? styles.bare : ''}`} title={title ?? undefined}>
      {text}
    </span>
  );
}
