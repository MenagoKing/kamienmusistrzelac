/** Tiny JSON client for /api. Throws ApiError with the server's message. */
export class ApiError extends Error {
  status: number;
  /** The server's extra fields (e.g. code: 'changed' with the fresh price). */
  data: any;
  constructor(status: number, message: string, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'You seem to be offline. Try again.');
  }
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, (data && data.error) || `Request failed (${r.status})`, data);
  return data as T;
}
