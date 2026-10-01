'use client';
// Rendered by TopBar when the page render found the session cookie out of date: the session was
// extended while rendering (pages can't set cookies). One signed-in API call lets withRoute
// re-issue the cookie with the new expiry, so the browser keeps the session as long as the
// database does.
import { useEffect } from 'react';
import { api } from '@/lib/apiClient';

let pending = null;

export default function SessionRefresh() {
  useEffect(() => {
    if (pending) return;
    pending = api
      .get('/api/me')
      .catch(() => {})
      .finally(() => {
        pending = null;
      });
  }, []);
  return null;
}
