import { NextFunction, Request, RequestHandler, Response } from "express";

/** Enveloppe les handlers async pour propager les rejets vers errorHandler. */
export function h<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req as T, res, next).catch(next);
  };
}
