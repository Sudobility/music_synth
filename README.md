# @sudobility/music_synth

Web soundfont synthesizer for ScoreSmith: **libfluidsynth compiled to
WebAssembly, run inside an `AudioWorklet`**, exposed as a `SynthBackend`.

This is the concrete synth that `@sudobility/music_player`'s scheduler drives on
the web — the counterpart of `music_synth_rn`'s native module. It depends only
on `@sudobility/music_types` (for the `SynthBackend` contract and the shared
voicing helpers), never on `music_player`: the scheduler *consumes* a backend,
this package *supplies* one.

```
music_types ◄── music_synth      (this package)
music_types ◄── music_player     (the scheduler + engine)
app composes:  SoundfontPlaybackEngine({ backend: createWebSynthBackend(...) })
```

## Install

Published to GitHub Packages under the `@sudobility` scope. A consumer needs an
`.npmrc` pointing the scope at the GitHub registry:

```
@sudobility:registry=https://npm.pkg.github.com
```

```sh
bun add @sudobility/music_synth
```

Peer dependencies:

- `@sudobility/music_types` (`^0.13.65`) — required (the contract + helpers).
- `js-synthesizer` (`^1.13.0`) — optional; needed only for live playback, which
  lazily `import()`s it. An app that never plays does not pull it in.

## Build / test / run

Uses **Bun** as the package manager and script runner; the build itself is
`tsc`. Node-flavoured, ESM-only (`"type": "module"`).

| Command | What it does |
| --- | --- |
| `bun install` | Install dependencies. |
| `bun run build` | Emit `dist/` via `tsc -p tsconfig.esm.json`. |
| `bun run clean` | Remove `dist/`. |
| `bun run test:unit` | Run the vitest suite once (node env). |
| `bun run test:watch` | Vitest in watch mode. |
| `bun run typecheck` | `tsc --noEmit`. |
| `bun run lint` | ESLint over `src`. |
| `bun run format` / `format:check` | Prettier write / check `src/**/*.ts`. |
| `bun run verify` | format:check → typecheck → lint → test:unit → build. Run before any push. |

There is no `test` script; use `test:unit`.

Tests run under **node, not jsdom** — jsdom does not implement Web Audio, so
`AudioContext`/`AudioWorklet` are stubbed per suite rather than faked globally.

This is a library, not an app: there is no dev server or `start` script. To see
it in a running app, wire it into a consumer (e.g. `music_app`).

## Usage

```ts
import { createWebSynthBackend, renderSamples } from '@sudobility/music_synth';

// Live playback: hand the backend to music_player's SoundfontPlaybackEngine.
const backend = createWebSynthBackend({
  soundfont: {
    // fluidsynth MUST be the `-with-libsndfile` build; the plain one cannot read SF3.
    fluidsynthModuleUrl,
    workletModuleUrl,
    fontUrl,
  },
});
// The returned instance also carries setAudioOutputDevice / getAudioOutputDeviceId
// for an output-device picker.

// Offline export: render a plan to PCM faster than realtime, through the SAME
// soundfont as playback — an export is a recording of what was heard.
const render = renderSamples({ fluidsynthModuleUrl, fontUrl });
const audio = await render(plan); // pair with music_player's renderEvents
```

### Public surface (`src/index.ts`)

- `createWebSynthBackend({ soundfont })` → `WebSynthBackend`.
- `renderSamples(soundfont)` → `(plan: RenderPlan) => Promise<DecodedAudio>`.
- `createWorkletSynth()` — builds one real `AudioWorkletNodeSynthesizer`.
- `WebSynthBackend`, `SynthHost`, `loadSoundfont`, `openSoundfontCache`,
  `createSoundfontRenderer`, and the `SoundfontAssets` type, for advanced use.

The asset URLs (`fluidsynthModuleUrl`, `workletModuleUrl`, `fontUrl`) are passed
in, not resolved here: a library cannot assume how a consuming app serves files
out of `node_modules`.

## Layout

- `src/playback/` — `web-backend.ts` (the `SynthBackend`), `synth-host.ts`
  (worklet-hosted js-synthesizer, the one module that talks to it),
  `soundfont-loader.ts` (Cache-API-backed fetch), `click.ts`,
  `quiet-stub-notices.ts`.
- `src/audio/` — `offline-synth.ts`, `soundfont-render.ts`, `synth-types.ts`
  (faster-than-realtime export; shares channel allocation and the limiter with
  playback).

## Gotchas

- **Consumers must exclude this package from Vite's dep pre-bundling**
  (`optimizeDeps.exclude`). It lazily `import('js-synthesizer')`, and esbuild's
  pre-bundler resolves that eagerly into a chunk whose worklet asset URLs no
  longer point where the app serves them — a blank page, no console error, while
  `bun run build` still succeeds.
- The `AudioContext` starts **suspended** unless created during a user gesture;
  that is why `prepare` answers `deferred` instead of throwing.

## License

BUSL-1.1 © Sudobility
