'use client';
// Search box on Projects: filters the table as you type (?q=), keeping the selected tab.
import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import SearchBox from '@/components/SearchBox';

const DEBOUNCE_MS = 250;

export default function ProjectSearch({ initialQuery = '', className }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQuery);
  const [synced, setSynced] = useState(initialQuery);
  const [focused, setFocused] = useState(false);
  const [, startTransition] = useTransition();
  const timer = useRef(null);

  // The box stays mounted while the table re-renders for each search, so typing keeps focus.
  // When ?q= changes from elsewhere (a "Clear search" link), the box follows it, but never while
  // someone is typing in it.
  if (initialQuery !== synced) {
    setSynced(initialQuery);
    if (!focused) setValue(initialQuery);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  function go(text) {
    clearTimeout(timer.current);
    const params = new URLSearchParams(searchParams.toString());
    const q = text.trim();
    if (q === (params.get('q') ?? '')) return;
    if (q) params.set('q', q);
    else params.delete('q');
    params.delete('page');
    const query = params.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  return (
    <form
      role="search"
      className={className}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onSubmit={(event) => {
        event.preventDefault();
        go(value);
      }}
    >
      <SearchBox
        placeholder="Search projects"
        label="Search projects"
        value={value}
        maxLength={120}
        onChange={(text) => {
          setValue(text);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => go(text), DEBOUNCE_MS);
        }}
      />
    </form>
  );
}
