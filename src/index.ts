/**
 * `@sudobility/music_synth` — the web soundfont synth: libfluidsynth compiled
 * to WebAssembly, run inside an `AudioWorklet`, exposed as a `SynthBackend`.
 *
 * This is the concrete synth `@sudobility/music_player`'s scheduler drives on
 * the web, the counterpart of `music_synth_rn`'s native module. It depends only
 * on `@sudobility/music_types` (for the `SynthBackend` contract and the shared
 * voicing helpers) — never on `music_player`: the scheduler consumes a backend,
 * it does not supply one, so an app composes `SoundfontPlaybackEngine`
 * (music_player) over `createWebSynthBackend()` (here).
 */
import { WebSynthBackend } from './playback/web-backend.js';
import { SynthHost } from './playback/synth-host.js';
import type { SynthInstance } from './playback/synth-host.js';
import {
  loadSoundfont,
  openSoundfontCache,
} from './playback/soundfont-loader.js';
import { createSoundfontRenderer } from './audio/soundfont-render.js';
import type { DecodedAudio, RenderPlan } from '@sudobility/music_types';

export { WebSynthBackend } from './playback/web-backend.js';
export type { SynthHostLike, WebBackendDeps } from './playback/web-backend.js';
export { SynthHost } from './playback/synth-host.js';
export type {
  SynthInstance,
  SynthSequencer,
  SynthSettings,
} from './playback/synth-host.js';
export {
  loadSoundfont,
  openSoundfontCache,
} from './playback/soundfont-loader.js';
export type { LoadProgress } from './playback/soundfont-loader.js';
export { createSoundfontRenderer } from './audio/soundfont-render.js';
export type { SoundfontRendererAssets } from './audio/soundfont-render.js';

/**
 * Where the web synth's assets are served from.
 *
 * Passed in rather than resolved here: this is a library and cannot assume how
 * a consuming app serves files out of `node_modules`. The worklet modules in
 * particular must be reachable as URLs, because `addModule` takes a URL. The
 * fluidsynth module must be the `-with-libsndfile` build; the plain one cannot
 * read SF3.
 */
export type SoundfontAssets = {
  fluidsynthModuleUrl: string;
  workletModuleUrl: string;
  fontUrl: string;
};

/**
 * Builds one real `AudioWorkletNodeSynthesizer`.
 *
 * The only place `js-synthesizer` is constructed, and the import is lazy so an
 * app that never plays anything does not pull it in. Async by design: a
 * synchronous factory would need the module loaded first, and a caller
 * forgetting that step would fail at init with no sound and no obvious cause.
 */
export async function createWorkletSynth(): Promise<SynthInstance> {
  const { AudioWorkletNodeSynthesizer } = await import('js-synthesizer');
  return new AudioWorkletNodeSynthesizer() as unknown as SynthInstance;
}

/**
 * The web `SynthBackend`, built from the hosted assets.
 *
 * Hand it to `music_player`'s `SoundfontPlaybackEngine`. The returned instance
 * also carries `setAudioOutputDevice`/`getAudioOutputDeviceId` for an app that
 * offers an output picker.
 */
export function createWebSynthBackend({
  soundfont,
}: {
  soundfont: SoundfontAssets;
}): WebSynthBackend {
  return new WebSynthBackend({
    host: new SynthHost({ createSynth: createWorkletSynth }),
    moduleUrls: {
      fluidsynth: soundfont.fluidsynthModuleUrl,
      worklet: soundfont.workletModuleUrl,
    },
    fontUrl: soundfont.fontUrl,
  });
}

/**
 * Renders a plan to PCM, faster than realtime, through the same soundfont as
 * playback — so an exported file is a recording of what was heard. The synth
 * *plumbing* differs (offline, no `AudioContext`) but the voicing is shared.
 *
 * Pair with `music_player`'s `renderEvents` to turn a score into a plan; the
 * caller encodes and saves, this package does not touch files.
 */
export function renderSamples(
  soundfont: SoundfontAssets
): (plan: RenderPlan) => Promise<DecodedAudio> {
  return createSoundfontRenderer({
    fluidsynthModuleUrl: soundfont.fluidsynthModuleUrl,
    fontUrl: soundfont.fontUrl,
    loadFont: async url =>
      loadSoundfont(url, { cache: await openSoundfontCache() }),
  });
}
