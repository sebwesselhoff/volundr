import type { Request, Response, NextFunction } from 'express';

export function cors(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Confirm-Delete');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}
