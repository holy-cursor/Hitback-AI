import { Request } from "express";

/** Anonymous install ID sent by the extension on every ad request. */
export function getExtensionUserId(req: Request): string | null {
  const header = req.headers["x-hitback-user-id"];
  if (typeof header === "string" && header.trim().length > 0) {
    return header.trim();
  }

  const query = req.query.extensionUserId;
  if (typeof query === "string" && query.trim().length > 0) {
    return query.trim();
  }

  return null;
}
