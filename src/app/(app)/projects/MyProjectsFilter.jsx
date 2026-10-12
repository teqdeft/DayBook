'use client';
// The project search on My projects (a company request): the box in the top bar filters the
// project cards by project or client name as the person types, in the browser (projectFilter.js).
// The tabs count
// what matches and keep the search; the address keeps it too (?q=), so a reload or the back
// button shows the same cards. The server renders the cards and hands them over as elements.
import { Fragment, createContext, useCallback, useContext, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import FilterPills from '@/components/FilterPills';
import SearchBox from '@/components/SearchBox';
import { plural } from '@/lib/text';
import { MAX_QUERY, cleanQuery, filterProjects } from './projectFilter';
import styles from './page.module.css';

const FilterContext = createContext(null);

const TAB_LABELS = { active: 'Active', completed: 'Completed' };

function useFilter() {
  const value = useContext(FilterContext);
  if (!value) throw new Error('My projects search needs <MyProjectsFilter>');
  return value;
}

/** '/projects', '/projects?status=completed&q=acme' */
function tabHref(status, q) {
  const search = new URLSearchParams();
  if (status !== 'active') search.set('status', status);
  if (q) search.set('q', q);
  const query = search.toString();
  return query ? `/projects?${query}` : '/projects';
}

/** Puts the search in the address without a new history entry or a server round trip. */
function rememberQuery(q) {
  const url = new URL(window.location.href);
  if (q) url.searchParams.set('q', q);
  else url.searchParams.delete('q');
  if (url.href !== window.location.href) window.history.replaceState(null, '', url);
}

/**
 * Holds the search text for the box and the cards (both sit under it). The address is the
 * source: a link, a tab or the back button that changes ?q= brings the box along.
 * @param {{ children: import('react').ReactNode }} props
 */
export default function MyProjectsFilter({ children }) {
  const fromAddress = cleanQuery(useSearchParams().get('q'));
  const [query, setText] = useState(fromAddress);
  const [synced, setSynced] = useState(fromAddress);
  if (fromAddress !== synced) {
    setSynced(fromAddress);
    // Typing changes the address too; only an outside change replaces what is in the box.
    if (fromAddress !== cleanQuery(query)) setText(fromAddress);
  }
  const inputRef = useRef(null);
  const setQuery = useCallback((text) => {
    setText(text);
    rememberQuery(cleanQuery(text));
  }, []);
  return (
    <FilterContext.Provider value={{ query, setQuery, inputRef }}>
      {children}
    </FilterContext.Provider>
  );
}

/** The search box (top bar). */
export function MyProjectsSearch({ className }) {
  const { query, setQuery, inputRef } = useFilter();
  return (
    <div role="search" className={className}>
      <SearchBox
        ref={inputRef}
        placeholder="Search projects"
        label="Search projects"
        value={query}
        maxLength={MAX_QUERY}
        onChange={(text) => setQuery(text)}
      />
    </div>
  );
}

/** '3 active projects match', '1 completed project matches' */
function matchText(count, tab) {
  const tabName = TAB_LABELS[tab].toLowerCase();
  return `${count} ${tabName} ${plural(count, 'project')} ${count === 1 ? 'matches' : 'match'}`;
}

/** The empty card when the search hides every card of the tab. */
function NoMatch({ q, other, otherCount, onClear }) {
  const body =
    otherCount > 0
      ? `${matchText(otherCount, other)}.`
      : 'Check the spelling, or try part of the name.';
  return (
    <EmptyState
      title={`No projects match “${q}”`}
      body={body}
      action={
        <Button variant="secondary" onClick={onClear}>
          Clear search
        </Button>
      }
    />
  );
}

/**
 * The status tabs, the cards that match the search and the empty states.
 * @param {{
 *   tab: 'active' | 'completed',
 *   active: Array<{ id: number, name: string, clientName?: string | null,
 *     card?: import('react').ReactNode }>,
 *   completed: Array<{ id: number, name: string, clientName?: string | null,
 *     card?: import('react').ReactNode }>,
 *   empty: import('react').ReactNode, footer?: import('react').ReactNode,
 * }} props empty: what the tab shows when it has no projects at all; footer: the "Request it"
 *   card under the cards
 */
export function MyProjectsList({ tab, active, completed, empty, footer = null }) {
  const { query, setQuery, inputRef } = useFilter();
  const q = cleanQuery(query);
  const all = { active, completed };
  const matching = { active: filterProjects(active, q), completed: filterProjects(completed, q) };
  const shown = matching[tab];
  const other = tab === 'completed' ? 'active' : 'completed';

  return (
    <>
      <FilterPills
        label="Project status"
        value={tab}
        items={Object.keys(TAB_LABELS).map((key) => ({
          value: key,
          label: `${TAB_LABELS[key]} (${matching[key].length})`,
          href: tabHref(key, q),
        }))}
      />
      {/* What a screen reader hears after each change of the search. */}
      <p className="visually-hidden" role="status">
        {q ? matchText(shown.length, tab) : ''}
      </p>
      {shown.length > 0 ? (
        <div className={styles.cardGrid}>
          {shown.map((item) => (
            <Fragment key={item.id}>{item.card}</Fragment>
          ))}
        </div>
      ) : (
        <Card className={styles.emptyCard}>
          {q && all[tab].length > 0 ? (
            <NoMatch
              q={q}
              other={other}
              otherCount={matching[other].length}
              onClear={() => {
                setQuery('');
                // The button goes away with the empty card: the focus goes back to the box.
                inputRef.current?.focus();
              }}
            />
          ) : (
            empty
          )}
        </Card>
      )}
      {footer}
    </>
  );
}
