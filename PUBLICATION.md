# Publication record

- Test start: 2026-10-20, America/Toronto.
- Source: final four-round Tank Battle sharing snapshot.
- Gameplay source is byte-for-byte identical to the final experiment workspace (hashes in `source-checksums.json`).
- Publishing changes: GitHub Pages workflow, README links, optional `CHROMIUM_PATH` and `BASE_URL` in browser tests.
- Historical performance and play results remain in REPORT.zh-CN.md and evidence/.
- This publication did not rerun the LLM or generate a new performance sample.

## Publishing checks (2026-10-20)

- `npm ci --ignore-scripts`, `npm run build -- --base=./`: passed.
- `node tests/r3-maze-check.mjs`: passed.
- Chromium on the publishing checkout at an isolated port: r3-smoke, r3-flow, r4-layout passed, including four viewport sizes.
- These checks validate packaging and regressions, not a new model run. Historical natural-play results remain in the experiment report; natural play was not rerun during publication.
