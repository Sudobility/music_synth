/**
 * `WebSynthBackend`'s own bring-up rules — the web-specific half that used to
 * be exercised through the scheduler's tests in `music_player`, and moved here
 * with the backend. The scheduler's handling of what `prepare` returns (defer,
 * fail, retry) is tested there against a fake; this tests that the *web backend*
 * produces those results: a suspended `AudioContext` defers until a gesture
 * resumes it, and a running one reports fetch progress before it comes up.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PlaybackLoadState } from '@sudobility/music_types';
import { WebSynthBackend } from './web-backend.js';
import type { SynthHostLike } from './web-backend.js';

function backendWith(
  context: AudioContext,
  loadFont: (
    url: string,
    onProgress?: (p: { loaded: number; total: number }) => void
  ) => Promise<ArrayBuffer> = async () => new ArrayBuffer(1)
) {
  const host = {
    init: vi.fn(async () => {}),
    activateAudio: vi.fn(),
  } as unknown as SynthHostLike;
  const backend = new WebSynthBackend({
    host,
    moduleUrls: { fluidsynth: 'f.js', worklet: 'w.js' },
    fontUrl: 'font.sf3',
    loadFont,
    createContext: () => context,
  });
  return { backend, host };
}

describe('WebSynthBackend bring-up', () => {
  it('defers on a suspended context, reporting ready so Play is offered', async () => {
    // A suspended context never runs its AudioWorklet, where the soundfont is
    // decoded, so a decode there hangs forever. The backend defers instead: it
    // does not touch the host, and reports `ready` so the UI shows a usable Play.
    const context = {
      state: 'suspended',
      currentTime: 0,
      resume: vi.fn(async () => {}), // no gesture: resume leaves it suspended
    } as unknown as AudioContext;
    const { backend, host } = backendWith(context);

    const loads: string[] = [];
    const result = await backend.prepare({
      instanceCount: 1,
      onProgress: s => loads.push(s.status),
    });

    expect(result).toBe('deferred');
    expect(host.init).not.toHaveBeenCalled();
    expect(loads.at(-1)).toBe('ready');
  });

  it('comes up on the next prepare once a gesture has resumed the context', async () => {
    // `play()`/`noteOn()` are gestures; they call `activateAudio`, which is what
    // makes resuming allowed. The deferral must not be cached — the next attempt
    // brings the synth up for real.
    let gestured = false;
    const context = {
      state: 'suspended',
      currentTime: 0,
      resume: vi.fn(async () => {
        if (gestured) (context as { state: string }).state = 'running';
      }),
    } as unknown as AudioContext & { state: string };
    const { backend, host } = backendWith(context);

    expect(
      await backend.prepare({ instanceCount: 1, onProgress: () => {} })
    ).toBe('deferred');
    expect(host.init).not.toHaveBeenCalled();

    gestured = true;
    backend.activateAudio();
    expect(
      await backend.prepare({ instanceCount: 1, onProgress: () => {} })
    ).toBe('ready');
    expect(host.init).toHaveBeenCalled();
  });

  it('reports fetch progress, then indeterminate, then ready', async () => {
    // The fetch is the measurable half; handing the font to fluidsynth reports
    // nothing, so a completed download reads as half done, then indeterminate.
    const context = { currentTime: 0 } as unknown as AudioContext; // no state → runnable
    const { backend } = backendWith(context, async (_url, onProgress) => {
      onProgress?.({ loaded: 50, total: 100 });
      onProgress?.({ loaded: 100, total: 100 });
      return new ArrayBuffer(1);
    });

    const seen: PlaybackLoadState[] = [];
    const result = await backend.prepare({
      instanceCount: 1,
      onProgress: s => seen.push(s),
    });

    expect(result).toBe('ready');
    const fractions = seen
      .filter(s => s.status === 'loading')
      .map(s => s.fraction);
    expect(fractions).toEqual([0, 0.25, 0.5, null]);
  });
});
