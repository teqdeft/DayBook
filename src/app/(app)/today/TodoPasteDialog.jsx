'use client';
// "Paste your to-do" (CONTRACT 24): the person's usual Slack list in a textarea, read as it is
// typed. Each project heading shows how it was matched: an exact match as its label with "Change",
// a close one as a Select already set ("Matched from “Riverkraft website”"), none in red with
// "Pick a project" (every pickable project, plus "Skip these tasks"); tasks before any heading
// need a project too (pasted into a project's "Add a task", they go to that project, with
// "Change"). Lines already in the to-do say so and aren't added; a line equal to an unfinished
// task from a past report is carried from it ("From Wednesday"); "(Done)" shows Done. "Add 5
// tasks" stays off while a group has no project and isn't skipped, or nothing is new.
import { useId, useMemo, useState } from 'react';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import ProjectLabel from '@/components/ProjectLabel';
import Select from '@/components/Select';
import Tag from '@/components/Tag';
import Textarea from '@/components/Textarea';
import { TODO_LIMITS } from '@/modules/reports/todoText';
import { pickables as pickablesOf } from './todoModel';
import { SKIP, pasteModel, pastedText } from './todoPaste';
import styles from './TodoPasteDialog.module.css';

export const PASTE_HELP =
  'Start each project with “Project:” and each task with * or •. Your usual Slack list works as it is.';
const PLACEHOLDER = 'Project: Pine Tree Lane\n* Monitoring the Google Ads campaign';

/** One heading of the paste (or the tasks before any heading) and its lines. */
function PasteGroup({ group, options, onChoose, onChange }) {
  const target = group.target;
  const label = target ? (target.project ?? { ...target.request, color: null }) : null;
  const what = group.heading ?? 'tasks without a project';
  return (
    <div className={`${styles.group} ${group.bad ? styles.groupBad : ''}`}>
      <div className={styles.groupHead}>
        {group.exactView ? <ProjectLabel project={label} /> : null}
        {group.note ? (
          <span className={group.note.tone === 'red' ? styles.noteRed : styles.note}>
            {group.note.text}
          </span>
        ) : null}
        <span className={styles.spacer} />
        {group.exactView ? (
          <Button
            variant="text"
            size="compact"
            className={styles.change}
            aria-label={`Change the project for ${what}`}
            onClick={onChange}
          >
            Change
          </Button>
        ) : (
          <Select
            className={styles.select}
            aria-label={`Project for ${what}`}
            value={group.choice}
            error={group.bad}
            onChange={(event) => onChoose(event.target.value)}
          >
            <option value="">Pick a project</option>
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.name}
              </option>
            ))}
            <option value={SKIP}>Skip these tasks</option>
          </Select>
        )}
      </div>
      <ul className={styles.lines}>
        {group.lines.map((line, position) => (
          <li
            key={position}
            className={`${styles.line} ${line.dup || line.skip ? styles.lineMuted : ''}`}
          >
            <span className={styles.bullet} aria-hidden="true">
              •
            </span>
            <span className={styles.lineText}>
              <span className={line.skip ? styles.struck : undefined}>{line.title}</span>
              {line.tag ? (
                <Tag tone={line.tag.tone} className={styles.tag}>
                  {line.tag.text}
                </Tag>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * @param {{ initialText?: string, initialKey?: string | null, picker: object, groups: object[],
 *   suggestions?: Record<string, object[]>, onAdd: (plan: object[],
 *   addedText: (count: number) => string) => Promise<object | null>, onClose: () => void }} props
 *   initialText: text pasted into "Add a task"; initialKey: that group's project key (the tasks
 *   before any heading go to it); groups: the to-do's groups; suggestions: the open suggestions by
 *   project key; onAdd: the bulk add (null when it failed: the dialog stays)
 */
export default function TodoPasteDialog({
  initialText = '',
  initialKey = null,
  picker,
  groups,
  suggestions,
  onAdd,
  onClose,
}) {
  const id = useId();
  const [text, setText] = useState(() => initialText.slice(0, TODO_LIMITS.textMax));
  const [choices, setChoices] = useState({});
  const [changing, setChanging] = useState({});
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => pickablesOf(picker), [picker]);
  const model = pasteModel({
    text,
    choices,
    changing,
    pickables: options,
    groups,
    suggestions,
    fieldKey: initialKey,
  });

  async function add() {
    if (model.disabled || busy) return;
    setBusy(true);
    const result = await onAdd(model.plan, pastedText);
    setBusy(false);
    if (result) onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Paste your to-do"
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={add} disabled={model.disabled} loading={busy}>
            {model.button}
          </Button>
        </>
      }
    >
      <label htmlFor={`${id}-text`} className={styles.label}>
        Your list
      </label>
      <Textarea
        id={`${id}-text`}
        rows={8}
        maxLength={TODO_LIMITS.textMax}
        aria-describedby={`${id}-help`}
        placeholder={PLACEHOLDER}
        className={styles.textarea}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setChoices({});
          setChanging({});
        }}
      />
      <p id={`${id}-help`} className={styles.help}>
        {PASTE_HELP}
      </p>
      {model.hasText ? (
        <div className={styles.preview}>
          <p className={styles.summary} role="status">
            {model.summary}
          </p>
          {model.groups.map((group) => (
            <PasteGroup
              key={group.index}
              group={group}
              options={options}
              onChoose={(value) => setChoices((current) => ({ ...current, [group.index]: value }))}
              onChange={() => setChanging((current) => ({ ...current, [group.index]: true }))}
            />
          ))}
          {model.notes.map((note) => (
            <p key={note} className={styles.notes}>
              {note}
            </p>
          ))}
        </div>
      ) : null}
    </Dialog>
  );
}
