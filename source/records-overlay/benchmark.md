# Records overlay CPU benchmark

Run `npm run benchmark` to compare the label-collision pass used by
`updateContainers` with a straightforward all-visible-labels scan. The benchmark
uses the real `createCollisionChecker` implementation and a deterministic set
of 4,096 synthetic label bounds; it does not need Google Maps, a browser, or
Wayfarer.

The command first runs both algorithms on the same ordered input and stops if
their visible-label results differ. Vitest then reports operations per second
and latency statistics for each implementation. Results are printed in the
command output for the agent to read. Run on an otherwise idle machine and
compare results from the same Node version and hardware.

This isolates collision checking from text measurement, database reads, and
GPU rendering. It is intended to provide a repeatable CPU benchmark for one
real rendering stage, not a measurement of total map frame time.
