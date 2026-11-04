# Files, scoring and safety

Back to the [README](../README.md).

## Files

Everything lives in `.stuntdouble/` in your project, and everything but `.live/` is meant to be committed:

```
.stuntdouble/
  stuntdouble.json          {"format": "stuntdouble/1", "local_base_url": "http://localhost:3000", "headless": false,
                             "model_screenshots": "on_request", "safety": "third_party"}
  actors/<slug>.json        name, description, system_prompt, knowledge, persist_login
  checklists/<slug>.json    name, actor, url, instructions, checks (each with a stable key), pass_threshold, ...
  runs/<stamp>-<checklist>/ run.json, activity.jsonl, shots/<check>.png
  .live/                    the viewer's address and key, Studio's address and key (studio.json), the latest frame, the stop flag
```

Actors and checklists use the same fields, and the same limits, as the Stunt Double MCP server's `create_actor` and `create_checklist`, so the same files run in the cloud. The exception is `browser_config` (a preset, viewport, touch or locale), which the cloud inputs do not take yet, so a cloud run uses the default desktop browser. A local run swaps the checklist URL's origin for `local_base_url`, so one checklist covers `localhost` here and the public address there.

A Studio run's `run.json` says which model it ran on: `runner` gains `model` (`{"provider": "anthropic", "id": "claude-opus-5-5"}`) and, once it finishes, `usage` (`steps`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cost_usd`). Both are optional, so older files read as before.

## Scoring

A local run is scored by the same code that scores a cloud run (`src/vendor/scoring/`, vendored from Stunt Double). Local results are self-judged: the actor records its own verdicts. Cloud runs add a second judge.

A checklist with no `weighted` checks has no score: it passes only when every pass/fail check passes, and its `pass_threshold`, which applies to weighted checks only, is not used. `start_run` and `finish_run` say so, and the viewer shows the tally with the same sentence.

## Safety

- Every run gets a fresh Chrome profile, deleted afterwards. An actor with `persist_login` keeps its own profile in `~/.stuntdouble/profiles/<project>/<actor>` (the project as a short hash of its path, so two projects with the same actor name never share cookies), never yours.
- The browser reaches local and private addresses only for the app under test: the exact origins (scheme, host and port) of the checklist's URL and `local_base_url`. The rule holds however the browser gets there, by a link, a script, a popup, a frame or a redirect; a redirect's request is still sent, but the page is cleared before any tool reads it.
- With `safety` at `third_party` (the default), on any other host the tools refuse to pay, subscribe, create an account or type a password or card number. Set it to `off` when your app signs in on another domain.
- The viewer listens on `127.0.0.1` only (port 4747, or the next free one), answers only to its own Host header, needs the key from the printed link (kept as an HttpOnly, SameSite=Strict cookie), sends no CORS headers and serves files from `.stuntdouble/` only. Its one control is Stop.
- Studio is the same server with more on it, and keeps every one of those rules. Each write also needs Studio's own `Origin` and a JSON body. Values from files and replies are shown as text, and only `http(s)` addresses become links. The OAuth callback is the one route without the key: it answers only a sign-in this process started.
