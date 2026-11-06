/**
 * Fetches the soundfont once and keeps it in the Cache API.
 *
 * The font is tens of megabytes even as SF3, so this is the difference between
 * a wait on every visit and a wait on the first. `cache` is injected rather
 * than reached for globally, so tests need no real CacheStorage and a caller
 * without one still works — just without the caching.
 *
 * A failed fetch throws. Resolving an empty buffer would load a synth with no
 * instruments, which presents as silent playback with no error anywhere — the
 * exact failure this whole engine exists to stop happening.
 */
export type LoadProgress = { loaded: number; total: number };

/** Bumped when the stored representation changes, so old entries are not reused. */
const CACHE_NAME = 'music-soundfont-v1';

/** Shared with the web backend's `[ScoreSmith audio]` logs so one filter shows the whole load. */
const SOUNDFONT_LOG = '[ScoreSmith audio]';

/** Monotonic clock for load timings, falling back where `performance` is absent. */
function soundfontNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * The cache the soundfont lives in, or `null` where the Cache API is missing.
 *
 * Worth its own function because forgetting it is expensive and silent: without
 * a cache the font is refetched and re-decoded on every engine init and every
 * export — tens of megabytes and seconds of work each time, with nothing
 * visibly wrong.
 */
export async function openSoundfontCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') {
    // The Cache API only exists in a secure context (https or localhost). A LAN
    // IP or plain http silently lands here, and every visit re-downloads.
    console.info(
      SOUNDFONT_LOG,
      'Cache API unavailable (insecure context?); soundfont will not be cached'
    );
    return null;
  }
  try {
    return await caches.open(CACHE_NAME);
  } catch (error) {
    console.warn(
      SOUNDFONT_LOG,
      'opening soundfont cache failed; continuing without cache',
      error
    );
    return null; // private browsing and similar; the font still loads
  }
}

export async function loadSoundfont(
  url: string,
  opts: {
    onProgress?: (progress: LoadProgress) => void;
    cache?: Cache | null;
  } = {}
): Promise<ArrayBuffer> {
  const cached = await opts.cache?.match(url);
  if (cached) {
    const buffer = await cached.arrayBuffer();
    console.info(SOUNDFONT_LOG, 'soundfont cache HIT', {
      url,
      bytes: buffer.byteLength,
    });
    return buffer;
  }
  console.info(SOUNDFONT_LOG, 'soundfont cache MISS; downloading', {
    url,
    cacheAvailable: Boolean(opts.cache),
  });

  const started = soundfontNow();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Soundfont fetch failed: ${response.status} ${response.statusText} (${url})`
    );
  }

  const declared = Number(response.headers.get('content-length') ?? 0);
  opts.onProgress?.({ loaded: 0, total: declared });

  const buffer = await readWithProgress(response, declared, opts.onProgress);
  console.info(SOUNDFONT_LOG, 'soundfont downloaded', {
    url,
    bytes: buffer.byteLength,
    downloadMs: Math.round(soundfontNow() - started),
    cacheControl: response.headers.get('cache-control'),
  });
  // Rebuilt rather than cloned: the body has already been consumed to report
  // progress, and a body can only be read once. A cache write that fails (quota,
  // private mode) must not fail the load — it just means no caching this time.
  try {
    await opts.cache?.put(
      url,
      new Response(buffer, { headers: response.headers })
    );
    if (opts.cache) {
      console.info(SOUNDFONT_LOG, 'soundfont stored in cache', {
        url,
        bytes: buffer.byteLength,
      });
    }
  } catch (error) {
    console.warn(SOUNDFONT_LOG, 'storing soundfont in cache failed', error);
  }

  opts.onProgress?.({
    loaded: buffer.byteLength,
    total: declared || buffer.byteLength,
  });
  return buffer;
}

/**
 * Reads the body a chunk at a time so progress is real.
 *
 * `arrayBuffer()` resolves once, at the end, which over a slow connection is
 * tens of megabytes of silence followed by a jump to 100% — a progress bar that
 * only ever shows nothing or everything. Falls back to it where the body cannot
 * be streamed, which costs only the granularity.
 */
async function readWithProgress(
  response: Response,
  declared: number,
  onProgress?: (progress: LoadProgress) => void
): Promise<ArrayBuffer> {
  const reader = response.body?.getReader();
  if (!reader) return await response.arrayBuffer();

  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.({ loaded, total: declared || loaded });
  }

  const buffer = new Uint8Array(loaded);
  let at = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, at);
    at += chunk.byteLength;
  }
  return buffer.buffer;
}
