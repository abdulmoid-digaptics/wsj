import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { logEvent } from './redact';
import { RATE_LIMIT_MESSAGE } from './throttler-guard';

/** Stable machine-readable codes for each HTTP status. */
const CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 415: 'UNSUPPORTED_MEDIA_TYPE', 422: 'UNPROCESSABLE', 429: 'RATE_LIMITED',
  500: 'SERVICE_ERROR', 502: 'UPSTREAM_ERROR', 503: 'SERVICE_UNAVAILABLE', 504: 'UPSTREAM_TIMEOUT',
};
const SAFE_ID = /^[A-Za-z0-9._-]{8,100}$/;

/** Accept a caller's id only when it is harmless; otherwise mint one. */
export function requestIdOf(req: any): string {
  if (req?.requestId) return req.requestId;
  const incoming = req?.headers?.['x-request-id'];
  const id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
  if (req) req.requestId = id;
  return id;
}

/** Express middleware: every response carries X-Request-Id so support can trace a failure. */
export function requestIdMiddleware(req: any, res: any, next: () => void) {
  res.setHeader('X-Request-Id', requestIdOf(req));
  next();
}

const pathOf = (req: any) => String(req?.originalUrl ?? req?.url ?? '').split('?')[0];
const GENERIC = 'Unable to complete your request. Please try again.';

/**
 * Central error handler. The response shape is additive and backwards compatible:
 * `statusCode` and `message` stay, and `success`, `error.code` and `requestId` are added.
 * Internal details, provider errors and stack traces never reach the client.
 */
@Catch()
export class Errors implements ExceptionFilter {
  catch(error: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse(), req = typeof ctx.getRequest === 'function' ? ctx.getRequest() : undefined;
    const requestId = requestIdOf(req);
    let status = 500, message: unknown = GENERIC, details: unknown = null, code: string | undefined;
    if (error instanceof HttpException) {
      status = error.getStatus();
      const body = error.getResponse();
      if (typeof body === 'string') message = body;
      else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        message = b.message ?? message;
        /* Keep structured fields controllers already return. */
        const {message: _m, statusCode: _s, error: _e, ...rest} = b;
        if (Object.keys(rest).length) details = rest;
      }
      if (status === 429) message = RATE_LIMIT_MESSAGE;
    } else if (error?.type === 'entity.too.large' && error?.status === 413) { status = 413; message = 'Request body is too large'; }
    else if (error?.type === 'entity.parse.failed' && error?.status === 400) { status = 400; message = 'Malformed JSON request body'; }
    else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') { status = 409; message = 'Record already exists'; }
      else if (error.code === 'P2025') { status = 404; message = 'Record not found'; }
      else if (['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2034'].includes(error.code)) { status = 503; code = 'DATABASE_UNAVAILABLE'; message = 'The service is busy. Please try again shortly.'; }
      else { status = 400; message = 'Invalid database operation'; }
    } else if (error instanceof Prisma.PrismaClientInitializationError || error instanceof Prisma.PrismaClientRustPanicError) {
      status = 503; code = 'DATABASE_UNAVAILABLE'; message = 'The service is temporarily unavailable. Please try again shortly.';
    } else if (typeof error?.type === 'string' && error.type.startsWith('Stripe')) {
      status = error.type === 'StripeConnectionError' ? 503 : 502; code = 'PAYMENT_PROVIDER_ERROR';
      message = 'The payment service could not complete this request. Please try again in a moment.';
    }
    if (status >= 500) logEvent('error', 'http.unhandled', {requestId, method: req?.method, path: pathOf(req), status, error: error instanceof Error ? error : String(error), stack: typeof error?.stack === 'string' ? error.stack.split('\n').slice(1, 6).join(' | ') : null});
    else if (status === 429) logEvent('warn', 'http.rate_limited', {requestId, method: req?.method, path: pathOf(req)});
    if (!res.headersSent) res.setHeader?.('X-Request-Id', requestId);
    res.status(status).json({success: false, statusCode: status, message, error: {code: code ?? CODES[status] ?? (status >= 500 ? 'SERVICE_ERROR' : 'REQUEST_ERROR'), ...(status === 429 ? {message} : {}), details}, requestId});
  }
}
