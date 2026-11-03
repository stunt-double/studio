# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately, either:

- through [GitHub's private vulnerability reporting](https://github.com/stunt-double/studio/security/advisories/new), or
- by email to security@stuntdouble.io.

Include the version, what an attacker can do, and steps or code to reproduce it. We will acknowledge your report within three working days, keep you updated as we investigate, and credit you in the advisory unless you would rather we did not.

## Supported versions

Fixes land in the latest published release. While `stuntdouble` is below 1.0, only the latest release gets fixes.

## Scope

In scope: the published `stuntdouble` package, including:

- Studio and the viewer: reaching them from anything but their own `127.0.0.1` address and key, a write without Studio's own `Origin`, or a page value rendered as anything but text.
- Keys and tokens in `~/.stuntdouble/credentials.json` reaching the page, a log, the project or the model.
- The browser reaching a local or private address other than the app under test, or a page getting past the third-party guard (payments, sign-ups, passwords, card numbers) when `safety` is `third_party`.
- The MCP server calling a model, starting an agent or reading an agent's credentials.

The browser guards come from `@stuntkit/browser-toolset` and read the DOM the page shows. They are a strong default rather than a sandbox, so a report is most useful when it shows a realistic page getting past them. A bypass in the guards themselves can also go to [StuntKit](https://github.com/stunt-double/stuntkit/security/advisories/new).
