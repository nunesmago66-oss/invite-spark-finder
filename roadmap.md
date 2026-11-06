# Meaning-based discovery
- [x] Add multilingual dictionary and phonetic generation with ranking and tests.
- [x] Add independent meaning-search settings, suggestions and results using existing verification.
- [x] Verify mobile search, expansion, pause/resume, CSV, persistence, simulated 429 and automated error/batch rules. Actual iPhone Safari remains unverified; Chromium mobile and desktop checked.

# Safe persistence and cross-tab scanning
- [x] Add versioned validation, non-destructive recovery, visible save errors, retry and backup.
- [x] Add cross-tab exclusive execution with Web Locks and a fail-closed fallback.
- [x] Test old data, corruption, quota failures, two tabs, pause and HTTP 429 (simulated); do not publish.

# Remix audit (2026-11-06)
- [x] Typecheck, build log and 42 unit tests pass.
- [x] Browser audit: quota warning/retry, recovery sidecar, cross-tab lock, simulated 429 cooldown, both scan modes, favorites, CSV, persistence after reload.
- [ ] Real iPhone Safari and a real Discord 429 remain unverified (Chromium mobile emulation used).

# Responsive layout (2026-11-06)
- [x] Wider container on desktop; two-column Scanner and meaning mode; grid lists in Results/Catalog/Suggestions; mobile stays compact.
- [x] Verified zero horizontal overflow and zero page errors at 390px, 768px and 1440px on all tabs; 42/42 tests and typecheck pass; not published.
