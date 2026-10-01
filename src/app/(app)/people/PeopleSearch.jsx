'use client';
// Search on the People screen: filters the table through the URL (?q=) as you type. The field
// stays mounted while the page re-renders, so focus and what was typed are kept; it only takes
// the URL's text when that changed from somewhere else (for example "Clear search").
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import SearchBox from '@/components/SearchBox';

const DEBOUNCE_MS = 300;
const MAX_LENGTH = 100;

/** @param {{ defaultValue?: string, department?: string | null, className?: string }} props */
export default function PeopleSearch({ defaultValue = '', department = null, className }) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);
  const [urlValue, setUrlValue] = useState(defaultValue);
  // The text this field last put in the URL.
  const [applied, setApplied] = useState(defaultValue);
  const [pending, startTransition] = useTransition();
  const timer = useRef(null);
  // A search still waiting on its debounce applies to the department picked meanwhile.
  const departmentRef = useRef(department);

  useEffect(() => {
    departmentRef.current = department;
  }, [department]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // The URL's search changed: adopt it unless it is the text this field just sent.
  if (defaultValue !== urlValue) {
    setUrlValue(defaultValue);
    if (defaultValue !== applied) {
      setApplied(defaultValue);
      setValue(defaultValue);
    }
  }

  function apply(text) {
    const q = text.trim().slice(0, MAX_LENGTH);
    setApplied(q);
    const params = new URLSearchParams();
    if (departmentRef.current) params.set('department', departmentRef.current);
    if (q) params.set('q', q);
    const query = params.toString();
    startTransition(() => {
      router.replace(query ? `/people?${query}` : '/people', { scroll: false });
    });
  }

  function onChange(text) {
    setValue(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(text), DEBOUNCE_MS);
  }

  return (
    <form
      role="search"
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        clearTimeout(timer.current);
        apply(value);
      }}
    >
      <SearchBox
        placeholder="Search people"
        value={value}
        onChange={onChange}
        name="q"
        maxLength={MAX_LENGTH}
        aria-busy={pending || undefined}
      />
    </form>
  );
}
