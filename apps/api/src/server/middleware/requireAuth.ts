import type { Request, Response, NextFunction } from 'express';
import type { ApiResponse } from '@dem/shared';

/**
 * Express middleware that rejects unauthenticated requests with 401.
 * Attach to any route that requires a logged-in user.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized – please log in',
    } satisfies ApiResponse);
    return;
  }
  next();
}
