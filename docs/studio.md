# Stunt Double Studio

Studio is the local app: `npx stuntdouble studio` opens it in your browser for one project. This page covers setup, the model connection, how a Studio run works and cloud runs. Back to the [README](../README.md).

```sh
npx stuntdouble                           # in a terminal: the same as `studio` in this folder
npx stuntdouble studio [dir]              # open Studio for a project (--port, --no-open)
npx stuntdouble run <checklist>           # run one from the terminal on your connection (--resume, --max-steps)
npx stuntdouble run <checklist> --cloud   # push it and run it in your Stunt Double workspace
npx stuntdouble login                     # sign in for cloud runs (--workspace <slug>)
npx stuntdouble logout
```

## Guided setup

> Coming in the next release (the changeset is on `main`). In 0.2.0, a project with no `.stuntdouble/` asks for the address to test and starts you with a first-time visitor actor and a first checklist to edit.

A project with no `.stuntdouble/` yet starts with a short guided setup on one page, which does what `/stuntdouble setup` does in Claude Code:

1. **Your app.** Studio reads `package.json` (the `dev`, `start` or `preview` script, a port flag, or the framework's default port) and shows, for example, "Next.js, `pnpm dev`, http://localhost:3000" with an edit field. It asks that one address whether the app is answering, and says plainly which command starts it if not.
2. **What it found.** The pages, read from the project's files (`app/`, `pages/`, `src/routes/`, `config/routes.rb`, `urls.py`, `routes/web.php`, or folders with an `index.html`), and who the product is for, from the README and one line from you.
3. **A draft.** With a model connection, one call drafts an actor and two to four checklists of 3 to 8 pass/fail checks (checked against the schemas, retried once if invalid, with the cost shown when known). Without one, templates for the sign-up, pricing, checkout and home pages you have, which you edit.
4. **A preview.** Every file is shown, and editable, before anything is written: `stuntdouble.json`, the actor, the checklists and the `.gitignore` line. Studio writes only these, only under `.stuntdouble/`, and never through a symlink. It does not edit your `CLAUDE.md` or `.claude/settings.json`: it shows the two lines to add, with copy buttons.
5. **A first run**, locally, in the cloud, or in Claude Code.

Your coding agent can do the same: the setup shows the prompt to paste for Claude Code or Codex, and Studio picks the files up when they appear. The editors check every field with the same schemas a run reads the files with and show what to fix beside the field.

## Connection

Set it in Settings: Anthropic (default model `claude-opus-5-5`, or `ANTHROPIC_API_KEY` from the environment) or an OpenAI-compatible endpoint with its model and key (`OPENAI_API_KEY` works too; Ollama and LM Studio on this machine need none). OpenRouter is one of the presets.

The key is kept in `~/.stuntdouble/credentials.json`, readable by you only, never in the project, never in a log and never sent to the page, which hears only whether a key is set. Test connection makes one short call.

Studio never uses a Claude subscription: see [the policy line](../README.md#the-policy-line).

## A Studio run

A Studio run is the MCP run with a model on your connection in the agent's place: the same brief, browser tools, `evaluate_check` and `finish_run`, and the same files.

- It stops at 80 model calls or 3,000,000 tokens (the model is told to finish first).
- It shows calls, tokens and, where the provider reports it or the price is known, the cost so far.
- Stop ends it at the next step without another model call.
- Screenshots reach the model only when it asks for one.
- On Anthropic the prompt is cached and old page reads are cleared server side; on other endpoints old page reads are trimmed.
- The viewer's key never goes to the model.

Studio runs one run at a time, in a browser on this machine.

## Cloud runs

Sign in from Settings or with `stuntdouble login`: OAuth with PKCE against the hosted MCP, back to Studio's own `127.0.0.1` address, with the token kept in `~/.stuntdouble/credentials.json`.

A cloud run pushes the project, the actor and the checklist to your workspace (reusing the ids already in the files, and writing new ones back), runs it there, checks every 30 seconds and writes the result beside your local runs.

- The cloud cannot reach `localhost`: give the checklist a public or preview URL and keep the local one in `local_base_url`.
- Cloud runs add a second, independent judge. Local results are self-judged.
- `browser_config` (a preset, viewport, touch or locale) is not sent yet, so a cloud run uses the default desktop browser.
- Cloud runs are for workspaces on a paid plan and are billed to the workspace. A refusal from Stunt Double comes back as it was written, with the billing link. Plans: [stuntdouble.io/pricing](https://www.stuntdouble.io/pricing).
