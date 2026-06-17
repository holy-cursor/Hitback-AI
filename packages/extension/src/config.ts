/** Production API — custom domain on Fly. */
export const DEFAULT_BACKEND_URL = "https://api.hitback.xyz";

/** Close panel after this much silence following agent activity (ms). */
export const PANEL_DISPLAY_MS = 15_000;

/** Minimum wait after an ad is shown before another agent ad can open (ms). */
export const PANEL_COOLDOWN_MS = 60_000;

/** Client-side cap on agent-triggered ads per rolling hour (server enforces separately). */
export const MAX_ADS_PER_HOUR = 25;
