# Records overlay benchmarks

## Browser Canvas/WebGL benchmark

Install the matching Chromium build once with `npx playwright install chromium`,
then run `npm run benchmark:canvas`. The script starts a local Vite page, opens
headless Chromium using the repository-pinned PixiJS version, and prints a JSON
result for the agent to read. It uses the production cell/circle mesh builders
and GLSL shaders with a deterministic 96-cell, 1,152-marker, 768-label scene;
Google Maps, Wayfarer, and Tampermonkey are not involved.

The report separates scene setup, CPU render submission, and render-plus-
`gl.finish()` timings, and includes browser/WebGL identity and canvas dimensions.
It hashes the decoded pixels of two repeated PNG snapshots outside the timed
section and fails if their SHA-256 values differ or the image is fully
transparent. Compare runs using the same browser, machine, and GPU backend.
Headless Chromium may use SwiftShader, so these numbers measure a repeatable
test renderer, not necessarily a user's hardware GPU.

The benchmark also compares the main-thread presentation paths used by
`overlay-view.ts`: clearing and drawing the `ImageBitmap` into a 2D canvas
versus drawing it with `globalCompositeOperation = "copy"`. It reports each
path's CPU time and verifies the resulting pixels match and are non-transparent.

This benchmark covers mesh creation and rendering for a fixed synthetic scene.
It does not cover IndexedDB reads, Google Maps projection, Worker messaging, or
the end-to-end main-thread commit scheduling.

## Collision-check CPU benchmark

Run `npm run benchmark` to compare the label-collision pass used by
`updateContainers` with a straightforward all-visible-labels scan. The benchmark
uses the real `createCollisionChecker` implementation and a deterministic set
of 4,096 synthetic label bounds; it does not need a browser.

The command first runs both algorithms on the same ordered input and stops if
their visible-label results differ. Vitest then reports operations per second
and latency statistics for each implementation. Results are printed in the
command output for the agent to read. Run on an otherwise idle machine and
compare results from the same Node version and hardware.

This isolates collision checking from text measurement, database reads, and
GPU rendering.
