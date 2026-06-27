export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const USER_AGENT =
  process.env.USER_AGENT ??
  "VenezuelaReportaArchiver/1.0 (proyecto humanitario de respaldo de desaparecidos)";

/**
 * Descarga el HTML de una URL con reintentos.
 * Devuelve "" si el recurso ya no existe (404), para tratarlo como "sin tarjetas".
 */
export async function fetchHtml(url: string, retries = 3): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html" },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404) return "";
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} para ${url}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1500 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
