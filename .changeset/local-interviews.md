---
'stuntdouble': minor
---

Local interviews: `.stuntdouble/interviews/<slug>.json` holds a guide of questions and tasks, and four new MCP tools (`start_interview`, `answer_item`, `rate_usability`, `finish_interview`) have the actor answer it in character in your own agent's session, then rate the UMUX or UMUX-Lite statements, scored by the same code as the cloud. Each session is written to `.stuntdouble/interview-runs/<stamp>-<interview>/interview.json`, and the viewer serves it at `/api/interview-runs`.
