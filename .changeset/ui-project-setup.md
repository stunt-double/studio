---
'stuntdouble': minor
---

Studio sets up a new project for you, and Claude Code and Studio share one viewer.

- A folder with no `.stuntdouble/` opens a guided setup on one page. It finds your dev server from `package.json` (the `dev`, `start` or `preview` script, a port flag, or the framework's default port) and checks that it answers, finds your pages from the project's files, then drafts an actor and two to four checklists. With a model connection, one call drafts them from your routes, README and one line about the user, checked against the same schemas as a run and retried once if invalid, with the cost shown when known. Without one, templates for the pages you have. Every file is shown, and editable, before it is written, and Studio writes only inside `.stuntdouble/`. It shows the two lines to add to `CLAUDE.md` and `.claude/settings.local.json` instead of editing them. The setup also offers the prompt to paste into Claude Code or Codex, and ends by offering a first run.
- While Studio is open for a project, `start_run`, `finish_run` and `open_ui` in Claude Code link Studio's run page instead of starting a second viewer on another port. Studio records itself in `.stuntdouble/.live/studio.json` (mode 0600, like `server.json`) and removes it on exit. The MCP server uses it only when its process is alive and its port answers as the same project, and otherwise starts its own viewer as before. The `/__stuntdouble` probe now also returns a short hash identifying the project.
- Studio's live updates now start once `.stuntdouble/` appears, so a run begun straight after setup updates in the page without a reload.
