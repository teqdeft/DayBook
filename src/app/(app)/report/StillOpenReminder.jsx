'use client';
// The report's side of CONTRACT 24 outside the cards: the notice above them while the draft was
// planned (a line, and a project at 0 minutes), and under them the reminder line "Still open from
// past reports:" with each project not in the report and its count, which opens the Still open
// dialog. "Add to today" there adds the project's card (or uses the card already there) and the
// line; Done already and Not needed never add a project.
import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { useToast } from '@/components/ToastProvider';
import { addedText } from './CardCarry';
import StillOpenDialog from './StillOpenDialog';
import { useReport } from './ReportProvider';
import {
  carriedTask,
  pickOf,
  pickerIndex,
  reminderItems,
  suggestionGroups,
  withCarriedTasks,
} from './reportCarry';
import { showsHoursNotice } from './reportPlanned';
import { newEntry, projectKey } from './reportState';
import { timerHoursFor } from './reportTimers';
import styles from './StillOpenReminder.module.css';

/** "Add the hours for each project and check each status." above the cards. */
export function HoursNotice() {
  const { entries, report, readOnly } = useReport();
  if (readOnly || !showsHoursNotice(entries, report.status)) return null;
  return (
    <Card padding="compact" role="note" className={styles.notice}>
      <Info size={18} strokeWidth={1.8} aria-hidden="true" className={styles.noticeIcon} />
      <p className={styles.noticeText}>
        Add the hours for each project and check each status. Tasks you ticked on Today are Done.
      </p>
    </Card>
  );
}

/**
 * The rows with a carried line for a group: on its card when the report has one, else on a new
 * card for the project (with its timer hours in required timer mode).
 */
function withLine(entries, group, line, timers) {
  if (entries.some((entry) => projectKey(entry) === group.key)) {
    return entries.map((entry) =>
      projectKey(entry) === group.key
        ? { ...entry, tasks: withCarriedTasks(entry.tasks, [line]) }
        : entry,
    );
  }
  const pick = pickOf(group);
  return [...entries, { ...newEntry(pick), tasks: [line], ...timerHoursFor(timers, pick) }];
}

export default function StillOpenReminder() {
  const { data, entries, carry, readOnly, submitting, change, timers } = useReport();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const index = useMemo(() => pickerIndex(data.picker), [data.picker]);
  const groups = useMemo(
    () => suggestionGroups(carry.suggestions, index),
    [carry.suggestions, index],
  );
  const reminder = readOnly ? [] : reminderItems(groups, entries);

  function add(groupKey, item) {
    const group = groups.find((candidate) => candidate.key === groupKey);
    if (!group) return;
    const line = carriedTask(item);
    change((list) => withLine(list, group, line, timers));
    toast({ title: addedText(1) });
  }

  return (
    <>
      {reminder.length ? (
        <p className={styles.reminder}>
          Still open from past reports:
          {reminder.map((item) => (
            <Button
              key={item.key}
              variant="text"
              size="small"
              className={styles.reminderButton}
              aria-haspopup="dialog"
              disabled={submitting}
              onClick={() => setOpen(true)}
            >
              {item.label}
            </Button>
          ))}
        </p>
      ) : null}
      <StillOpenDialog
        open={open && !readOnly}
        onClose={() => setOpen(false)}
        groups={groups}
        onAdd={add}
        onClosed={carry.onClosed}
        onRestored={carry.onRestored}
      />
    </>
  );
}
