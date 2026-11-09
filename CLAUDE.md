# @sudobility/music_synth (web soundfont synth)

> **Git policy — never auto-commit or auto-push.** Leave work in the working
> tree. Commit/push only when the user explicitly asks in that turn.

The web soundfont synthesizer for ScoreSmith: **libfluidsynth compiled to
WebAssembly, run inside an `AudioWorklet`**, exposed as a `SynthBackend`. The
concrete synth `@sudobility/music_player`'s scheduler drives on the web — the
mirror of `music_synth_rn`'s native module.

## The boundary

**This package implements a contract; it does not own one, and it never depends
on `music_player`.** The scheduler (`SoundfontPlaybackEngine`, in music_player)
*consumes* a `SynthBackend`; this package *supplies* one. The contract
(`SynthBackend`, `ScheduledClick`, `PrepareResult`) and the shared pure voicing
helpers (`channel-allocator`, `mix`/limiter, `instrument-gain`) live in
`@sudobility/music_types`, which both depend on.

```
music_types ◄── music_synth      (this package)
music_types ◄── music_player     (the scheduler + engine)
app composes:  SoundfontPlaybackEngine({ backend: createWebSynthBackend(...) })
```

An app wires the two together (a thin `createWebMusicPlayer` helper); neither
library reaches for the other.

## Commands

- `bun install` — deps (then overlay a local `@sudobility/music_types` build if
  working across repos; `bun install` reinstalls it from the registry).
- `bun run verify` — format, typecheck, lint, test, build. Before any push.
- `bun run test` / `test:watch` — vitest (node env; Web Audio stubbed per suite).

## Public surface (`src/index.ts`)

- `createWebSynthBackend({ soundfont })` → a `WebSynthBackend` (also carries
  `setAudioOutputDevice`/`getAudioOutputDeviceId` for an output picker).
- `renderSamples(soundfont)` → `(plan) => Promise<DecodedAudio>`: offline render
  through the *same* soundfont as playback (pair with music_player's
  `renderEvents`). An export is a recording of what was heard.
- `WebSynthBackend`, `SynthHost`, `createWorkletSynth`, `loadSoundfont`,
  `createSoundfontRenderer`, `SoundfontAssets` for advanced use.

`SoundfontAssets` carries the hosted URLs (`fluidsynthModuleUrl` — the
**`-with-libsndfile`** build; the plain one cannot read SF3 — `workletModuleUrl`,
`fontUrl`), passed in, not resolved here: a library cannot assume how a consuming
app serves files out of `node_modules`.

## Layout

- `src/playback/` — `web-backend.ts` (the `SynthBackend`), `synth-host.ts`
  (worklet-hosted js-synthesizer), `soundfont-loader.ts` (uses browser `caches`),
  `click.ts`, `quiet-stub-notices.ts`.
- `src/audio/` — `offline-synth.ts`, `soundfont-render.ts`, `synth-types.ts`
  (faster-than-realtime export).

## Gotchas

- **Consumers must exclude this package from Vite's dep pre-bundling.** It lazily
  `import('js-synthesizer')`, and esbuild's pre-bundler resolves that eagerly into
  a chunk whose worklet asset URLs no longer point where the app serves them — a
  blank page, no console error, while `bun run build` succeeds. `music_app` lists
  it in `optimizeDeps.exclude`.
- **One synth instance addresses 256 channels, not 16.** `midiChannelCount` takes
  16–256 in multiples of 16, so up to 240 pitched tracks run on one instance with
  one copy of the 23MB font; a second instance (and font copy) opens past 240.
  Channels where `c % 16 === 9` are reserved for percussion.
- **Polyphony is init-time only.** `ISynthesizer` has no polyphony setter, so the
  ceiling (2048) is chosen once in `synth-host.ts`; adapting it means re-initing
  the synth, which means reloading the font.
- **Timing lives in the worklet.** The scheduler hands a rolling multi-second
  horizon of **self-releasing** notes to fluidsynth's sequencer — each carries its
  own duration and fluidsynth releases it on the audio thread; no skip-late rule.
- **The offline renderer shares `allocateChannels` and the export limiter (`mix`)
  with playback.** The limiter computes its gain envelope **backwards** so the
  ceiling is exact. Change the channel count and `audio/offline-synth.ts` moves in
  the same commit, or an export addresses channels its synth lacks and loses tracks.

## Related

`music_types` · `music_player` · `music_synth_rn` · `music_app` ·
`music_app_rn` · `music_player_app_rn`
