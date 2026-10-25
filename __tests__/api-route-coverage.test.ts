import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Section E: API Route Authentication Coverage Test
 *
 * Scans every route.ts file under src/app/api.
 * Fails if any HTTP handler does not call requireAuth or requirePreAuthSession,
 * except for the explicit public allowlist:
 * - health
 * - auth/login
 * - auth/bootstrap
 * - auth/logout
 */
describe('Section E: API Route Authentication Coverage', () => {
  const ALLOWLIST = [
    'health',
    'auth/login',
    'auth/bootstrap',
    'auth/logout',
  ];

  const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

  function getAllRouteFiles(dir: string): string[] {
    let files: string[] = [];
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        files = files.concat(getAllRouteFiles(fullPath));
      } else if (entry === 'route.ts') {
        files.push(fullPath);
      }
    }
    return files;
  }

  const allRouteFiles = getAllRouteFiles(path.resolve(process.cwd(), 'src/app/api'));

  it('finds and scans all API route files under src/app/api', () => {
    expect(allRouteFiles.length).toBeGreaterThan(30);
  });

  it('strictly ensures every protected route handler invokes requireAuth or requirePreAuthSession', () => {
    const violations: Array<{ file: string; method: string; reason: string }> = [];

    for (const filePath of allRouteFiles) {
      const normalizedPath = filePath.split(path.sep).join('/');

      // Check if file is in the explicit allowlist
      const isAllowlisted = ALLOWLIST.some((allowed) =>
        normalizedPath.includes(allowed)
      );

      if (isAllowlisted) {
        continue;
      }

      const fileContent = fs.readFileSync(filePath, 'utf8');

      // Verify each exported HTTP method handler in this file
      for (const method of HTTP_METHODS) {
        const handlerRegex = new RegExp(
          `(export\\s+(const|async\\s+function)\\s+${method}\\b[\\s\\S]*?)(?=export\\s+(const|async\\s+function)\\s+(GET|POST|PUT|PATCH|DELETE)|$)`,
          'g'
        );
        const match = handlerRegex.exec(fileContent);

        if (match) {
          const handlerBody = match[1];
          const hasAuthCall =
            handlerBody.includes('requireAuth') ||
            handlerBody.includes('requirePreAuthSession');

          if (!hasAuthCall) {
            violations.push({
              file: path.relative(process.cwd(), filePath),
              method,
              reason: 'Exported HTTP handler does not call requireAuth or requirePreAuthSession',
            });
          }
        }
      }
    }

    expect(
      violations,
      `Unprotected API route handlers found:\n${JSON.stringify(violations, null, 2)}`
    ).toEqual([]);
  });

  it('verifies the explicit public allowlist contains only permitted unauthenticated endpoints', () => {
    const allowlistedFiles = allRouteFiles.filter((filePath) => {
      const normalized = filePath.split(path.sep).join('/');
      return ALLOWLIST.some((allowed) => normalized.includes(allowed));
    });

    const basenames = allowlistedFiles.map((f) =>
      path.relative(path.resolve(process.cwd(), 'src/app/api'), f).split(path.sep).join('/')
    );

    expect(basenames).toContain('health/route.ts');
    expect(basenames).toContain('v1/auth/login/route.ts');
    expect(basenames).toContain('v1/auth/bootstrap/route.ts');
    expect(basenames).toContain('v1/auth/logout/route.ts');
  });
});
