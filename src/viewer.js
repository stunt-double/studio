// Stunt Double Studio, as Claude Code opens it (served by viewer.ts): Run
// sends the checklist back to the Claude Code session, and signing in to
// Stunt Double adds cloud runs. Every value from a server reply is set as
// text through h(), never as markup, and only http(s) addresses become links.

/* global window, document, history, location */

(() => {
  const sd = window.stuntdouble;
  const { h, icon, getJson, announce } = sd;

  Object.assign(sd.ICONS, {
    play: '<path d="M7 4.5l12 7.5-12 7.5z"/>',
    'log-out':
      '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M10 12h10"/><path d="M16 8l4 4-4 4"/>',
  });

  const style = document.createElement('style');
  style.textContent = `
    .account { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-left: auto; font-size: 0.8125rem; color: var(--muted-foreground); }
    .account select { height: 2rem; border: 1px solid var(--input); border-radius: var(--radius-md); background: var(--background); color: var(--foreground); font: inherit; padding-inline: 0.5rem; }
    .btn.ghost { border-color: transparent; background: transparent; color: var(--muted-foreground); }
    .btn.ghost:hover { background: var(--accent); color: var(--accent-foreground); }
    .action-note { flex-basis: 100%; margin: 0; font-size: 0.75rem; color: var(--muted-foreground); }
    .notice pre { margin: 0.5rem 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--font-mono); font-size: 0.8125rem; }
    .notice .btn { margin-top: 0.5rem; }
  `;
  document.head.append(style);

  // The OAuth callback lands on /: go back to the page sign-in started from.
  try {
    const back = sessionStorage.getItem('sd-return');
    sessionStorage.removeItem('sd-return');
    if (back && back.startsWith('/') && location.pathname === '/')
      history.replaceState(null, '', back);
  } catch {
    // No session storage: stay on the runs list.
  }

  /** `{ agent, cloud }` from /api/viewer, or null until it answers. */
  let state = null;
  /** A run sent to Claude Code: `{ run, checklist, resume, command, missed }`. */
  let handoff = null;
  let error = '';

  async function send(path, body) {
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, data };
    } catch {
      return {
        ok: false,
        data: { error: 'Studio did not answer. Is the Claude Code session still open?' },
      };
    }
  }

  async function refresh() {
    state = await getJson('/api/viewer').catch(() => state);
    drawAccount();
  }

  async function signIn(button) {
    button.setAttribute('aria-disabled', 'true');
    button.lastChild.textContent = 'Opening Stunt Double';
    const res = await send('/api/studio/cloud/login');
    if (res.ok && sd.webUrl(res.data.url)) {
      try {
        sessionStorage.setItem('sd-return', location.pathname);
      } catch {
        // Lands on the runs list instead.
      }
      location.assign(res.data.url);
      return;
    }
    error = res.data.error || 'Sign-in could not start.';
    announce(error);
    sd.render(false);
  }

  // ── The bar: who is signed in, and where cloud runs go ────────────────────
  const account = h('div', { class: 'account' });
  document.querySelector('.bar .container').append(account);

  function drawAccount() {
    const cloud = state && state.cloud;
    if (!cloud) return account.replaceChildren();
    if (!cloud.signed_in) {
      return account.replaceChildren(
        h(
          'button',
          {
            type: 'button',
            class: 'btn outline',
            title:
              'Adds cloud runs: on a schedule, several actors at once, with replays and reports your team can open',
            onclick: (event) => signIn(event.currentTarget),
          },
          icon('external-link'),
          h('span', {}, 'Sign in to Stunt Double')
        )
      );
    }
    const signOut = h(
      'button',
      {
        type: 'button',
        class: 'btn ghost',
        onclick: async () => {
          await send('/api/studio/cloud/logout');
          await refresh();
          sd.render(false);
        },
      },
      icon('log-out'),
      h('span', {}, 'Sign out')
    );
    if (cloud.workspace) {
      return account.replaceChildren(
        h('span', {}, 'Cloud runs go to ' + cloud.workspace.name),
        signOut
      );
    }
    const picker = h('select', { 'aria-label': 'Workspace for cloud runs', disabled: true });
    picker.append(h('option', { value: '' }, 'Loading workspaces'));
    getJson('/api/studio/cloud/workspaces').then(
      ({ workspaces }) => {
        picker.replaceChildren(
          h('option', { value: '' }, 'Choose a workspace for cloud runs'),
          ...workspaces.map((w) => h('option', { value: w.id }, w.name))
        );
        picker.disabled = false;
      },
      (err) => picker.replaceChildren(h('option', { value: '' }, err.message))
    );
    picker.addEventListener('change', async () => {
      if (!picker.value) return;
      const res = await send('/api/studio/cloud/workspace', { id: picker.value });
      error = res.ok ? '' : res.data.error;
      await refresh();
      sd.render(false);
    });
    account.replaceChildren(picker, signOut);
  }

  // ── Run in Claude Code ────────────────────────────────────────────────────
  // The event carries no reply, so the page watches for the run to appear.
  const WAIT_MS = 20_000;

  async function runInAgent(run, resume) {
    const before = new Set((await getJson('/api/runs').catch(() => [])).map((r) => r.id));
    const res = await send('/api/viewer/run', { checklist: run.checklist, where: 'agent', resume });
    if (!res.ok) {
      error = res.data.error || 'The run could not be sent.';
      announce(error);
      return sd.render(false);
    }
    const current = { run: run.id, resume, command: res.data.command, missed: false };
    handoff = current;
    error = '';
    announce('Sent to Claude Code');
    sd.render(false);
    const until = Date.now() + WAIT_MS;
    while (handoff === current && Date.now() < until) {
      await new Promise((ok) => setTimeout(ok, 1000));
      const runs = await getJson('/api/runs').catch(() => []);
      const started = runs.find((r) =>
        resume
          ? r.id === run.id && r.status === 'running'
          : r.checklist === run.checklist && !before.has(r.id)
      );
      if (started) {
        handoff = null;
        history.pushState(null, '', '/runs/' + encodeURIComponent(started.id));
        return sd.render(true);
      }
    }
    if (handoff === current) {
      current.missed = true;
      announce('Claude Code has not started the run');
      sd.render(false);
    }
  }

  async function runInCloud(run, button) {
    button.setAttribute('aria-disabled', 'true');
    button.lastChild.textContent = 'Pushing to Stunt Double';
    const res = await send('/api/viewer/run', { checklist: run.checklist, where: 'cloud' });
    if (res.ok) {
      error = '';
      history.pushState(null, '', '/runs/' + encodeURIComponent(res.data.run_id));
      return sd.render(true);
    }
    error = res.data.error || 'The cloud run did not start.';
    announce(error);
    sd.render(false);
  }

  sd.runActions = (run, running, resumable) => {
    if (running) return null;
    if (run.runner.kind === 'cloud') {
      return sd.webUrl(run.runner.url)
        ? [
            h(
              'a',
              {
                class: 'btn outline',
                href: run.runner.url,
                target: '_blank',
                rel: 'noopener noreferrer',
              },
              icon('external-link'),
              h('span', {}, 'Open in Stunt Double')
            ),
          ]
        : null;
    }
    const agent = state && state.agent;
    const cloud = state && state.cloud;
    const sent = handoff && handoff.run === run.id && !handoff.missed;
    const again =
      agent && agent.kind === 'claude-code'
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn primary',
              'data-focus-key': 'again',
              'aria-disabled': sent && 'true',
              title: 'Starts the run in the Claude Code session that opened Studio',
              onclick: () => !sent && runInAgent(run, resumable),
            },
            icon('play'),
            h(
              'span',
              {},
              sent
                ? 'Sent to Claude Code'
                : resumable
                  ? 'Resume in Claude Code'
                  : 'Run again in Claude Code'
            )
          )
        : h(
            'button',
            {
              type: 'button',
              class: 'btn outline',
              'data-focus-key': 'again',
              title: 'Paste it into your coding agent to run this checklist again',
              onclick: (event) =>
                sd.copy(
                  '/stuntdouble run ' + run.checklist + (resumable ? ' resume' : ''),
                  event.currentTarget
                ),
            },
            icon('copy'),
            h('span', {}, resumable ? 'Copy resume command' : 'Copy re-run command')
          );
    const ready = cloud && cloud.signed_in && cloud.workspace;
    const inCloud = h(
      'button',
      {
        type: 'button',
        class: 'btn outline',
        'data-focus-key': 'cloud',
        onclick: (event) =>
          ready ? runInCloud(run, event.currentTarget) : signIn(event.currentTarget),
        disabled: cloud && cloud.signed_in && !cloud.workspace,
      },
      icon(ready ? 'server' : 'external-link'),
      h('span', {}, ready ? 'Run in the cloud' : 'Sign in to run in the cloud')
    );
    const note = !cloud
      ? null
      : ready
        ? 'In the cloud, Stunt Double’s own browsers run it and an independent judge checks every verdict, billed to ' +
          cloud.workspace.name +
          '. This uploads the checklist, its actor and the address it tests; the result lands here too.'
        : cloud.signed_in
          ? 'Choose a workspace at the top to run in the cloud.'
          : 'The cloud runs checklists on a schedule, several actors at once, with replays and reports your team can open.';
    return [
      again,
      cloud && inCloud,
      note && h('p', { class: 'action-note' }, note),
      error && h('span', { class: 'stop-error', role: 'alert' }, error),
    ].filter(Boolean);
  };

  // A run that did not reach Claude Code: why, and the command to paste.
  sd.runExtras = (run) => {
    if (!handoff || handoff.run !== run.id || !handoff.missed) return null;
    const command = handoff.command;
    return h(
      'div',
      { class: 'notice warning', role: 'status' },
      icon('alert-triangle'),
      h(
        'div',
        {},
        h(
          'p',
          {},
          'Claude Code has not started the run. If it is busy, it starts when the current reply ends. Studio can reach the session only when Claude Code was started with the Stunt Double channel on:'
        ),
        h(
          'pre',
          {},
          'claude --dangerously-load-development-channels plugin:stuntdouble@stuntdouble'
        ),
        h('p', {}, 'Or paste the command into Claude Code yourself.'),
        h(
          'button',
          {
            type: 'button',
            class: 'btn outline',
            onclick: (event) => sd.copy(command, event.currentTarget),
          },
          icon('copy'),
          h('span', {}, 'Copy ' + command)
        )
      )
    );
  };

  refresh().then(() => sd.render(false));
})();
