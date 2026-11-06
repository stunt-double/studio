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
  runs/<stamp>-<checklist>/ run.json, activity.jsonl, shots/<check>.png, steps/<n>.jpg
  interviews/<slug>.json    name, actor, url, research_brief, usability_scale, sections of questions and tasks
  interview-runs/<stamp>-<interview>/ interview.json, activity.jsonl, steps/<n>.jpg
  .live/                    the viewer's address and key, Studio's address and key (studio.json), the latest frame, the stop flag
```

Actors and checklists use the same fields, and the same limits, as the Stunt Double MCP server's `create_actor` and `create_checklist`, so the same files run in the cloud. The exception is `browser_config` (a preset, viewport, touch or locale), which the cloud inputs do not take yet, so a cloud run uses the default desktop browser. A local run swaps the checklist URL's origin for `local_base_url`, so one checklist covers `localhost` here and the public address there.

A Studio run's `run.json` says which model it ran on: `runner` gains `model` (`{"provider": "anthropic", "id": "claude-opus-5-5"}`) and, once it finishes, `usage` (`steps`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cost_usd`). Both are optional, so older files read as before.

`activity.jsonl` has a line per tool call (`at`, `tool`, `input`, `text`). Since `run.json` revision 2, a browser step's line also has:

- `ms`: how long the step took.
- `page`: the page's `url` (without its query or fragment, which can carry a sign-in code) and `title` after the step.
- `waits`: each time the step waited on the page, as `{"kind": "navigation" | "load", "ms": 812}`. Fixed pauses (the `wait` tool, the settle after an action) are left out, so the longest wait is the product's.
- `shot`: for a step that moves the page, a small JPEG of the viewport, `steps/0001.jpg` and on. Steps that only read the page (`read_page`, `find`, `get_page_text`, `screenshot`) and steps that type (`type`, `form_input`) keep none, so a typed value never reaches a committed picture.

Any of these is left out when the browser could not say. `run.json` keeps `"format": "stuntdouble.run/1"` and adds `"revision": 2`, so earlier viewers still read the run; a file with no `revision` is revision 1.

## Interviews

An interview is a guide the actor answers in character, in your own agent's session: `start_interview`, an `answer_item` per item, `rate_usability`, then `finish_interview`.

```json
{
  "name": "First visit",
  "actor": "shopper",
  "url": "https://shop.example.com/",
  "research_brief": "Do first-time visitors trust the checkout?",
  "usability_scale": "umux",
  "sections": [
    {
      "title": "Buying",
      "intro": "Have a look around first.",
      "items": [
        { "type": "task", "prompt": "Find the cheapest mug and add it to your basket." },
        { "prompt": "How confident would you feel paying here?" }
      ]
    }
  ]
}
```

- An item is a `question` (the default) or a `task`, which the actor does in the browser before answering. `expected_evidence` is optional.
- The actor is never shown `research_brief`: it is for you, and knowing what is being looked for would colour the answers.
- `usability_scale` is `umux` (the default, as in the cloud), `umux_lite` or `none`. After the last item the actor rates each statement from 1 (strongly disagree) to 7 (strongly agree) with a reason. The statements and the scoring are the cloud's own (`src/vendor/usability/`): UMUX on its 0 to 100 scale, UMUX-Lite converted to the SUS scale, and a grade on the Sauro-Lewis curve.
- `browser_config` works as on a checklist, and `local_base_url` swaps the origin the same way. The statements still name the product from `url` (its host, as the cloud does), never `localhost`.

A session is written to `interview-runs/<stamp>-<interview>/`, not `runs/`, so viewers that read `runs/` as checklist runs never list it as unreadable. `interview.json` (`"format": "stuntdouble.interview/1"`) holds the guide as it was asked, a `transcript` entry per answer (`section`, `item`, `type`, `prompt`, `answer`, `at`), the `usability` ratings (`scale`, `ratings` of `item`, `rating` and `reason`, `answered_at`) and the `summary`. Only the ratings are stored, as in the cloud: the score is worked out when the file is read, so a scoring fix applies to old sessions too. `activity.jsonl` and `steps/` are as for a run. The viewer serves them at `/api/interview-runs` and `/api/interview-runs/<id>`, each with its score. `finish_interview` always ends the session, as `finish_run` does: `completed` means it finished rather than stopped, and the transcript says how far it got. Answers are self-reported: the actor speaks for itself, with no second judge.

## Scoring

A local run is scored by the same code that scores a cloud run (`src/vendor/scoring/`, vendored from Stunt Double). Local results are self-judged: the actor records its own verdicts. Cloud runs add a second judge.

A checklist with no `weighted` checks has no score: it passes only when every pass/fail check passes, and its `pass_threshold`, which applies to weighted checks only, is not used. `start_run` and `finish_run` say so, and the viewer shows the tally with the same sentence.

## Safety

- Every run gets a fresh Chrome profile, deleted afterwards. An actor with `persist_login` keeps its own profile in `~/.stuntdouble/profiles/<project>/<actor>` (the project as a short hash of its path, so two projects with the same actor name never share cookies), never yours.
- The browser reaches local and private addresses only for the app under test: the exact origins (scheme, host and port) of the checklist's URL and `local_base_url`. The rule holds however the browser gets there, by a link, a script, a popup, a frame or a redirect; a redirect's request is still sent, but the page is cleared before any tool reads it.
- With `safety` at `third_party` (the default), on any other host the tools refuse to pay, subscribe, create an account or type a password or card number. Set it to `off` when your app signs in on another domain.
- The viewer listens on `127.0.0.1` only (port 4747, or the next free one), answers only to its own Host header, needs the key from the printed link (kept as an HttpOnly, SameSite=Strict cookie), sends no CORS headers and serves files from `.stuntdouble/` only. Its one control is Stop.
- Studio is the same server with more on it, and keeps every one of those rules. Each write also needs Studio's own `Origin` and a JSON body. Values from files and replies are shown as text, and only `http(s)` addresses become links. The OAuth callback is the one route without the key: it answers only a sign-in this process started.
