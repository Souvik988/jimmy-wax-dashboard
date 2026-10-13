import { NextRequest } from 'next/server';

import { proxyAdminRequest } from '@/server/auth/proxy';

export const dynamic = 'force-dynamic';
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) { const { id } = await context.params; return proxyAdminRequest(request, `/v1/admin/sessions/${encodeURIComponent(id)}`); }
