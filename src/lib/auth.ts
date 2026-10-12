// Optional dashboard password. If DASHBOARD_PASSWORD is unset the dashboard is open.
export const AUTH_COOKIE = "foe_auth";

export async function tokenFor(password: string): Promise<string> {
  const data = new TextEncoder().encode(`funding-outreach:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
