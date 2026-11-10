import { withSafeFetch } from '../../common/security/ssrf-guard';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

/** Compares two x.y.z versions (a prerelease suffix is ignored): 1 if a > b, -1 if a < b, 0 if equal. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    String(v)
      .split('-')[0]
      .split('.')
      .map(n => Number.parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Fetch a remote resource (e.g. the latest-release JSON) as a Buffer, always behind the SSRF guard:
 * every host (the original URL and every redirect hop) is validated before its socket opens and a hop
 * resolving to an internal/reserved address is refused. Redirects ARE followed — public hosts
 * (e.g. GitHub Releases) legitimately 302 to a CDN — but each hop is re-validated, so following them
 * cannot reach an internal target. The byte cap is enforced while streaming (Content-Length may be
 * absent or wrong) so a hostile or oversized response can't exhaust memory.
 *
 * Operators must add a non-public catalog/release host to `SSRF_ALLOWED_HOSTS`; public hosts
 * (github.com, objects.githubusercontent.com, raw.githubusercontent.com) resolve and pass normally.
 */
export async function fetchSafeBuffer(
  url: string,
  opts: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<Buffer> {
  // Coerce a missing/non-finite/non-positive cap to the default: `??` alone would let a NaN through
  // (e.g. a misparsed env value), which makes every `> maxBytes` guard below inert.
  const maxBytes =
    Number.isFinite(opts.maxBytes) && (opts.maxBytes as number) > 0 ? (opts.maxBytes as number) : DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return withSafeFetch(
    url,
    { signal: AbortSignal.timeout(timeoutMs) },
    async response => {
      if (!response.ok) {
        throw new Error(`download failed with status ${response.status}`);
      }

      const declaredLength = Number(response.headers.get('content-length') ?? '');
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new Error(`download exceeds the ${maxBytes}-byte limit`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('download response has no body');
      }

      const chunks: Buffer[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = (await reader.read()) as { done: boolean; value: Uint8Array };
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error(`download exceeds the ${maxBytes}-byte limit`);
        }
        chunks.push(Buffer.from(value));
      }

      return Buffer.concat(chunks);
    },
    { followRedirects: true },
  );
}
