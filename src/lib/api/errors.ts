import { z } from 'zod';

const apiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    retryable: z.boolean().optional(),
    fields: z.record(z.string(), z.string()).optional(),
    lines: z.array(z.unknown()).optional(),
    reason: z.string().optional(),
    paused: z.boolean().optional(),
  }),
});

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string | undefined,
    readonly retryable = false,
    readonly fields?: Record<string, string> | undefined,
    readonly lines?: unknown[] | undefined,
    readonly reason?: string | undefined,
    readonly paused?: boolean | undefined,
    readonly retryAfter?: number | undefined,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  let raw: unknown;
  try {
    raw = await response.clone().json();
  } catch {
    raw = undefined;
  }
  const parsed = apiErrorEnvelopeSchema.safeParse(raw);
  const error = parsed.success ? parsed.data.error : undefined;
  return new ApiError(
    response.status,
    error?.code ?? (response.status >= 500 ? 'UNAVAILABLE' : 'INTERNAL'),
    error?.message ?? 'The request could not be completed. Try again or share the request reference with an administrator.',
    error?.requestId ?? response.headers.get('x-request-id') ?? undefined,
    error?.retryable ?? response.status >= 500,
    error?.fields,
    error?.lines,
    error?.reason,
    error?.paused,
    parseRetryAfter(response.headers.get('retry-after')),
  );
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
