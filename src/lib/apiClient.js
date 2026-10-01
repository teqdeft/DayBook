// Browser-side helper for Client Components: calls /api routes and turns error responses into
// ApiError with the API's `fields` map, so forms can show errors under the right field.

export class ApiError extends Error {
  constructor({ code, message, fields, requestId } = {}, status = 500) {
    super(message || 'Something went wrong. Please try again.');
    this.name = 'ApiError';
    this.code = code || 'INTERNAL';
    this.status = status;
    this.fields = fields || {};
    this.requestId = requestId;
  }
}

/**
 * @param {string} path for example '/api/attendance/check-in'
 * @param {{ method?: string, body?: unknown, signal?: AbortSignal }} [options]
 * @returns {Promise<{ data: any, page?: { limit: number, offset: number, total: number } }>}
 */
export async function apiFetch(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      signal,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError(
      { code: 'NETWORK', message: "You're offline or Daybook can't be reached." },
      0,
    );
  }
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') {
      // The session ended: a full page load clears client state on the way to sign-in.
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate full reload
      window.location.href = `/login?next=${next}`;
    }
    throw new ApiError(json?.error, response.status);
  }
  return json ?? { data: null };
}

export const api = {
  get: (path, options) => apiFetch(path, { ...options, method: 'GET' }),
  post: (path, body, options) => apiFetch(path, { ...options, method: 'POST', body: body ?? {} }),
  put: (path, body, options) => apiFetch(path, { ...options, method: 'PUT', body: body ?? {} }),
  patch: (path, body, options) => apiFetch(path, { ...options, method: 'PATCH', body: body ?? {} }),
  delete: (path, options) => apiFetch(path, { ...options, method: 'DELETE' }),
};
