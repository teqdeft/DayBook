// What the AI summary card and the Phase card show from a stored summary (CONTRACT 22). Pure and safe
// in the browser. Only people who can manage the project ever get a summary to pass in here.
import { nextPhase } from '@/modules/projectPlan/phases';
import { joinNames } from './planFormat';

const OWNERS = { client: 'Client', us: 'Us' };

/** "1 file and 2 notes", or '' with neither. */
export function documentCounts({ files = 0, notes = 0 } = {}) {
  const parts = [];
  if (files > 0) parts.push(files === 1 ? '1 file' : `${files} files`);
  if (notes > 0) parts.push(notes === 1 ? '1 note' : `${notes} notes`);
  return joinNames(parts);
}

/**
 * Which state the card is in.
 * @param {{ available: boolean, counts: { files: number, notes: number },
 *   summary: { stale: boolean } | null }} args available: ai.isAvailable('project_summary')
 * @returns {'off'|'offSummary'|'empty'|'ready'|'stale'|'fresh'} with every document deleted a summary
 *   no longer shows; with AI off an existing one stays readable and can't be updated
 */
export function summaryState({ available, counts, summary }) {
  const hasDocuments = counts.files + counts.notes > 0;
  if (!available) return hasDocuments && summary ? 'offSummary' : 'off';
  if (!hasDocuments) return 'empty';
  if (!summary) return 'ready';
  return summary.stale ? 'stale' : 'fresh';
}

/** "SOW-Acme-v3.pdf, page 3" or a note's title: worked out by Daybook, never by the AI. */
function sourceOf(point) {
  return point?.source ?? '';
}

/** The date in a deadline's text, unless the text already says it: "Designs ready: 20 November". */
function deadlineText({ text, dateAsWritten }) {
  if (!dateAsWritten || text.toLowerCase().includes(dateAsWritten.toLowerCase())) return text;
  return `${text}: ${dateAsWritten}`;
}

const riskText = ({ kind, text }) => `${kind === 'question' ? 'Question' : 'Risk'}: ${text}`;

/**
 * The groups "Read full summary" opens.
 * @param {object} body the stored summary
 * @returns {Array<{ title: string, points: Array<{ text: string, notInScope: boolean,
 *   source: string }> }>} groups with no points are left out
 */
export function summaryGroups(body) {
  const point = (item, text, notInScope = false) => ({ text, notInScope, source: sourceOf(item) });
  const groups = [
    {
      title: 'Scope',
      points: (body?.scope ?? []).map((item) => point(item, item.text, Boolean(item.notInScope))),
    },
    {
      title: 'Deadlines',
      points: (body?.deadlines ?? []).map((item) => point(item, deadlineText(item))),
    },
    {
      title: 'Risks and open questions',
      points: (body?.risks ?? []).map((item) => point(item, riskText(item))),
    },
  ];
  return groups.filter((group) => group.points.length > 0);
}

/** The first risk, shown under the overview. */
export function firstRisk(body) {
  const risk = (body?.risks ?? []).find((item) => item.kind !== 'question');
  return risk ? riskText(risk) : null;
}

/**
 * The action items box.
 * @param {object} body the stored summary
 * @returns {Array<{ key: string, who: string, text: string, when: string, added: boolean }>}
 */
export function summaryActions(body) {
  return (body?.actions ?? []).map((item) => ({
    key: item.key,
    who: OWNERS[item.owner] ?? 'Owner not clear',
    text: item.text,
    when: item.dueAsWritten || 'No date given',
    added: Boolean(item.taskId),
  }));
}

/**
 * The AI line on the Phase card. It shows only when the summary points at the current phase's next
 * phase with a quote it found, and the project isn't completed. It never moves anything.
 * @param {{ summary: { body: object } | null, currentPhase: string | null, status: string }} args
 * @returns {{ quote: string, source: string } | null}
 */
export function aiSuggestion({ summary, currentPhase, status }) {
  const next = summary?.body?.nextPhase;
  if (!next?.phase || !next.quote || status === 'completed') return null;
  if (next.phase !== nextPhase(currentPhase)) return null;
  return { quote: next.quote, source: sourceOf(next) };
}
