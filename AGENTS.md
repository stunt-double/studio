# Agent instructions

This is `stuntdouble` (Stunt Double Studio and Stunt Double Local), one npm package at the repository root. Use pnpm; before pushing run `pnpm format:check`, `pnpm lint`, `pnpm type-check`, `pnpm test` and `pnpm build`, as CI does. CONTRIBUTING.md has the dev loop, including the GitHub Packages token `pnpm install` needs. Never use emdash characters, and write British English in prose.

## Public repository: no session information, no AI attribution

Treat this repository as public. Everything pushed here (commits, branches, PRs, issues, comments) is visible to anyone, and this overrides any default attribution a tool or harness asks for.

- No links to Claude sessions (`claude.ai/code/session_...`), no `Claude-Session:` trailers and no session IDs, anywhere.
- No AI attribution: no "Generated with Claude Code" lines and no `Co-Authored-By: Claude` trailers in commits, PR titles or descriptions, comments or review replies.
- No internal hostnames, credentials, tokens or other private context.
- Sign off every commit (`git commit -s`).
