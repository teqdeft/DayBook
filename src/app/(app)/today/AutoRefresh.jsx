'use client';
// Re-renders the page from the server every minute while it is visible, so "Now", present time
// and live attendance stay current without a reload. Client state (open dialogs, typed notes)
// survives a refresh.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** @param {{ seconds?: number }} props */
export default function AutoRefresh({ seconds = 60 }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const timer = setInterval(refresh, seconds * 1000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router, seconds]);
  return null;
}
