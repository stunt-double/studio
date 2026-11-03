# Stunt Double Studio

[![npm](https://img.shields.io/npm/v/stuntdouble.svg)](https://www.npmjs.com/package/stuntdouble) [![CI](https://github.com/stunt-double/studio/actions/workflows/ci.yml/badge.svg)](https://github.com/stunt-double/studio/actions/workflows/ci.yml) [![Licence](https://img.shields.io/npm/l/stuntdouble.svg)](./LICENSE)

See your app fail the way a real person would, before anyone else does. Studio puts an AI actor in a Chrome on your machine, sends it through your app with a checklist, and keeps every verdict, screenshot and step as files in your project.

```sh
npx stuntdouble studio
```

Studio opens in your browser. Give it the address to test and it starts you with a first-time visitor and a first checklist to edit. Run the checklist, watch the actor work through it live, stop it whenever you like and read the verdicts. A passed check has to cite something on the page, so every pass comes with its evidence.

- **Your model, your machine.** Runs use a connection you set: an Anthropic API key, or an OpenAI-compatible endpoint such as OpenAI, OpenRouter, Ollama or LM Studio. Your key stays in `~/.stuntdouble/credentials.json`.
- **Files you can commit.** Actors, checklists and runs live in `.stuntdouble/`, in the same format the [Stunt Double](https://stuntdouble.io) cloud reads.
- **The same score as the cloud.** A local run is scored by the code that scores a cloud run, and signed in, the same checklist runs in your Stunt Double workspace too.
- **Inside your coding agent.** The same package is an MCP server, so Claude Code or any MCP client can run a checklist with its own session as the actor.

This repository is the npm package [`stuntdouble`](https://www.npmjs.com/package/stuntdouble). It needs Node 22.18 or later and Google Chrome (or Playwright's Chromium, from `npx playwright install chromium`).

## Two ways in

- **Stunt Double Studio**, a local app: `npx stuntdouble studio` opens it in your browser. Create and edit actors and checklists, run one with an AI actor on your own model connection, watch it live, stop it and review the verdicts. Signed in to Stunt Double, the same checklist also runs in the cloud.
- **Stunt Double Local** inside your coding agent: an MCP server, which the Stunt Double plugin for Claude Code starts for you (`/stuntdouble setup`, then `/stuntdouble run <checklist>`).

Both drive the same browser tools, check that a passed verdict cites something on the page, score the run with the same code as the Stunt Double cloud and write the same files.

**The policy line.** Inside your agent, your agent session is the only model: the MCP server never calls a model, never starts an agent and never reads an agent's credentials. Studio runs use only a connection you configure, an Anthropic API key or an OpenAI-compatible endpoint (OpenAI, OpenRouter, or a local server such as Ollama or LM Studio). Nothing in this package uses a Claude subscription: no claude.ai login, no Claude Code credentials, no `claude` process. `test/no-model.test.ts` fails the build if any of that changes.

## Studio

```sh
npx stuntdouble                      # in a terminal: the same as `studio` in this folder
npx stuntdouble studio [dir]         # open Studio for a project (--port, --no-open)
npx stuntdouble run <checklist>      # run one from the terminal on your connection (--resume, --max-steps)
npx stuntdouble run <checklist> --cloud   # push it and run it in your Stunt Double workspace
npx stuntdouble login                # sign in for cloud runs (--workspace <slug>)
npx stuntdouble logout
```

A project with no `.stuntdouble/` yet starts with one question, the address to test, and gets a first-time visitor and a first checklist to edit. The editors check every field with the same schemas a run reads the files with and show what to fix beside the field.

**Connection.** Set it in Settings: Anthropic (default model `claude-opus-5-5`, or `ANTHROPIC_API_KEY` from the environment) or an OpenAI-compatible endpoint with its model and key (`OPENAI_API_KEY` works too; Ollama and LM Studio on this machine need none). The key is kept in `~/.stuntdouble/credentials.json`, readable by you only, never in the project, never in a log and never sent to the page, which hears only whether a key is set. Test connection makes one short call.

**A Studio run** is the MCP run with a model on your connection in the agent's place: the same brief, browser tools, `evaluate_check` and `finish_run`. It stops at 80 model calls or 3,000,000 tokens (the model is told to finish first), shows calls, tokens and, where the provider reports it or the price is known, the cost so far, and Stop ends it at the next step without another model call. Screenshots reach the model only when it asks for one. On Anthropic the prompt is cached and old page reads are cleared server side; on other endpoints old page reads are trimmed. The viewer's key never goes to the model.

**Cloud runs.** Sign in from Settings or `stuntdouble login`: OAuth with PKCE against the hosted MCP, back to Studio's own `127.0.0.1` address, with the token kept in `~/.stuntdouble/credentials.json`. A cloud run pushes the project, the actor and the checklist to your workspace (reusing the ids already in the files, and writing new ones back), runs it there, checks every 30 seconds and writes the result beside your local runs. The cloud cannot reach `localhost`: give the checklist a public or preview URL and keep the local one in `local_base_url`. Cloud runs are for workspaces on a paid plan and are billed to the workspace; a refusal from Stunt Double comes back as it was written, with the billing link.

## In your agent

```sh
npx stuntdouble mcp          # the MCP server over stdio; your agent starts this
npx stuntdouble view [dir]   # the viewer over a project's .stuntdouble/, no agent needed
npx stuntdouble doctor       # Node, Chrome, the viewer port, the project, and how local runs are billed
```

To add it to another MCP client, run `npx -y stuntdouble mcp` with `STUNTDOUBLE_PROJECT_DIR` set to the project folder (the current directory otherwise).

### Connecting agents

Your coding agent connects to Studio as an MCP client; Studio never starts it, never reads its sign-in and never uses its plan. Settings, Agents shows each one as Connected (with its version) or Not connected, with the setup to copy.

```sh
# Claude Code
claude plugin marketplace add stunt-double/stuntdouble-mcp
claude plugin install stuntdouble@stuntdouble

# Codex (the same as this block in ~/.codex/config.toml: [mcp_servers.stuntdouble],
# command = "npx", args = ["-y", "stuntdouble", "mcp"], env = { STUNTDOUBLE_PROJECT_DIR = "..." })
codex mcp add stuntdouble --env STUNTDOUBLE_PROJECT_DIR=/path/to/project -- npx -y stuntdouble mcp

# Any other MCP client
STUNTDOUBLE_PROJECT_DIR=/path/to/project npx -y stuntdouble mcp
```

On `initialize` the server reads the client's name and version and writes `.stuntdouble/.live/agents/<pid>.json` (never committed), removing it on exit; Studio ignores an entry whose process has died. `claude-code` shows as Claude Code, `codex-mcp-client` as Codex, and anything else as "MCP client <name>".

To hand a run to a connected agent, pick **In Claude Code** or **In Codex** when running a checklist. Studio shows a prompt to paste (`/stuntdouble run <checklist>` for Claude Code; a short prompt naming `start_run`, `evaluate_check` and `finish_run` for Codex), then opens the run live when it appears. A run an agent starts records it as `runner.client` (`{ name, version }`) in `run.json`, and the runs list and run page say "Claude Code", "Codex", "Local, <model>" or "Cloud".

Needs Node 22.18 or later and Google Chrome (or Playwright's Chromium, from `npx playwright install chromium`).

## Tools

| Tool                                                                                                           | What it does                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navigate`, `read_page`, `find`, `get_page_text`, `click`, `type`, `form_input`, `key`, `scroll`, `screenshot` | The direct tools from [`@stuntkit/browser-toolset`](https://github.com/stunt-double/stuntkit/tree/main/packages/browser-toolset). Screenshots go back to the model only from `screenshot`, unless `model_screenshots` is `every_action`. |
| `start_run`                                                                                                    | Validates the files (naming every field to fix), opens a fresh Chrome at the checklist's URL and returns the viewer link, the actor's brief and the checks. `resume` continues an interrupted run, or one still open in this session.    |
| `evaluate_check`                                                                                               | Records one verdict. A pass must cite text or a selector that is on the page now. Scrolls the evidence into view and saves `shots/<check>.png`.                                                                                          |
| `finish_run`                                                                                                   | Settles the checks left, scores the run and closes the browser.                                                                                                                                                                          |
| `open_ui`                                                                                                      | The viewer's link, and a line on each of the five latest runs: checklist, status, outcome, checks passed and when it started.                                                                                                            |
| `doctor`                                                                                                       | Read only. The same lines as `npx stuntdouble doctor`, one per check (`ok`, `FAIL`, `note` or `--`), so an agent can run it without a shell. While the viewer runs, it reports the viewer's port rather than probing 4747.               |

## Files

Everything lives in `.stuntdouble/` in your project, and everything but `.live/` is meant to be committed:

```
.stuntdouble/
  stuntdouble.json          {"format": "stuntdouble/1", "local_base_url": "http://localhost:3000", "headless": false,
                             "model_screenshots": "on_request", "safety": "third_party"}
  actors/<slug>.json        name, description, system_prompt, knowledge, persist_login
  checklists/<slug>.json    name, actor, url, instructions, checks (each with a stable key), pass_threshold, ...
  runs/<stamp>-<checklist>/ run.json, activity.jsonl, shots/<check>.png
  .live/                    the viewer's address and key, the latest frame, the stop flag
```

Actors and checklists use the same fields, and the same limits, as the Stunt Double MCP server's `create_actor` and `create_checklist`, so the same files run in the cloud. The exception is `browser_config` (a preset, viewport, touch or locale), which the cloud inputs do not take yet, so a cloud run uses the default desktop browser. A local run swaps the checklist URL's origin for `local_base_url`, so one checklist covers `localhost` here and the public address there.

Local results are self-judged: the actor records its own verdicts. Cloud runs add a second judge. A Studio run's `run.json` says which model it ran on: `runner` gains `model` (`{"provider": "anthropic", "id": "claude-opus-5-5"}`) and, once it finishes, `usage` (`steps`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cost_usd`). Both are optional, so older files read as before.

A checklist with no `weighted` checks has no score: it passes only when every pass/fail check passes, and its `pass_threshold`, which applies to weighted checks only, is not used. `start_run` and `finish_run` say so, and the viewer shows the tally with the same sentence.

## Safety

- Every run gets a fresh Chrome profile, deleted afterwards. An actor with `persist_login` keeps its own profile in `~/.stuntdouble/profiles/<project>/<actor>` (the project as a short hash of its path, so two projects with the same actor name never share cookies), never yours.
- The browser reaches local and private addresses only for the app under test: the exact origins (scheme, host and port) of the checklist's URL and `local_base_url`. The rule holds however the browser gets there, by a link, a script, a popup, a frame or a redirect; a redirect's request is still sent, but the page is cleared before any tool reads it.
- With `safety` at `third_party` (the default), on any other host the tools refuse to pay, subscribe, create an account or type a password or card number. Set it to `off` when your app signs in on another domain.
- The viewer listens on `127.0.0.1` only (port 4747, or the next free one), answers only to its own Host header, needs the key from the printed link (kept as an HttpOnly, SameSite=Strict cookie), sends no CORS headers and serves files from `.stuntdouble/` only. Its one control is Stop.
- Studio is the same server with more on it, and keeps every one of those rules. Each write also needs Studio's own `Origin` and a JSON body. Values from files and replies are shown as text, and only `http(s)` addresses become links. The OAuth callback is the one route without the key: it answers only a sign-in this process started.

## Contributing

Issues and pull requests are welcome: see [CONTRIBUTING.md](./CONTRIBUTING.md), and report security problems privately as [SECURITY.md](./SECURITY.md) describes.

## Licence

[Apache-2.0](./LICENSE), copyright 2026 Turnout Labs Ltd.
