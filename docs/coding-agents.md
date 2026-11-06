# From your coding agent

The same package is an MCP server. Your coding agent starts it, and the agent's own session plays the actor: the server never calls a model. Back to the [README](../README.md).

```sh
npx stuntdouble mcp          # the MCP server over stdio; your agent starts this
npx stuntdouble view [dir]   # the viewer over a project's .stuntdouble/, no agent needed
npx stuntdouble doctor       # Node, Chrome, the viewer port, the project, and how local runs are billed
```

## Set it up

```sh
# Claude Code: the plugin starts the server for you
claude plugin marketplace add stunt-double/stuntdouble-mcp
claude plugin install stuntdouble@stuntdouble
# then, in Claude Code: /stuntdouble setup, and /stuntdouble run <checklist>

# Codex (the same as this block in ~/.codex/config.toml: [mcp_servers.stuntdouble],
# command = "npx", args = ["-y", "stuntdouble", "mcp"], env = { STUNTDOUBLE_PROJECT_DIR = "..." })
codex mcp add stuntdouble --env STUNTDOUBLE_PROJECT_DIR=/path/to/project -- npx -y stuntdouble mcp

# Any other MCP client
STUNTDOUBLE_PROJECT_DIR=/path/to/project npx -y stuntdouble mcp
```

`STUNTDOUBLE_PROJECT_DIR` is the project folder; without it, the server uses the current directory.

## Studio and your agent together

> Coming in the next release (the changesets are on `main`).

While Studio is open for a project, `start_run`, `finish_run` and `open_ui` link Studio's own run page instead of starting a second viewer on another port. Studio records its address in `.stuntdouble/.live/studio.json` (mode 0600, like `server.json`) and removes it on exit; the MCP server uses it only if that process is alive and its port answers as the same project.

Your coding agent connects to Studio as an MCP client; Studio never starts it, never reads its sign-in and never uses its plan. Settings, Agents shows each one as Connected (with its version) or Not connected, with the setup to copy.

On `initialize` the server reads the client's name and version and writes `.stuntdouble/.live/agents/<pid>.json` (never committed), removing it on exit; Studio ignores an entry whose process has died. `claude-code` shows as Claude Code, `codex-mcp-client` as Codex, and anything else as `MCP client <name>`.

To hand a run to a connected agent, pick **In Claude Code** or **In Codex** when running a checklist. Studio shows a prompt to paste (`/stuntdouble run <checklist>` for Claude Code; a short prompt naming `start_run`, `evaluate_check` and `finish_run` for Codex), then opens the run live when it appears. A run an agent starts records it as `runner.client` (`{ name, version }`) in `run.json`, and the runs list and run page say "Claude Code", "Codex", `Local, <model>` or "Cloud".

## Tools

| Tool                                                                                                           | What it does                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navigate`, `read_page`, `find`, `get_page_text`, `click`, `type`, `form_input`, `key`, `scroll`, `screenshot` | The direct tools from [`@stuntkit/browser-toolset`](https://github.com/stunt-double/stuntkit/tree/main/packages/browser-toolset). Screenshots go back to the model only from `screenshot`, unless `model_screenshots` is `every_action`. |
| `start_run`                                                                                                    | Validates the files (naming every field to fix), opens a fresh Chrome at the checklist's URL and returns the viewer link, the actor's brief and the checks. `resume` continues an interrupted run, or one still open in this session.    |
| `evaluate_check`                                                                                               | Records one verdict. A pass must cite text or a selector that is on the page now. Scrolls the evidence into view and saves `shots/<check>.png`.                                                                                          |
| `finish_run`                                                                                                   | Settles the checks left, scores the run and closes the browser.                                                                                                                                                                          |
| `start_interview`                                                                                              | Validates `interviews/<slug>.json`, opens a fresh Chrome at its URL and returns the actor's brief and the first item. `resume` continues an interrupted or stopped session, or one still open in this session.                           |
| `answer_item`                                                                                                  | Records the actor's answer to the current item, in character, and returns the next item, or the usability statements after the last.                                                                                                     |
| `rate_usability`                                                                                               | Records a 1 to 7 rating and a reason for each UMUX (or UMUX-Lite) statement, once every item has an answer, and returns the score.                                                                                                       |
| `finish_interview`                                                                                             | Writes the session, closes the browser and returns the usability score.                                                                                                                                                                  |
| `open_ui`                                                                                                      | The viewer's link, and a line on each of the five latest runs (checklist, status, outcome, checks passed and when it started) and interviews (items answered and the usability score).                                                   |
| `doctor`                                                                                                       | Read only. The same lines as `npx stuntdouble doctor`, one per check (`ok`, `FAIL`, `note` or `--`), so an agent can run it without a shell. While the viewer runs, it reports the viewer's port rather than probing 4747.               |
