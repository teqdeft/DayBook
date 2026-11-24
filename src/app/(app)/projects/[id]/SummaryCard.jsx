'use client';
// The AI summary on the Summary tab (CONTRACT 22 and 27): only the project's PM or Admin ever gets
// this card, on the server. Writing and updating run the summary through the API; errors toast the
// API's message and change nothing (useSummaryRequests.js). The AI phase line under the action items
// never moves a phase, and "Add to tasks" is the PM's own click. Its buttons keep keyboard focus
// while they work (BusyButton).
import { useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Tag from '@/components/Tag';
import BusyButton from './BusyButton';
import { tabHref } from './ProjectTabs';
import {
  documentCounts,
  firstRisk,
  summaryActions,
  summaryGroups,
  summaryState,
} from './summaryView';
import { addedId, useAddAction, useWriteSummary } from './useSummaryRequests';
import styles from './SummaryCard.module.css';

const READING = 'Reading the files…';
const EMPTY_TEXT =
  'Upload a PDF, Word or text file, or write a note, in Files, and AI writes a summary here.';
const OFF_TEXT = 'AI summary is off. An Admin can turn it on in Settings → AI.';
const TRUNCATED = 'Only the first 50,000 characters were read.';

/** A completed project takes no new tasks, so its items have no button. */
function ActionItems({ actions, projectId, currentPhase, canAdd }) {
  const { adding, added, add } = useAddAction(projectId, currentPhase);
  if (actions.length === 0) return null;
  return (
    <div className={styles.actions}>
      <div className={styles.actionsHead}>
        <h3 className={styles.actionsTitle}>Action items</h3>
        <Badge size={22} className={styles.actionsCount}>
          {actions.length}
        </Badge>
      </div>
      <ul aria-label="Action items" className={styles.actionList}>
        {actions.map((action) => (
          <li key={action.key} className={styles.actionRow}>
            <span className={styles.actionText}>
              <span className={styles.actionWho}>{action.who}:</span> {action.text}{' '}
              <span className={styles.actionWhen}>· {action.when}</span>
            </span>
            {action.added || added.includes(action.key) ? (
              <span id={addedId(action.key)} tabIndex={-1} className={styles.actionAdded}>
                Added
              </span>
            ) : null}
            {canAdd && !action.added && !added.includes(action.key) ? (
              <BusyButton
                variant="secondary"
                size="small"
                className={styles.smallButton}
                aria-label={`Add to tasks: ${action.text}`}
                busy={adding === action.key}
                onClick={(event) => add(action, event.currentTarget)}
              >
                Add to tasks
              </BusyButton>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "AI suggests moving on: “…” · Weekly call notes". It moves nothing. */
function AiLine({ suggestion }) {
  return (
    <p className={styles.aiLine}>
      <Sparkles className={styles.aiLineIcon} size={16} strokeWidth={1.8} aria-hidden="true" />
      <span className={styles.aiLineText}>
        AI suggests moving on: &#8220;{suggestion.quote}&#8221;
        {suggestion.source ? (
          <>
            {' · '}
            <span className={styles.aiLineSource}>{suggestion.source}</span>
          </>
        ) : null}
      </span>
    </p>
  );
}

function FullSummary({ groups }) {
  const [open, setOpen] = useState(false);
  if (groups.length === 0) return null;
  return (
    <>
      <div className={styles.toggle}>
        <Button
          variant="text"
          size="compact"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Show less' : 'Read full summary'}
        </Button>
      </div>
      {open
        ? groups.map((group) => (
            <div key={group.title} className={styles.group}>
              <h3 className={styles.groupTitle}>{group.title}</h3>
              <ul className={styles.points}>
                {group.points.map((point, index) => (
                  <li key={index} className={styles.point}>
                    {point.text}{' '}
                    {point.notInScope ? (
                      <>
                        <Tag tone="neutral" padX={8} className={styles.notInScope}>
                          Not in scope
                        </Tag>{' '}
                      </>
                    ) : null}
                    <span className={styles.source}>{point.source}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        : null}
    </>
  );
}

/** Where the summary came from, what to check, and Update summary when it is out of date. */
function SummaryFooter({ state, summary, writer }) {
  const read = summary.truncated ? ` ${TRUNCATED}` : '';
  const from = documentCounts(summary.sources);
  const written = `${from ? `From ${from}. ` : ''}Written by AI, check anything important.${read}`;
  return (
    <div className={styles.footer}>
      {state === 'stale' ? (
        <div className={styles.staleRow}>
          <span>Files or notes changed since this summary.{read}</span>
          <BusyButton
            variant="secondary"
            size="small"
            className={styles.smallButton}
            busy={writer.working}
            onClick={writer.write}
          >
            {writer.working ? READING : 'Update summary'}
          </BusyButton>
        </div>
      ) : (
        <p className={styles.footerText}>
          {summary.stale ? `Files or notes changed since this summary.${read}` : written}
        </p>
      )}
      {state === 'offSummary' ? <p className={styles.footerText}>{OFF_TEXT}</p> : null}
    </div>
  );
}

/** A line of text with the card's one button under it. */
function Prompt({ text, children }) {
  return (
    <>
      <p className={styles.note}>{text}</p>
      <div className={styles.cta}>{children}</div>
    </>
  );
}

/**
 * The written summary: action items, the AI phase line, the overview, the full text on request, the
 * footer.
 */
function SummaryText({ projectId, canAdd, currentPhase, state, summary, suggestion, writer }) {
  const { body } = summary;
  const risk = firstRisk(body);
  return (
    <>
      <ActionItems
        actions={summaryActions(body)}
        projectId={projectId}
        currentPhase={currentPhase}
        canAdd={canAdd}
      />
      {suggestion ? <AiLine suggestion={suggestion} /> : null}
      {body?.overview ? <p className={styles.text}>{body.overview}</p> : null}
      {risk ? <p className={styles.risk}>{risk}</p> : null}
      <FullSummary groups={summaryGroups(body)} />
      <SummaryFooter state={state} summary={summary} writer={writer} />
    </>
  );
}

/**
 * @param {{ projectId: number, status: string, available: boolean,
 *   counts: { files: number, notes: number },
 *   summary: { body: object, stale: boolean, truncated: boolean,
 *     sources: { files: number, notes: number } } | null,
 *   currentPhase: string | null, suggestion?: { quote: string, source: string } | null }} props
 *   status: the project's; available: ai.isAvailable('project_summary'); counts: the project's files
 *   and notes now; suggestion: the AI phase line (summaryView.aiSuggestion), null when it doesn't
 *   name the next phase or the project is completed
 */
export default function SummaryCard({
  projectId,
  status,
  available,
  counts,
  summary,
  currentPhase,
  suggestion = null,
}) {
  const heading = useRef(null);
  const writer = useWriteSummary(projectId, Boolean(summary), heading);
  const state = summaryState({ available, counts, summary });
  const total = counts.files + counts.notes;
  const shown = ['fresh', 'stale', 'offSummary'].includes(state);

  return (
    <Card as="section" padding="compact" aria-labelledby="summary-ai" className={styles.card}>
      <div className={styles.head}>
        <Sparkles className={styles.spark} size={18} strokeWidth={1.8} aria-hidden="true" />
        <h2 id="summary-ai" ref={heading} tabIndex={-1} className={styles.title}>
          AI summary
        </h2>
        <Tag tone="violet" padX={8}>
          AI
        </Tag>
      </div>

      {state === 'off' ? <p className={styles.note}>{OFF_TEXT}</p> : null}

      {state === 'empty' ? (
        <Prompt text={EMPTY_TEXT}>
          <Button variant="secondary" size="compact" href={tabHref(projectId, 'files')}>
            Go to files
          </Button>
        </Prompt>
      ) : null}

      {state === 'ready' ? (
        <Prompt text={`${documentCounts(counts)} ${total === 1 ? 'is' : 'are'} ready.`}>
          <BusyButton
            variant="secondary"
            size="compact"
            busy={writer.working}
            onClick={writer.write}
          >
            {writer.working ? READING : 'Write summary'}
          </BusyButton>
        </Prompt>
      ) : null}

      {shown ? (
        <SummaryText
          projectId={projectId}
          canAdd={status !== 'completed'}
          currentPhase={currentPhase}
          state={state}
          summary={summary}
          suggestion={suggestion}
          writer={writer}
        />
      ) : null}
    </Card>
  );
}
