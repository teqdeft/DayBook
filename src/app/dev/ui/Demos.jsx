'use client';

import { useState } from 'react';
import DayToggleGroup from '@/components/DayToggleGroup';
import FilterPills from '@/components/FilterPills';
import PersonChip from '@/components/PersonChip';
import SearchBox from '@/components/SearchBox';
import Segmented from '@/components/Segmented';
import Toggle from '@/components/Toggle';

// Stateful demos for the dev gallery (client components need client callbacks).

export function ToggleDemo({ initial = true, label, help, ariaLabel }) {
  const [checked, setChecked] = useState(initial);
  return (
    <Toggle
      checked={checked}
      onChange={setChecked}
      label={label}
      help={help}
      aria-label={label ? undefined : ariaLabel}
    />
  );
}

export function FilterPillsDemo({ items, initial }) {
  const [value, setValue] = useState(initial);
  return <FilterPills items={items} value={value} onChange={setValue} label="Filter" />;
}

export function SegmentedDemo({ items, initial }) {
  const [value, setValue] = useState(initial);
  return <Segmented items={items} value={value} onChange={setValue} label="Range" />;
}

export function SearchDemo({ placeholder }) {
  const [value, setValue] = useState('');
  return <SearchBox placeholder={placeholder} value={value} onChange={setValue} />;
}

export function PeopleDemo({ people }) {
  const [list, setList] = useState(people);
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {list.map((person) => (
        <PersonChip
          key={person.name}
          user={person}
          tone={person.tone}
          onRemove={(removed) =>
            setList((current) => current.filter((p) => p.name !== removed.name))
          }
        />
      ))}
    </div>
  );
}

export function DaysDemo() {
  const [days, setDays] = useState([1, 2, 3, 4, 5]);
  return <DayToggleGroup value={days} onChange={setDays} />;
}
