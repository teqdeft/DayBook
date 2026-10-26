'use client';
// "Polish my tasks" on the daily report (CONTRACT 20): the Polish with AI button sends the
// report's task lines to POST /api/ai/polish and opens "Suggested wording" with the lines Gemini
// changed; "Fill report from timers" does the same for just the lines it wrote (auto-write), and
// stays quiet when Gemini changes nothing or can't answer. Only while data.aiPolish (GEMINI_API_KEY
// and Settings → AI) and the report can change; otherwise the page looks and works as before.
// Inside ReportProvider; picked lines go through its change(), so autosave and the backup of a
// submitted report behave as they do for typing. The auto-write offer opens without putting focus
// on Use selected (the person may be typing), and is dropped when the report was submitted or
// otherwise changed status while Gemini was writing.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import Button from '@/components/Button';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { plural } from '@/lib/text';
import PolishDialog from './PolishDialog';
import styles from './PolishProvider.module.css';
import { useReport } from './ReportProvider';
import {
  applySuggestions,
  changedSuggestions,
  mayOffer,
  polishableLines,
  polishRequest,
  reportStage,
} from './reportPolish';

const PolishContext = createContext(null);

/**
 * @returns {{ available: boolean, busy: boolean, polishAll: () => Promise<void>,
 *   fillFromTimers: () => Promise<void> }} fillFromTimers is "Fill report from timers" (use it
 *   instead of useReport().applyTimers)
 */
export function usePolish() {
  const value = useContext(PolishContext);
  if (!value) throw new Error('usePolish() needs <PolishProvider>');
  return value;
}

/** @param {{ children: import('react').ReactNode }} props */
export default function PolishProvider({ children }) {
  const { data, entries, report, readOnly, change, applyTimers } = useReport();
  const toast = useToast();
  const available = Boolean(data.aiPolish) && !readOnly;
  // The report's status and submit time: an auto offer is dropped when they change meanwhile.
  const stage = reportStage(report);
  const [busy, setBusy] = useState(false);
  // { id, items, auto } while "Suggested wording" is open.
  const [offer, setOffer] = useState(null);
  const live = useRef({ available, stage, running: false, offers: 0 });

  useEffect(() => {
    live.current.available = available;
    live.current.stage = stage;
  }, [available, stage]);

  /** Asks Gemini about `lines`; `auto` (after a fill) only speaks up with suggestions. */
  const polish = useCallback(
    async (lines, { auto = false } = {}) => {
      const state = live.current;
      if (state.running || !state.available) return;
      if (lines.length === 0) {
        if (!auto) toast({ title: 'No tasks to polish yet', body: 'Write your tasks first.' });
        return;
      }
      state.running = true;
      setBusy(true);
      const stageAtStart = state.stage;
      try {
        const { data: answer } = await api.post('/api/ai/polish', polishRequest(lines));
        // The report may have locked, or changed somewhere else, while Gemini was writing; an
        // offer nobody asked for isn't worth reopening a report submitted in the meantime.
        const { available: stillAvailable, stage: stageNow } = state;
        if (!mayOffer({ auto, available: stillAvailable, stageAtStart, stageNow })) return;
        const items = changedSuggestions(lines, answer?.lines);
        if (items.length > 0) {
          state.offers += 1;
          setOffer({ id: state.offers, items, auto });
        } else if (!auto) {
          toast({ title: 'Your tasks already read well' });
        }
      } catch (error) {
        if (!auto) {
          toast({ title: "Couldn't polish your tasks", body: error?.message, tone: 'error' });
        }
      } finally {
        state.running = false;
        setBusy(false);
      }
    },
    [toast],
  );

  const polishAll = useCallback(() => polish(polishableLines(entries)), [polish, entries]);

  const fillFromTimers = useCallback(async () => {
    const written = await applyTimers();
    if (written?.length) await polish(written, { auto: true });
  }, [applyTimers, polish]);

  const use = useCallback(
    (picked) => {
      let applied = 0;
      change((rows) => {
        const result = applySuggestions(rows, picked);
        applied = result.applied;
        return result.rows;
      });
      setOffer(null);
      if (applied > 0) toast({ title: `${applied} ${plural(applied, 'task')} reworded` });
      else toast({ title: 'Nothing changed', body: 'Those tasks were edited in the meantime.' });
    },
    [change, toast],
  );

  const value = { available, busy, polishAll, fillFromTimers };
  return (
    <PolishContext.Provider value={value}>
      {children}
      {offer && available ? (
        <PolishDialog
          key={offer.id}
          items={offer.items}
          auto={offer.auto}
          onUse={use}
          onClose={() => setOffer(null)}
        />
      ) : null}
    </PolishContext.Provider>
  );
}

/**
 * The top bar's secondary "Polish with AI" (sparkle icon), beside the submit buttons. While
 * Gemini writes it shows a spinner and ignores presses, but stays focusable (aria-disabled, not
 * disabled): a disabled button drops keyboard focus to the page, and the dialog would then hand
 * it back there instead of to this button. At 1024–1199 px beside both submit buttons it shows
 * its icon only (PolishProvider.module.css), keeping its name for screen readers and as a tooltip.
 */
export function PolishButton() {
  const { submitting } = useReport();
  const { available, busy, polishAll } = usePolish();
  if (!available) return null;
  return (
    <Button
      size="large"
      variant="secondary"
      icon={
        busy ? (
          <LoaderCircle className={styles.spinner} size={18} strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <Sparkles size={18} strokeWidth={1.8} aria-hidden="true" />
        )
      }
      className={`${styles.polish} ${busy ? styles.busy : ''}`}
      title="Polish with AI"
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      disabled={submitting}
      onClick={busy ? undefined : polishAll}
    >
      <span className={styles.label}>Polish with AI</span>
    </Button>
  );
}
