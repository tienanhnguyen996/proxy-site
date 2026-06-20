import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySessionToken } from '@/lib/auth';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Paths that require authentication
  const isProtectedRoute = 
    pathname === '/' || 
    pathname.startsWith('/read') || 
    pathname.startsWith('/library') ||
    pathname.startsWith('/api/read') ||
    pathname.startsWith('/api/library');

  if (isProtectedRoute) {
    const sessionCookie = request.cookies.get('aetherread_session')?.value || '';
    
    // Verify token
    const isValid = await verifySessionToken(sessionCookie);

    if (!isValid) {
      // If it is an API route, return 401 JSON
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Unauthorized. Please login.' },
          { status: 401 }
        );
      }
      
      // Otherwise, redirect page visits to /login
      const loginUrl = new URL('/login', request.url);
      // Pass the original URL to redirect back after login if desired, or just redirect
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

// Config to optimize middleware matching
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
