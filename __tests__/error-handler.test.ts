import { describe, it, expect } from 'vitest';
import { ApiError, withErrorHandler } from '@/lib/errors/api-error';
import { z } from 'zod';

describe('Global API Error Handling Foundation (C5)', () => {
  it('should instantiate ApiError with proper statusCode, code, and message', () => {
    const err = ApiError.badRequest('Invalid payload details', { field: 'email' });
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.message).toBe('Invalid payload details');
    expect(err.details).toEqual({ field: 'email' });
  });

  it('should catch ApiError and return appropriate JSON and status code', async () => {
    const handler = withErrorHandler(async () => {
      throw ApiError.forbidden('Access denied for this role');
    });

    const req = new Request('http://localhost:3000/api/test');
    const res = await handler(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('FORBIDDEN');
    expect(body.message).toBe('Access denied for this role');
  });

  it('should catch ZodError and return 400 with VALIDATION_ERROR', async () => {
    const schema = z.object({
      email: z.string().email(),
    });

    const handler = withErrorHandler(async () => {
      schema.parse({ email: 'not-an-email' });
      return new Response('ok');
    });

    const req = new Request('http://localhost:3000/api/test');
    const res = await handler(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details).toBeDefined();
  });

  it('should catch unhandled exceptions and return safe 500 error without leaking internal details', async () => {
    const handler = withErrorHandler(async () => {
      throw new Error('Database password was X or internal crash occurred');
    });

    const req = new Request('http://localhost:3000/api/test');
    const res = await handler(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('INTERNAL_SERVER_ERROR');
    expect(body.message).toBe('An unexpected internal server error occurred.');
    // Check that internal error message or stack trace was not leaked to response body
    expect(JSON.stringify(body)).not.toContain('Database password');
  });
});
