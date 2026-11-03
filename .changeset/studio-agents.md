---
'stuntdouble': minor
---

Studio works with coding agents. Claude Code and Codex connect as MCP clients and Settings, Agents shows which are connected, with the one-time setup to copy for each. A checklist can be run in Claude Code or Codex from the run picker: Studio shows the prompt to paste and opens the run when it appears.

- The MCP server records the client's name and version on `initialize` under `.stuntdouble/.live/agents/` and removes it on exit.
- `run.json`'s `runner` gains an optional `client` (`{ name, version }`), and the runs list and run page show Claude Code, Codex, Local or Cloud.
- Studio still never starts an agent, never reads its sign-in and never uses its plan.
