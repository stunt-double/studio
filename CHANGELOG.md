# stuntdouble

## 0.3.0

### Minor Changes

- [#8](https://github.com/stunt-double/studio/pull/8) [`d3d0854`](https://github.com/stunt-double/studio/commit/d3d0854e346a799ae9521bbe8d1d2a3528bec3eb) Thanks [@mrprkr](https://github.com/mrprkr)! - Studio works with coding agents. Claude Code and Codex connect as MCP clients and Settings, Agents shows which are connected, with the one-time setup to copy for each. A checklist can be run in Claude Code or Codex from the run picker: Studio shows the prompt to paste and opens the run when it appears.
  
  - The MCP server records the client's name and version on `initialize` under `.stuntdouble/.live/agents/` and removes it on exit.
  - `run.json`'s `runner` gains an optional `client` (`{ name, version }`), and the runs list and run page show Claude Code, Codex, Local or Cloud.
  - Studio still never starts an agent, never reads its sign-in and never uses its plan.

- [#9](https://github.com/stunt-double/studio/pull/9) [`43297ca`](https://github.com/stunt-double/studio/commit/43297ca9f9db1b1c152bd62870fbe40441d8e8cb) Thanks [@mrprkr](https://github.com/mrprkr)! - Studio sets up a new project for you, and Claude Code and Studio share one viewer.
  
  - A folder with no `.stuntdouble/` opens a guided setup on one page. It finds your dev server from `package.json` (the `dev`, `start` or `preview` script, a port flag, or the framework's default port) and checks that it answers, finds your pages from the project's files, then drafts an actor and two to four checklists. With a model connection, one call drafts them from your routes, README and one line about the user, checked against the same schemas as a run and retried once if invalid, with the cost shown when known. Without one, templates for the pages you have. Every file is shown, and editable, before it is written, and Studio writes only inside `.stuntdouble/`. It shows the two lines to add to `CLAUDE.md` and `.claude/settings.local.json` instead of editing them. The setup also offers the prompt to paste into Claude Code or Codex, and ends by offering a first run.
  - While Studio is open for a project, `start_run`, `finish_run` and `open_ui` in Claude Code link Studio's run page instead of starting a second viewer on another port. Studio records itself in `.stuntdouble/.live/studio.json` (mode 0600, like `server.json`) and removes it on exit. The MCP server uses it only when its process is alive and its port answers as the same project, and otherwise starts its own viewer as before. The `/__stuntdouble` probe now also returns a short hash identifying the project.
  - Studio's live updates now start once `.stuntdouble/` appears, so a run begun straight after setup updates in the page without a reload.

- [#11](https://github.com/stunt-double/studio/pull/11) [`bedc208`](https://github.com/stunt-double/studio/commit/bedc208d540a7ad3da7e580f02af856409293fea) Thanks [@mrprkr](https://github.com/mrprkr)! - The viewer Claude Code opens is now Stunt Double Studio, and it runs things for you instead of handing you commands to copy.
  
  - Run again (or Resume) in Claude Code sends the checklist to the session that opened Studio as a Claude Code channel event, then opens the run when it starts. When the session was not started with the Stunt Double channel on, Studio says so and offers the command to paste.
  - Sign in to Stunt Double from the viewer, choose a workspace, and Run in the cloud pushes the checklist and its actor and starts a cloud run, which lands beside the local ones. The note under the buttons says what the cloud run does and what it uploads.
  - The sign-in is the one Studio keeps in `~/.stuntdouble/credentials.json`. The MCP server may now reach that sign-in, but still never a model client or a model key (`test/no-model.test.ts`).

## 0.2.0

### Minor Changes

- [`8e987b9`](https://github.com/stunt-double/studio/commit/8e987b9030e1c8f93ffa1189bc613aa948a44d27) Thanks [@mrprkr](https://github.com/mrprkr)! - Stunt Double Studio: `npx stuntdouble studio` opens a local app for a project. Create and edit actors and checklists in forms checked by the same schemas a run reads them with, run a checklist with an AI actor in a local Chrome, watch it live, stop it and review the verdicts.
  
  - Studio runs use only a connection you configure: an Anthropic API key, or an OpenAI-compatible endpoint such as OpenAI, OpenRouter, Ollama or LM Studio. Never a Claude subscription. Keys stay in `~/.stuntdouble/credentials.json` (mode 0600) and never reach the page.
  - A Studio run reuses the MCP run end to end (brief, browser tools, `evaluate_check`, `finish_run`, scoring), so it writes the same files. It stops at a step and token limit, shows calls, tokens and cost where known, and honours Stop. `run.json`'s `runner` gains optional `model` and `usage`.
  - Signed in to Stunt Double (OAuth with PKCE against the hosted MCP), a checklist also runs in the cloud: Studio pushes the files, writes the cloud ids back, runs it and pulls the result back beside the local runs.
  - New commands: `stuntdouble studio [dir]` (the default in a terminal), `run <checklist> [--cloud]`, `login` and `logout`. `mcp`, `view` and `doctor` are unchanged, and inside Claude Code nothing calls a model.

## 0.1.3

### Patch Changes

- [#44](https://github.com/stunt-double/stuntkit/pull/44) [`e778ec4`](https://github.com/stunt-double/stuntkit/commit/e778ec469c946189368bc54348cf1fb9728d0b46) Thanks [@mrprkr](https://github.com/mrprkr)! - Clearer outcomes and a quieter viewer for Stunt Double Local.
  
  - `finish_run` always gives the checks passed, and a checklist with no weighted checks now says it has no score and passes only when every pass/fail check passes (and that its `pass_threshold` applies to weighted checks only). `start_run` warns about an unused `pass_threshold` up front, and the viewer's score card says the same.
  - A new read-only `doctor` tool returns the same lines as `npx stuntdouble doctor`, so an agent can run it without a shell. While the viewer runs, it reports the viewer's port. Its billing line no longer claims to know how Claude Code bills.
  - `open_ui` returns a line on each of the latest runs beside the link. A second `finish_run` or a late `evaluate_check` says the run has already finished and where its report is.
  - `start_run` no longer returns the start page's title, and the actor's description no longer ends in a doubled full stop. The brief steers the actor to `read_page` and `find` before the long page reads.
  - Safety: pages with no host (`about:blank`, `data:`, `blob:`) get the third-party guard, kept logins are kept per project in `~/.stuntdouble/profiles/<project>/<actor>`, a run counts as live only with its marker in `.live/running/`, so a reused pid no longer holds an old run open, and a locked kept profile says another run is using it.
  - A hung page can no longer hold `evaluate_check`; a missing checklist lists the ones that exist; a file that cannot be read says why rather than "file not found"; an older Node is refused at start with the version needed; a run pulled back from the cloud with no `started_at` reads.
  - Viewer: one outcome marker per finished run, no blank thumbnails on collapsed rows, the actor's name, "Copy cloud command", plain-language activity with page reads folded away, a duration that leaves out the gap before a resume, an "Earlier" mark on verdicts from before it, verdicts shown about 250ms sooner, the live frame fetched once per new frame, a lighter runs list, a run read on its own, and no favicon error.
