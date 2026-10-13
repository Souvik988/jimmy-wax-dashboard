import type { ApiError } from './errors';

export type ServerFieldError = { type: 'server'; message: string };
export type SetFormError<TField extends string> = (field: TField, error: ServerFieldError) => void;

export function applyServerFieldErrors<TField extends string>(
  error: ApiError,
  allowedFields: readonly TField[],
  setError: SetFormError<TField>,
): TField | undefined {
  if (!error.fields) return undefined;
  const allowed = new Set<string>(allowedFields);
  let first: TField | undefined;
  for (const [path, message] of Object.entries(error.fields)) {
    if (!allowed.has(path)) continue;
    const field = path as TField;
    first ??= field;
    setError(field, { type: 'server', message });
  }
  return first;
}
