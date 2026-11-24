'use client';
// The Files tab's places (CONTRACT 27, Files tab, Side list): All files, Whole project, the six
// phases (the current one tagged), then On tasks, each with how many items this viewer may see.
// Plain links (`?tab=files&place=design`): a plain click changes the place without a server trip
// (FilesView replaces the URL), so the leave guard never asks; a modifier click opens a new tab.
import Card from '@/components/Card';
import Tag from '@/components/Tag';
import { PHASE_KEYS } from '@/modules/projectPlan/phases';
import { placeHref, placeName } from './filesTabView';
import styles from './FilesTab.module.css';

/**
 * Whether a click on a place link is a plain one (no new tab or window).
 * @param {import('react').MouseEvent} event
 */
export function isPlainClick(event) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function PlaceLink({ place, chosen, count, current, onPlace }) {
  return (
    <li>
      <a
        href={placeHref(place)}
        className={`${styles.place} ${count === 0 ? styles.zero : ''}`}
        aria-current={place === chosen ? 'page' : undefined}
        onClick={(event) => {
          if (!isPlainClick(event)) return;
          event.preventDefault();
          onPlace(place);
        }}
      >
        <span className={styles.placeName}>{placeName(place)}</span>
        {current ? <Tag tone="primary">Current</Tag> : null}
        <span className={styles.placeCount}>{count}</span>
      </a>
    </li>
  );
}

/**
 * @param {{ place: string, counts: Record<string, number>, currentPhase: string | null,
 *   onPlace: (place: string) => void }} props counts: placeCounts' (per viewer)
 */
export default function PlaceList({ place, counts, currentPhase, onPlace }) {
  const link = (key) => (
    <PlaceLink
      key={key}
      place={key}
      chosen={place}
      count={counts[key] ?? 0}
      current={key === currentPhase}
      onPlace={onPlace}
    />
  );
  return (
    <Card as="nav" className={styles.places} aria-label="Places">
      <ul className={styles.placeList}>
        {link('all')}
        {link('project')}
        <li className={styles.placeHeading} aria-hidden="true">
          Phases
        </li>
        {PHASE_KEYS.map(link)}
        <li className={styles.placeLine} aria-hidden="true" />
        {link('tasks')}
      </ul>
    </Card>
  );
}
