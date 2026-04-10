// Authenticated fetch wrapper for Fleet API endpoints.
// Fetches the API token from /fleet/auth/token (localhost only) on first use.
// Retries once with a fresh token on 401 (handles server restart with new token).

let apiToken: string | null = null;
let tokenPromise: Promise<string> | null = null;

async function fetchToken(): Promise<string> {
  try {
    const res = await fetch('/fleet/auth/token');
    if (!res.ok) {
      console.warn('[fleetFetch] Failed to fetch API token:', res.status);
      return '';
    }
    const data = await res.json();
    return data.token || '';
  } catch {
    return '';
  }
}

async function getApiToken(forceRefresh = false): Promise<string> {
  if (apiToken && !forceRefresh) return apiToken;
  // Clear stale cache on force refresh
  if (forceRefresh) {
    apiToken = null;
    tokenPromise = null;
  }
  if (!tokenPromise) {
    tokenPromise = fetchToken().then(token => {
      apiToken = token;
      tokenPromise = null;
      return token;
    });
  }
  return tokenPromise;
}

/**
 * Fetch wrapper that automatically adds the x-api-token header.
 * Retries once with a fresh token on 401 (server may have restarted).
 */
export async function fleetFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getApiToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['x-api-token'] = token;
  }
  if (options.method === 'POST' && options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const signal = options.signal ?? AbortSignal.timeout(30_000);
  const res = await fetch(path, { ...options, headers, signal });

  // On 401, the token may be stale (server restarted). Try once with a fresh token.
  if (res.status === 401 && token) {
    const freshToken = await getApiToken(true);
    if (freshToken && freshToken !== token) {
      headers['x-api-token'] = freshToken;
      return fetch(path, { ...options, headers, signal });
    }
  }

  return res;
}
