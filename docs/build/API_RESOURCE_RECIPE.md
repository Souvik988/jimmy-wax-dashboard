# Adding a dashboard API resource

Feature components must not call `fetch` or the backend origin directly. Put transport and runtime parsing in `src/lib/api/resources/<resource>.ts`; call only the same-origin API client, which delegates auth, CSRF, MFA step-up and the encrypted server session to the existing BFF.

```ts
import { z } from 'zod';

import { apiGet } from '@/lib/api/client';

const itemSchema = z.object({
  id: z.string().uuid(),
  // Add only fields verified from OpenAPI or a live contract probe.
});

const pageSchema = z.object({
  items: z.array(itemSchema),
  nextCursor: z.string().nullable(),
});

export type ExampleFilters = { limit: number; cursor?: string; state?: string };

export async function listExample(
  filters: ExampleFilters,
  signal: AbortSignal,
): Promise<z.infer<typeof pageSchema>> {
  const payload: unknown = await apiGet('admin/example-resource', {
    params: filters,
    signal,
  });
  return pageSchema.parse(payload);
}
```

Then add a stable key and narrow invalidation entry in `src/lib/api/query-keys.ts`, use `useCursorList` for `{items,nextCursor}`, and render explicit loading/empty/error/offline/permission states. Filters belong in a normalized query key; only non-sensitive shareable values belong in the URL or saved views. Do not decode cursors or sort a partial page in the browser.

For mutations, use `apiPost`/`apiPut`/`apiPatch`/`apiDelete`; validate request fields with Zod, and pass only documented safeguards (`reason`, `expectedVersion`, `ifMatch`, or `idempotencyKey`). Use `createIdempotentPost` only where the operation contract documents `Idempotency-Key`; keep the exact key and body for a deliberate retry. Do not auto-retry ambiguous writes. After confirmed success, invalidate only the keys listed for that resource. For CSV, use `apiDownload`, validate the actual response content type and safe attachment filename, and initiate a user-requested Blob download; current CSV buffering is documented in DASH-BR-004/R-018.

Add unit tests for schema rejection, query normalization, cursor de-duplication, error/conflict behavior, and mutation policy. Add real-backend integration coverage only where the fixture is safe and cleanup is proven; never use customer-visible/money-affecting writes as an implicit test fixture. Add Playwright coverage with disposable operators for allowed and denied roles, and avoid storing credentials or PII in traces/screenshots.

Current invalidation map: orders -> all order lists; order notes -> that order's notes/detail; customers -> customer lists; settings -> settings + store status + overview; store status -> status + overview; Studio document -> document + revisions + channel diff. See `src/lib/api/query-keys.ts` for the source of truth.
