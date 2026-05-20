// All requests go through /api/* which Vite proxies to the Express server in dev.
// In production, the frontend and API share an origin, so no CORS is needed.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include', // always send the session cookie
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });

  // Parse JSON regardless of status so we can read the error message
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));

  if (!res.ok) {
    throw new ApiError(res.status, (body as { error?: string }).error ?? `Request failed (${res.status})`);
  }

  return body as T;
}

export const api = {
  get:    <T>(path: string)                   => request<T>(path),
  post:   <T>(path: string, data?: unknown)   => request<T>(path, { method: 'POST',   body: data != null ? JSON.stringify(data) : undefined }),
  put:    <T>(path: string, data?: unknown)   => request<T>(path, { method: 'PUT',    body: data != null ? JSON.stringify(data) : undefined }),
  patch:  <T>(path: string, data?: unknown)   => request<T>(path, { method: 'PATCH',  body: data != null ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string)                   => request<T>(path, { method: 'DELETE' }),
};
