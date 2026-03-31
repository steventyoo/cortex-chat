import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateUserSession, SESSION_COOKIE } from '@/lib/auth-v2';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/onboarding' ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/onboarding') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname === '/cortex-logo.svg'
  ) {
    return NextResponse.next();
  }

  // Allow cron-triggered endpoints (auth handled inside the route)
  if (pathname === '/api/pipeline/scan-drive') {
    return NextResponse.next();
  }

  // Check JWT auth
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  const session = await validateUserSession(token);
  if (!session) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Propagate session info to API routes via headers
  const response = NextResponse.next();
  response.headers.set('x-user-id', session.userId);
  response.headers.set('x-org-id', session.orgId);
  response.headers.set('x-user-email', session.email);
  response.headers.set('x-user-role', session.role);

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|cortex-logo.svg).*)'],
};
