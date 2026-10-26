'use client';
// Ask Daybook's chat: the questions and answers of this visit (kept in the page only, gone on
// leaving), a question box (Enter asks, Shift+Enter adds a line), example questions and what Ask
// Daybook can see. Each question sends the last four answered turns so follow-ups make sense.
// An example or Try again leaves what is typed in the box alone.
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Info, Sparkles } from 'lucide-react';
import Button from '@/components/Button';
import Card, { CardHeader } from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import Textarea from '@/components/Textarea';
import { api } from '@/lib/apiClient';
import styles from './AskChat.module.css';

const QUESTION_MAX = 500;
const HISTORY_MAX = 4;
// Asking again doesn't help with these: the limit lasts until tomorrow, AI stays off until an
// Admin turns it on.
const NO_RETRY = new Set(['AI_LIMIT', 'AI_OFF']);

function Turn({ turn, onRetry, busy }) {
  return (
    <li className={styles.turn}>
      <p className={styles.question}>{turn.question}</p>
      <div className={styles.answerRow}>
        <span className={styles.mark} aria-hidden="true">
          <Sparkles size={16} strokeWidth={1.8} />
        </span>
        {turn.pending ? (
          <p className={styles.thinking} role="status">
            Looking through Daybook
            <span className={styles.dots} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </p>
        ) : turn.error ? (
          <div className={styles.failed} role="alert">
            <p>{turn.error}</p>
            {NO_RETRY.has(turn.code) ? null : (
              <Button variant="text" size="small" onClick={() => onRetry(turn)} disabled={busy}>
                Try again
              </Button>
            )}
          </div>
        ) : (
          <p className={styles.answer}>{turn.answer}</p>
        )}
      </div>
    </li>
  );
}

/**
 * Brings the latest turn into view: with the question box under it when both fit, otherwise
 * from its question down, so a long answer is read from the top.
 */
function showLatest(list, composer) {
  const turn = list?.lastElementChild;
  if (!turn || !composer) return;
  const fits = turn.offsetHeight + composer.offsetHeight + 48 <= window.innerHeight;
  if (fits) composer.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  else turn.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/**
 * @param {{ examples: string[], sees: string, placeholder: string, emptyTitle: string }} props
 *   from askCopyFor(viewer kind)
 */
export default function AskChat({ examples, sees, placeholder, emptyTitle }) {
  const [turns, setTurns] = useState([]);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const nextId = useRef(0);
  const request = useRef(null);
  const listRef = useRef(null);
  const composerRef = useRef(null);
  const inputRef = useRef(null);
  const busy = turns.some((turn) => turn.pending);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (turns.length > 0) showLatest(listRef.current, composerRef.current);
  }, [turns]);

  const update = (id, values) =>
    setTurns((list) => list.map((turn) => (turn.id === id ? { ...turn, ...values } : turn)));

  /**
   * Asks a question. Only a question from the box clears the box; an example or Try again
   * leaves a half-written question there and puts focus back in the box.
   */
  async function ask(raw, { earlier = turns, fromBox = false } = {}) {
    const question = raw.trim();
    if (busy) return;
    if (question.length < 2) {
      setProblem('Type a question.');
      return;
    }
    const history = earlier
      .filter((turn) => turn.answer)
      .slice(-HISTORY_MAX)
      .map((turn) => ({ question: turn.question, answer: turn.answer }));
    nextId.current += 1;
    const id = nextId.current;
    setTurns([...earlier, { id, question, pending: true }]);
    if (fromBox) setText('');
    else inputRef.current?.focus({ preventScroll: true });
    setProblem('');
    const controller = new AbortController();
    request.current = controller;
    try {
      const { data } = await api.post(
        '/api/ai/ask',
        { question, history },
        { signal: controller.signal },
      );
      update(id, { pending: false, answer: data.answer });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      update(id, { pending: false, error: error.message, code: error.code });
    }
  }

  function retry(turn) {
    ask(turn.question, { earlier: turns.filter((other) => other.id !== turn.id) });
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      ask(text, { fromBox: true });
    }
  }

  return (
    <div className={styles.layout}>
      <Card padding="none" className={styles.chat}>
        <div className={styles.thread}>
          {turns.length === 0 ? (
            <EmptyState
              className={styles.empty}
              icon={<Sparkles size={20} strokeWidth={1.8} />}
              title={emptyTitle}
              body="Pick one of the examples or type your own question. Answers come only from Daybook's data."
            />
          ) : null}
          {/* Always in the page, so screen readers announce the first answer too. */}
          <ol ref={listRef} className={styles.turns} aria-live="polite">
            {turns.map((turn) => (
              <Turn key={turn.id} turn={turn} onRetry={retry} busy={busy} />
            ))}
          </ol>
        </div>
        <form
          ref={composerRef}
          className={styles.composer}
          onSubmit={(event) => {
            event.preventDefault();
            ask(text, { fromBox: true });
          }}
        >
          <label htmlFor="ask-question" className="visually-hidden">
            Your question
          </label>
          <Textarea
            ref={inputRef}
            id="ask-question"
            rows={2}
            value={text}
            maxLength={QUESTION_MAX}
            placeholder={placeholder}
            error={problem || undefined}
            aria-describedby={problem ? 'ask-problem' : 'ask-note'}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            className={styles.input}
          />
          {problem ? (
            <p id="ask-problem" className={styles.problem}>
              {problem}
            </p>
          ) : null}
          <div className={styles.composerFoot}>
            <p id="ask-note" className={styles.note}>
              <Info size={14} strokeWidth={1.8} aria-hidden="true" />
              Your question and the data needed to answer it are sent to Google Gemini.
            </p>
            <span className={`${styles.count} num`} aria-hidden="true">
              {text.length}/{QUESTION_MAX}
            </span>
            <Button type="submit" icon={<Sparkles size={18} strokeWidth={1.8} />} loading={busy}>
              Ask
            </Button>
          </div>
        </form>
      </Card>

      <aside className={styles.side}>
        <Card>
          <CardHeader title="Try asking" />
          <ul className={styles.examples}>
            {examples.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  className={styles.example}
                  onClick={() => ask(example)}
                  disabled={busy}
                >
                  <span>{example}</span>
                  <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="What Ask Daybook can see" />
          <p className={styles.sees}>{sees}</p>
          <p className={styles.small}>
            Answers are written by AI from Daybook&apos;s data. Check anything important. They
            aren&apos;t saved: they&apos;re gone when you leave this page.
          </p>
        </Card>
      </aside>
    </div>
  );
}
