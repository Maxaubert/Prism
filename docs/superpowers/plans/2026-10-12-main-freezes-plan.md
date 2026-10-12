# The 3 to 10 s main-process freezes with nothing in flight: plan

Owner, 2026-10-12 ("handle this, create a plan then go ahead"). After #365 the e2e stall reports
still show main-process lags of 2.7 to 10 s whose in-flight list holds only finished, fast IPC
(`extractWindow` 10060 ms, `toolbarIcons` 8191 ms, `markTint` 2692 ms, `sidebarGround`
3894 ms), so the cause is not a disk call. The owner's own log has 35 lags over 1 s.

## Step 1: catch it in the act

The cause is unknown, so the first change is a recorder, not a guess. `src/main/lagProfiler.ts`:
when diagnostics are on (always in the e2e build; behind the existing verbose switch otherwise)
main runs the V8 sampling profiler from its own `node:inspector` session in a ring of short
windows (start, and every 5 s stop and restart, keeping the last two). The existing main-lag
detector, on a lag of 1 s or more, saves the windows covering it as
`logs/lag-<time>.cpuprofile` and names the file in the diagnostics line. Cost: sampling at 1 ms
is a few percent of a core; off in normal use unless verbose is on.

## Step 2: reproduce

Run the scenarios that showed it (`extractWindow`, `toolbarIcons`, `markTint`, `sidebarGround`,
then the full suite), collect the profiles, and read each with the same analysis used for the
tabs.json stall (the longest busy stretch, its self time and stacks).

## Step 3: fix what they show

Each distinct cause gets the smallest fix that keeps main free (move work off main, defer it, or
stop doing it), a unit or e2e check that holds it, and a `docs/features.md` line. If a cause is
outside Prism's code (Chromium, DWM, the OS), say so with the evidence and mitigate where
possible (for example, defer it off the startup path).

## Proof

The stall report of a full e2e run before and after, scenario by scenario.
