---
'stuntdouble': minor
---

Each browser step in a run's `activity.jsonl` now records the page's address (without its query) and title after the step, how long the page kept it waiting (navigations and load states, not fixed pauses), and, for a step that moves the page without typing, a small picture under `steps/`. `run.json` gains `"revision": 2` and keeps its format, so earlier viewers still read it.
