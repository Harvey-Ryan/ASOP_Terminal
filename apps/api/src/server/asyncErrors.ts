// Express 4 only catches errors a handler throws synchronously. When an async
// handler rejects (a database error, findUniqueOrThrow, a bad JSON.parse), the
// rejection goes unhandled and Node stops the whole process: the API and the
// bot (same container) restart, and the request never gets an answer.
//
// This passes those rejections to next(err) like a thrown error, so the error
// handler in app.ts answers 500 and everything keeps running (v1.11.3). It is
// the same as Express's own Layer.handle_request, plus the promise check.
// Express 5 does this itself; remove this file when upgrading.

import { createRequire } from 'node:module';
import type { NextFunction, Request, Response } from 'express';

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
interface LayerProto { handle: Handler; handle_request(req: Request, res: Response, next: NextFunction): void }

const Layer = createRequire(import.meta.url)('express/lib/router/layer.js') as { prototype: LayerProto };

Layer.prototype.handle_request = function handleRequest(this: LayerProto, req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) return next(); // an error handler: not for normal requests
  try {
    const result = fn(req, res, next);
    if (result instanceof Promise) {
      result.catch((err: unknown) => next(err ?? new Error('Request handler failed')));
    }
  } catch (err) {
    next(err);
  }
};
