'use client';

import { csrfToken } from '@/lib/auth/client';
import type { ZodType } from 'zod';

import { apiEndpoint, type ApiPath } from './client';
import { ApiError, apiErrorFromResponse } from './errors';

export type UploadProgress = { loaded: number; total: number; percent: number };

export async function uploadFile<T>(
  path: ApiPath,
  file: File,
  schema: ZodType<T>,
  options: { fields?: Record<string, string>; signal?: AbortSignal; onProgress?: (progress: UploadProgress) => void; timeoutMs?: number } = {},
): Promise<T> {
  const form = new FormData();
  form.append('file', file, file.name);
  for (const [key, value] of Object.entries(options.fields ?? {})) form.append(key, value);

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    if (options.signal?.aborted) { reject(new ApiError(0, 'REQUEST_CANCELLED', 'The upload was cancelled.')); return; }
    options.signal?.addEventListener('abort', abort, { once: true });
    xhr.timeout = options.timeoutMs ?? 120_000;
    xhr.open('POST', apiEndpoint(path));
    xhr.withCredentials = true;
    const csrf = csrfToken();
    if (csrf) xhr.setRequestHeader('x-csrf-token', csrf);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.({ loaded: event.loaded, total: event.total, percent: Math.round((event.loaded / event.total) * 100) });
    };
    xhr.onerror = () => reject(new ApiError(0, 'UNAVAILABLE', 'The upload could not reach the backend. You can retry this selected file.', undefined, true));
    xhr.onabort = () => reject(new ApiError(0, 'REQUEST_CANCELLED', 'The upload was cancelled.'));
    xhr.ontimeout = () => reject(new ApiError(0, 'TIMEOUT', 'The upload took too long. You can retry this selected file.', undefined, true));
    xhr.onload = () => {
      const headers = new Headers();
      const contentType = xhr.getResponseHeader('content-type');
      const requestId = xhr.getResponseHeader('x-request-id');
      if (contentType) headers.set('content-type', contentType);
      if (requestId) headers.set('x-request-id', requestId);
      const response = new Response(xhr.responseText, { status: xhr.status, headers });
      if (!response.ok) { void apiErrorFromResponse(response).then(reject); return; }
      try {
        const parsed = schema.safeParse(JSON.parse(xhr.responseText) as unknown);
        if (!parsed.success) { reject(new ApiError(502, 'CONTRACT_DRIFT', 'The upload response did not match the expected resource contract.', requestId ?? undefined)); return; }
        resolve(parsed.data);
      } catch { reject(new ApiError(502, 'CONTRACT_DRIFT', 'The upload response was not valid JSON.', requestId ?? undefined)); }
    };
    xhr.onloadend = () => options.signal?.removeEventListener('abort', abort);
    xhr.send(form);
  });
}
