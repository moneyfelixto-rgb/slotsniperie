// Public base URL of the external Python backend (not a secret).
// Override with VITE_BACKEND_URL when the stable domain replaces the temporary tunnel.
export const BACKEND_URL = (
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ??
  "https://reproduced-accessing-beijing-opinions.trycloudflare.com"
).replace(/\/$/, "");

export function backendConnectUrl(token: string) {
  return `${BACKEND_URL}/auth/connect?token=${encodeURIComponent(token)}`;
}
