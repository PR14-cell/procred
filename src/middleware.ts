import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { getJwtSecret } from '@/lib/auth/secrets';

// Routes that do NOT require authentication
const PUBLIC_PATHS = [
  '/login',
  '/setup',
  '/api/health',
  '/api/v1/auth/login',
  '/api/v1/auth/mfa',
  '/api/v1/auth/bootstrap',
];

// Allowlist of permitted static file extensions
const STATIC_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|webp|map)$/i;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Static file allowlist restricted strictly to /_next/, /public/, /static/, or favicon.ico
  const isStaticPath =
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/public/') ||
    pathname.startsWith('/static/') ||
    pathname === '/favicon.ico';

  if (isStaticPath && (pathname.startsWith('/_next/') || STATIC_EXTENSIONS.test(pathname))) {
    return NextResponse.next();
  }

  // 2. Allow explicitly public paths
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  // Extract cookies
  const sessionToken = request.cookies.get('session_token')?.value;
  const preAuthToken = request.cookies.get('mfa_preauth_token')?.value;

  // Helper to add security headers to any response
  const applySecurityHeaders = (res: NextResponse) => {
    // Content-Security-Policy
    res.headers.set(
      'Content-Security-Policy',
      "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self';"
    );
    res.headers.set('X-Frame-Options', 'DENY');
    res.headers.set('X-Content-Type-Options', 'nosniff');
    res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    // HSTS when served over HTTPS (via direct connection or reverse proxy)
    const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol;
    if (proto === 'https' || proto === 'https:') {
      res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    }

    // Cache-Control: no-store on /api and authenticated pages
    if (pathname.startsWith('/api') || !isPublicPath) {
      res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.headers.set('Pragma', 'no-cache');
      res.headers.set('Expires', '0');
    }

    return res;
  };

  // 3. CSRF Protection for state-changing HTTP methods on /api/
  if (pathname.startsWith('/api/')) {
    const method = request.method.toUpperCase();
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    if (isMutation) {
      const authHeader = request.headers.get('authorization') || '';
      const isBearer = authHeader.startsWith('Bearer ') && authHeader.slice(7).trim().length > 0;

      // Skip requests with Authorization: Bearer <token>
      if (!isBearer) {
        const host = request.headers.get('host') || request.nextUrl.host;
        const origin = request.headers.get('origin');
        const secFetchSite = request.headers.get('sec-fetch-site');
        const referer = request.headers.get('referer');

        let isValidCsrf = false;

        if (origin) {
          try {
            const originHost = new URL(origin).host;
            if (originHost === host) {
              isValidCsrf = true;
            }
          } catch {
            isValidCsrf = false;
          }
        } else if (secFetchSite === 'same-origin' || secFetchSite === 'same-site') {
          isValidCsrf = true;
        } else if (referer) {
          try {
            const refererHost = new URL(referer).host;
            if (refererHost === host) {
              isValidCsrf = true;
            }
          } catch {
            isValidCsrf = false;
          }
        }

        if (!isValidCsrf) {
          return new NextResponse(
            JSON.stringify({
              type: 'https://httpstatuses.com/403',
              title: 'Forbidden',
              status: 403,
              detail: 'CSRF validation failed: Origin or Referer does not match Host.',
            }),
            {
              status: 403,
              headers: {
                'Content-Type': 'application/problem+json',
              },
            }
          );
        }
      }
    }
  }

  // If user is already on a public path (like /login or /setup)
  if (isPublicPath) {
    if (sessionToken && pathname === '/login') {
      try {
        const { payload } = await jwtVerify(sessionToken, getJwtSecret(), { algorithms: ['HS256'] });
        if (payload.authStage === 'authenticated') {
          return applySecurityHeaders(NextResponse.redirect(new URL('/dashboard', request.url)));
        }
      } catch {
        // Token invalid, allow /login
      }
    }
    return applySecurityHeaders(NextResponse.next());
  }

  // API routes handle their own structured JSON 401/403 responses via requireAuth
  if (pathname.startsWith('/api/')) {
    return applySecurityHeaders(NextResponse.next());
  }

  // For all protected frontend pages (/dashboard, /providers, etc.)
  if (!sessionToken) {
    if (preAuthToken) {
      try {
        const { payload } = await jwtVerify(preAuthToken, getJwtSecret(), { algorithms: ['HS256'] });
        if (payload.authStage === 'mfa_pending') {
          const mfaUrl = new URL('/login', request.url);
          mfaUrl.searchParams.set('step', 'mfa');
          return applySecurityHeaders(NextResponse.redirect(mfaUrl));
        }
        if (payload.authStage === 'mfa_enrollment_required') {
          const enrollUrl = new URL('/login', request.url);
          enrollUrl.searchParams.set('step', 'setup-mfa');
          return applySecurityHeaders(NextResponse.redirect(enrollUrl));
        }
      } catch {
        // Pre-auth expired or invalid, fall through to login
      }
    }

    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/' && pathname !== '/dashboard') {
      loginUrl.searchParams.set('callbackUrl', pathname);
    }
    return applySecurityHeaders(NextResponse.redirect(loginUrl));
  }

  // Session token is present - verify JWT signature, expiration, and authStage
  try {
    const { payload } = await jwtVerify(sessionToken, getJwtSecret(), { algorithms: ['HS256'] });

    if (payload.authStage === 'mfa_pending') {
      const mfaUrl = new URL('/login', request.url);
      mfaUrl.searchParams.set('step', 'mfa');
      return applySecurityHeaders(NextResponse.redirect(mfaUrl));
    }

    if (payload.authStage === 'mfa_enrollment_required') {
      const enrollUrl = new URL('/login', request.url);
      enrollUrl.searchParams.set('step', 'setup-mfa');
      return applySecurityHeaders(NextResponse.redirect(enrollUrl));
    }

    if (payload.authStage !== 'authenticated') {
      return applySecurityHeaders(NextResponse.redirect(new URL('/login', request.url)));
    }

    if (pathname === '/') {
      return applySecurityHeaders(NextResponse.redirect(new URL('/dashboard', request.url)));
    }

    return applySecurityHeaders(NextResponse.next());
  } catch {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('expired', 'true');
    const response = applySecurityHeaders(NextResponse.redirect(loginUrl));
    response.cookies.delete('session_token');
    response.cookies.delete('mfa_preauth_token');
    return response;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
