'use client';
// The places as one select, below 1024 px (CONTRACT 27, Files tab, Phone): "Show" with every place
// and its count ("Design · 8"). Choosing one changes the place as the side list's links do.
import Select from '@/components/Select';
import { PLACES, placeName } from './filesTabView';
import styles from './FilesTab.module.css';

/**
 * @param {{ place: string, counts: Record<string, number>, onPlace: (place: string) => void }}
 *   props
 */
export default function PlaceSelect({ place, counts, onPlace }) {
  return (
    <div className={styles.show}>
      <label className={styles.showLabel} htmlFor="files-show">
        Show
      </label>
      <Select
        id="files-show"
        className={styles.select}
        value={place}
        onChange={(event) => onPlace(event.target.value)}
        options={PLACES.map((key) => ({
          value: key,
          label: `${placeName(key)} · ${counts[key] ?? 0}`,
        }))}
      />
    </div>
  );
}
