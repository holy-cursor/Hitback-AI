/**
 * Shared types for the HitBack extension.
 */

/** Shape of the ad object returned by the backend. */
export interface Ad {
  id: string;
  text: string;
  url: string;
  imageUrl?: string;
}
