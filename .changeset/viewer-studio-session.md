---
'stuntdouble': minor
---

The viewer Claude Code opens is now Stunt Double Studio, and it runs things for you instead of handing you commands to copy.

- Run again (or Resume) in Claude Code sends the checklist to the session that opened Studio as a Claude Code channel event, then opens the run when it starts. When the session was not started with the Stunt Double channel on, Studio says so and offers the command to paste.
- Sign in to Stunt Double from the viewer, choose a workspace, and Run in the cloud pushes the checklist and its actor and starts a cloud run, which lands beside the local ones. The note under the buttons says what the cloud run does and what it uploads.
- The sign-in is the one Studio keeps in `~/.stuntdouble/credentials.json`. The MCP server may now reach that sign-in, but still never a model client or a model key (`test/no-model.test.ts`).
