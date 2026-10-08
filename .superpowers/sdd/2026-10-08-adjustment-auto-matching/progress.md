# SDD ledger — plan: docs/superpowers/plans/2026-10-08-adjustment-auto-matching.md

Pre-flight: Tasks share matcher output consumed by adjustment settlement; matching function will expose the result contract named in Task 1 before settlement integration in Task 3.
Ruling: Work from origin/main 4bd8750, not the local main snapshot — origin/main contains 23 additional production changes; local main is non-fast-forward and must not be pushed.
Baseline: `npm test` on origin/main 4bd8750 — 85 tests passed, 0 failed; existing test output includes expected Vue directive warnings and a logged simulated settlement error.
Ruling: Corrected the approved algorithm detail to student-proposing deferred acceptance: a held student can be displaced to a lower next choice, but cannot later move to a higher choice already passed. This implements the user's preference priority consistently; cost if wrong: placement semantics differ from a topic-proposing model.
