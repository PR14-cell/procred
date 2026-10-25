/**
 * src/lib/auth/cookies.ts
 * Unified cookie security helper supporting HTTPS reverse proxies and private LAN HTTP testing.
 */

export function isSecureContext(req?: Request): boolean {
  if (process.env.COOKIE_SECURE === 'false') {
    return false;
  }
  if (process.env.COOKIE_SECURE === 'true') {
    return true;
  }

  // Check headers from reverse proxy (e.g., Nginx Proxy Manager, Cloudflare, Caddy)
  if (req) {
    const proto = req.headers.get('x-forwarded-proto');
    if (proto === 'https') return true;
    if (proto === 'http') return false;

    try {
      const url = new URL(req.url);
      if (url.protocol === 'https:') return true;
      // If accessing via non-localhost LAN IP over http://, Secure flag MUST be false or browsers reject the cookie
      const hostname = url.hostname;
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.')
      ) {
        return false;
      }
    } catch {
      // Fallback below
    }
  }

  // Default to secure in production when NEXTAUTH_URL is https
  if (process.env.NEXTAUTH_URL?.startsWith('https://')) {
    return true;
  }

  return process.env.NODE_ENV === 'production';
}

export interface SessionCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  expires?: Date;
}

export function getSessionCookieOptions(req?: Request, expires?: Date): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: isSecureContext(req),
    sameSite: 'lax',
    path: '/',
    ...(expires ? { expires } : {}),
  };
}
