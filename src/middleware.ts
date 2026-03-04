import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateToken, SESSION_COOKIE } from '@/lib/auth';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (
    pathname === '/login' ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname === '/cortex-logo.svg' ||
    pathname.startsWith('/owp-logo')
  ) {
    return NextResponse.next();
  }

  // Check auth
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await validateToken(token))) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|cortex-logo.svg|owp-logo).*)'],
};
