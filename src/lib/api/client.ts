'use client';

import { authFetch } from '@/lib/auth/client';

import { ApiError, apiErrorFromResponse } from './errors';

export type ApiPath = `admin/${string}`;

export type ApiOptions = {
  params?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
  headers?: HeadersInit;
  idempotencyKey?: string;
  ifMatch?: string;
};

export function apiEndpoint(path: ApiPath, params?: ApiOptions['params']): string {
  // A segment may be `slug` or `scope:slug` (Studio custom page keys such as custom:about) with an optional `.ext`.
  if (!/^admin(?:\/[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)?(?:\.[A-Za-z0-9_-]+)?)+$/u.test(path)) {
    throw new ApiError(400, 'INVALID_API_PATH', 'This dashboard resource path is not allowed.');
  }
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === null || value === undefined || value === '') continue;
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,49}$/u.test(key)) {
      throw new ApiError(400, 'INVALID_API_QUERY', 'This dashboard query parameter is not allowed.');
    }
    query.set(key, String(value));
  }
  const suffix = query.size ? `?${query.toString()}` : '';
  return `/api/backend/${path}${suffix}`;
}

async function request<T>(method: string, path: ApiPath, body?: unknown, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const url = apiEndpoint(path, options.params);
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (options.ifMatch) headers.set('if-match', options.ifMatch);
  if (options.idempotencyKey) headers.set('idempotency-key', options.idempotencyKey);
  let response: Response;
  try {
    response = await authFetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    throw new ApiError(0, 'UNAVAILABLE', 'The backend could not be reached. Your previous results, if shown, may be out of date.', undefined, true);
  }
  if (!response.ok) throw await apiErrorFromResponse(response);
  if (response.status === 204) return null as T;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ApiError(502, 'CONTRACT_DRIFT', 'The backend returned a response type this resource did not expect.', response.headers.get('x-request-id') ?? undefined);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(502, 'CONTRACT_DRIFT', 'The backend returned invalid JSON. Refresh before trying again.', response.headers.get('x-request-id') ?? undefined);
  }
}

export function apiGet<T>(path: ApiPath, options: ApiOptions = {}): Promise<T> {
  return request<T>('GET', path, undefined, options);
}

export function apiPost<T>(path: ApiPath, body?: unknown, options: ApiOptions = {}): Promise<T> {
  return request<T>('POST', path, body, options);
}

export function apiPut<T>(path: ApiPath, body: unknown, options: ApiOptions = {}): Promise<T> {
  return request<T>('PUT', path, body, options);
}

export function apiPatch<T>(path: ApiPath, body: unknown, options: ApiOptions = {}): Promise<T> {
  return request<T>('PATCH', path, body, options);
}

/** `body` is for guarded deletes that must carry `expectedRev` and a reason. */
export function apiDelete<T>(path: ApiPath, options: ApiOptions = {}, body?: unknown): Promise<T> {
  return request<T>('DELETE', path, body, options);
}

export type JsonApiResult<T> = { data: T; status: number; requestId?: string };

/** Raw UTF-8 CSV body for documented text endpoints; JSON errors stay on the shared parser. */
export async function apiPostTextResult<T>(
  path: ApiPath,
  body: string,
  acceptedStatuses: readonly number[],
  options: ApiOptions = {},
): Promise<JsonApiResult<T>> {
  const headers = new Headers(options.headers);
  headers.set('content-type', 'text/csv; charset=utf-8');
  if (options.ifMatch) headers.set('if-match', options.ifMatch);
  if (options.idempotencyKey) headers.set('idempotency-key', options.idempotencyKey);
  let response: Response;
  try {
    response = await authFetch(apiEndpoint(path, options.params), {
      method: 'POST', body, headers,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    throw new ApiError(0, 'UNAVAILABLE', 'The backend could not be reached. Your previous results, if shown, may be out of date.', undefined, true);
  }
  if (!response.ok && !acceptedStatuses.includes(response.status)) throw await apiErrorFromResponse(response);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ApiError(502, 'CONTRACT_DRIFT', 'The backend returned a response type this resource did not expect.', response.headers.get('x-request-id') ?? undefined);
  }
  let data: T;
  try {
    data = (await response.json()) as T;
  } catch {
    throw new ApiError(502, 'CONTRACT_DRIFT', 'The backend returned invalid JSON. Refresh before trying again.', response.headers.get('x-request-id') ?? undefined);
  }
  return {
    data,
    status: response.status,
    ...(response.headers.get('x-request-id') ? { requestId: response.headers.get('x-request-id')! } : {}),
  };
}

export type ApiDownload = { blob: Blob; filename: string; requestId?: string };

function attachmentFilename(header: string | null): string {
  const match = header?.match(/filename\s*=\s*"?([^";]+)"?/iu);
  const candidate = match?.[1]?.trim() ?? 'download.csv';
  const clean = candidate.replace(/[^A-Za-z0-9._-]/gu, '_').replace(/^\.+/u, '').slice(0, 120);
  return clean || 'download.csv';
}

export async function apiDownload(path: ApiPath, options: ApiOptions = {}): Promise<ApiDownload> {
  const url = apiEndpoint(path, options.params);
  let response: Response;
  try {
    response = await authFetch(url, { method: 'GET', ...(options.signal ? { signal: options.signal } : {}) });
  } catch {
    throw new ApiError(0, 'UNAVAILABLE', 'The export could not reach the backend. Try again when connectivity returns.', undefined, true);
  }
  if (!response.ok) throw await apiErrorFromResponse(response);
  const type = response.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('text/csv')) throw new ApiError(502, 'CONTRACT_DRIFT', 'The export did not return CSV.', response.headers.get('x-request-id') ?? undefined);
  return {
    blob: await response.blob(),
    filename: attachmentFilename(response.headers.get('content-disposition')),
    ...(response.headers.get('x-request-id') ? { requestId: response.headers.get('x-request-id')! } : {}),
  };
}

export function downloadBlob({ blob, filename }: ApiDownload): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function createIdempotentPost<T>(path: ApiPath, body: unknown, options: Omit<ApiOptions, 'idempotencyKey'> & { retryKey?: string } = {}): { key: string; run: () => Promise<T> } {
  const { retryKey, ...requestOptions } = options;
  const key = retryKey ?? createIdempotencyKey();
  return { key, run: () => apiPost<T>(path, body, { ...requestOptions, idempotencyKey: key }) };
}
