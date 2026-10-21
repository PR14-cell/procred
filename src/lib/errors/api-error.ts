import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';

export class ApiError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = 'Bad Request', details?: unknown) {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'Forbidden: insufficient permissions') {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static conflict(message = 'Resource conflict', details?: unknown) {
    return new ApiError(409, 'CONFLICT', message, details);
  }

  static internal(message = 'Internal server error') {
    return new ApiError(500, 'INTERNAL_SERVER_ERROR', message);
  }
}

export type RouteHandler<T = unknown> = (
  req: Request,
  context?: T
) => Promise<NextResponse | Response>;

export function withErrorHandler<T = unknown>(handler: RouteHandler<T>): RouteHandler<T> {
  return async (req: Request, context?: T) => {
    try {
      return await handler(req, context);
    } catch (error: unknown) {
      // 1. Handled custom ApiError
      if (error instanceof ApiError) {
        console.warn(`[ApiError] ${error.code} (${error.statusCode}): ${error.message}`);
        return NextResponse.json(
          {
            error: error.code,
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
          { status: error.statusCode }
        );
      }

      // 2. Zod validation errors
      if (error instanceof ZodError) {
        console.warn(`[ValidationError] Invalid request payload:`, error.flatten());
        return NextResponse.json(
          {
            error: 'VALIDATION_ERROR',
            code: 'VALIDATION_ERROR',
            message: 'Validation failed for request payload',
            details: error.flatten().fieldErrors,
          },
          { status: 400 }
        );
      }

      // 3. Prisma unique constraint violation (P2002)
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          const target = (error.meta?.target as string[])?.join(', ') || 'field';
          return NextResponse.json(
            {
              error: 'CONFLICT',
              code: 'UNIQUE_CONSTRAINT_VIOLATION',
              message: `A record with this ${target} already exists.`,
            },
            { status: 409 }
          );
        }
        if (error.code === 'P2025') {
          return NextResponse.json(
            {
              error: 'NOT_FOUND',
              code: 'RECORD_NOT_FOUND',
              message: 'The requested record does not exist.',
            },
            { status: 404 }
          );
        }
      }

      // 4. Unhandled server error: log stack trace server-side, return safe sanitized message to client
      console.error(`[UnhandledError] Internal Server Error:`, error);
      return NextResponse.json(
        {
          error: 'INTERNAL_SERVER_ERROR',
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected internal server error occurred.',
        },
        { status: 500 }
      );
    }
  };
}
