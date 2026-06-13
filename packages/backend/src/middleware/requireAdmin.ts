import { Request, Response, NextFunction } from "express";

/** Protect admin routes with ADMIN_API_KEY (X-Admin-Key header). */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    res.status(503).json({ error: "Admin API not configured" });
    return;
  }

  const provided = req.headers["x-admin-key"];
  if (provided !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
