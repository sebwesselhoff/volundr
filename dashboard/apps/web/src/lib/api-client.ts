import { API_PORT } from '@vldr/shared';

const BASE_URL = `http://localhost:${API_PORT}`;

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const errorData = err as { error?: string };
    throw new Error(errorData.error || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
