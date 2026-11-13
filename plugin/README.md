# Stunt Double Studio for Claude Code

See where your app fails a real person, before anyone else does.

An actor, an AI user with a goal and a point of view, runs your checklist in a real Chrome on your machine: localhost, staging or production. It brings back evidence for every check: the verdict, what it saw and a screenshot of the step. Your own Claude Code session plays the actor, so Studio needs no account and makes no model calls of its own. Every run is kept as files in your project, ready to commit.

## Install

```sh
claude plugin marketplace add stunt-double/studio
claude plugin install stuntdouble@stuntdouble-studio
```

Or, in Claude Code 2.1.275 or later, in one step:

```
/plugin install stuntdouble --marketplace stunt-double/studio
```

## Commands

| Command                                 | What it does                                                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/stuntdouble:setup`                    | Readies the project: finds the dev server, drafts an actor and checklists from your routes, and adds the CLAUDE.md notes, tool permission and hooks, each change shown before it is written |
| `/stuntdouble:run <checklist> [resume]` | Runs the checklist in a local Chrome and reports each failed check with its evidence and a viewer link                                                                                      |
| `/stuntdouble:open`                     | Opens the viewer: every run with its verdicts, screenshots and activity                                                                                                                     |
| `/stuntdouble:doctor`                   | Checks Node, Chrome, the viewer port and how local runs are billed                                                                                                                          |

Start with `/stuntdouble:setup`, then `/stuntdouble:run <checklist>`. A run is carried out by the `stuntdouble-actor` subagent, whose only tools are the local browser and run tools, so page text and screenshots stay out of your main conversation.

## Requirements

Node 22.18 or later, and Google Chrome (or Playwright's Chromium). On native Windows, use WSL.

## What the plugin runs, sends and stores

- **One local MCP server.** `.mcp.json` starts `npx -y stuntdouble@0.4.0 mcp`, the [`stuntdouble`](https://www.npmjs.com/package/stuntdouble) package on npm (Apache-2.0, published with provenance from [stunt-double/studio](https://github.com/stunt-double/studio)), pinned to an exact version. `npx` downloads it from the npm registry on first use. The server starts Chrome and a viewer on `127.0.0.1` only when a run starts or the viewer opens.
- **No model calls.** The server never calls a model, never starts `claude`, and never reads your Claude sign-in, keychain or model keys (`test/no-model.test.ts` in the package enforces this). Runs count against your own Claude plan, or your API key when Claude Code uses one.
- **What it touches.** Files under your project's `.stuntdouble/`, a fresh Chrome profile per run (deleted afterwards, unless an actor sets `persist_login`, which keeps its profile in `~/.stuntdouble/profiles/`), and the URLs your checklists name. The browser reaches local and private addresses only for the exact origins of a checklist's URL and `local_base_url`.
- **Nothing goes to Stunt Double unless you ask.** A local run sends nothing to Stunt Double. The viewer offers an optional Run in the cloud: only after you sign in to Stunt Double there (OAuth, kept in `~/.stuntdouble/credentials.json`, mode 0600) and choose it, it uploads that checklist, its actor and the target URL to `https://app.stuntdouble.io/api/mcp` and runs it in your workspace. Its note says what it uploads before you press it.
- **Two optional hooks.** `hooks/hooks.json` runs `hooks/stuntdouble-hooks.mjs` at session start and after an edit. They read only `.stuntdouble/` and do nothing until `/stuntdouble:setup` writes `.stuntdouble/hooks.json`: one names your checklists and the latest result at session start, the other suggests the matching checklist after you edit a UI file. Neither starts a run or makes a network call. Set `STUNTDOUBLE_HOOKS=off` to switch them off for yourself.

## More

- Full documentation and the local app (`npx stuntdouble studio`): [stunt-double/studio](https://github.com/stunt-double/studio#readme)
- Support: support@stuntdouble.io
- Security: see [SECURITY.md](https://github.com/stunt-double/studio/blob/main/SECURITY.md)
- Licence: Apache-2.0
