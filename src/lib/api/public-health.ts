import { z } from 'zod';

import { authFetch } from '@/lib/auth/client';

import { ApiError, apiErrorFromResponse } from './errors';
import { storePolicySchema } from './public';

const publicHealthSchema = z.object({
  backend: z.enum(['connected', 'unavailable']),
  checkedAt: z.string().datetime(),
  policy: storePolicySchema.nullable(),
  requestId: z.string().optional(),
});

export type PublicHealthSnapshot = z.infer<typeof publicHealthSchema>;

export async function getPublicHealth(): Promise<PublicHealthSnapshot> {
  let response: Response;
  try {
    response = await authFetch('/api/health', { method: 'GET' });
  } catch {
    throw new ApiError(0, 'UNAVAILABLE', 'The public store status could not be reached.', undefined, true);
  }
  if (!response.ok) throw await apiErrorFromResponse(response);
  return publicHealthSchema.parse(await response.json());
}
