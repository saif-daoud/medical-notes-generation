export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const API_BASE = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

export function apiEnabled() {
  return Boolean(API_BASE);
}

export async function postJSON(path, body, options = {}) {
  if (!API_BASE) throw new Error("API is not configured.");

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 14000);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(String(payload?.error || response.statusText || "Request failed"), response.status);
    }

    return payload;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
