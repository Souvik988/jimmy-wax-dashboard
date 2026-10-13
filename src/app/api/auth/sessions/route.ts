import { NextRequest } from 'next/server';

import { proxyAdminRequest } from '@/server/auth/proxy';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) { return proxyAdminRequest(request, '/v1/admin/sessions'); }
