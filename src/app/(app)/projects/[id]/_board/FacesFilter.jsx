'use client';
// The toolbar's faces (CONTRACT 28, Board toolbar item 6; the project's PM and Admins, and another
// PM): one round avatar per person with open tasks on this board, the PM first, then A to Z; up to
// 5, then "+2" with a menu of the rest; then the dashed Anyone circle. Each is a toggle that keeps
// that person's tasks in view; one at a time (pressing another switches, pressing the pressed one
// clears).
import { Users } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Menu from '@/components/Menu';
import { ANYONE, FACES_SHOWN, anyoneLabel, faceLabel, facesOf } from './boardFilters';
import styles from './Faces.module.css';

function Face({ face, pressed, onPress }) {
  return (
    <button
      type="button"
      className={styles.face}
      aria-pressed={pressed}
      aria-label={faceLabel(face)}
      title={`${face.name} (${face.count})`}
      onClick={onPress}
    >
      <Avatar user={face} size={28} />
    </button>
  );
}

/** "+2": a menu of the people after the first five. */
function MoreFaces({ rest, filters }) {
  const pressed = rest.some((face) => face.id === filters.state.face);
  const label = `${rest.length} more people`;
  return (
    <Menu
      label={label}
      width={220}
      triggerClassName={`${styles.face} ${styles.moreFace}`}
      triggerProps={{ 'aria-pressed': pressed, title: label }}
      items={rest.map((face) => ({
        label: `${face.name} (${face.count})`,
        checked: face.id === filters.state.face,
        onSelect: () => filters.setFace(face.id),
      }))}
    >
      <span className={styles.more} aria-hidden="true">
        +{rest.length}
      </span>
    </Menu>
  );
}

/** @param {{ board: object }} props board: useBoard's (`tasks`, `project.pmId`, `filters`) */
export default function FacesFilter({ board }) {
  const { filters } = board;
  const { people, anyone } = facesOf(board.tasks, board.project.pmId);
  if (people.length === 0 && anyone === 0) return null;
  const rest = people.slice(FACES_SHOWN);
  return (
    <div className={styles.faces} role="group" aria-label="Show one person's tasks">
      {people.slice(0, FACES_SHOWN).map((face) => (
        <Face
          key={face.id}
          face={face}
          pressed={filters.state.face === face.id}
          onPress={() => filters.setFace(face.id)}
        />
      ))}
      {rest.length ? <MoreFaces rest={rest} filters={filters} /> : null}
      {anyone ? (
        <button
          type="button"
          className={`${styles.face} ${styles.anyone}`}
          aria-pressed={filters.state.face === ANYONE}
          aria-label={anyoneLabel(anyone)}
          title={`Anyone on the project (${anyone})`}
          onClick={() => filters.setFace(ANYONE)}
        >
          <span className={styles.anyoneCircle}>
            <Users size={14} strokeWidth={1.8} aria-hidden="true" />
          </span>
        </button>
      ) : null}
    </div>
  );
}
