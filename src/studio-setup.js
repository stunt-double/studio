// Stunt Double Studio: setting up a project that has no `.stuntdouble/` yet.
// Served after studio.js (studio.ts joins the two), and built on the helpers it
// shares as `window.stuntdouble.studio`. A short stepper on one page: the app,
// what Studio found, a draft, a preview of every file, then a first run.
//
// Nothing is written until the person says so, and what is written is the text
// they see in the preview. Every value from a file or a reply is set as text
// through h(), never as markup.

/* global window, document */

(() => {
  const sd = window.stuntdouble;
  const { h, icon, pageHeader, getJson, announce, copy } = sd;

  const style = document.createElement('style');
  style.textContent = `
    .setup { display: grid; gap: 1rem; max-width: 44rem; }
    .steps { display: grid; gap: 0.75rem; margin: 0; padding: 0; list-style: none; }
    .step { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card); }
    .step[data-state='todo'] { background: transparent; }
    .step-head { display: flex; gap: 0.75rem; align-items: center; padding: 0.875rem 1rem; }
    .step-mark {
      display: inline-grid; place-items: center; flex-shrink: 0; width: 1.5rem; height: 1.5rem;
      border: 1px solid var(--border); border-radius: 999px; font: 500 0.75rem/1 var(--font-mono);
      color: var(--muted-foreground);
    }
    .step[data-state='current'] .step-mark { border-color: var(--primary); color: var(--primary); }
    .step[data-state='done'] .step-mark {
      border-color: color-mix(in oklch, var(--success) 45%, transparent); color: var(--success-ink);
    }
    .step-title { font-size: 0.9375rem; font-weight: 500; margin: 0; outline: none; }
    .step[data-state='todo'] .step-title { color: var(--muted-foreground); font-weight: 400; }
    .step-summary { min-width: 0; margin-left: auto; font-size: 0.8125rem; color: var(--muted-foreground); text-align: right; overflow-wrap: anywhere; }
    .step-summary {
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    @media (max-width: 40rem) {
      .step-head { flex-wrap: wrap; row-gap: 0.25rem; }
      .step-head .btn { margin-left: auto; }
      .step-summary { order: 3; flex-basis: 100%; margin-left: 2.25rem; text-align: left; }
    }
    .step-body { display: grid; gap: 1rem; padding: 0 1rem 1rem; }
    .step-body > p { margin: 0; font-size: 0.875rem; }
    .facts-line { font-size: 0.875rem; overflow-wrap: anywhere; }
    .facts-line .mono { font-size: 0.8125rem; }
    .probe { display: flex; gap: 0.5rem; align-items: flex-start; font-size: 0.8125rem; overflow-wrap: anywhere; }
    .probe.ok { color: var(--success-ink); }
    .probe.bad { color: var(--warning-ink); }
    .routes { display: flex; flex-wrap: wrap; gap: 0.375rem; margin: 0; padding: 0; list-style: none; }
    .routes li { max-width: 100%; }
    .routes code {
      display: inline-block; max-width: 100%; padding: 0.125rem 0.5rem; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; vertical-align: bottom; border: 1px solid var(--border); border-radius: var(--radius-md);
      font-size: 0.75rem; background: var(--background);
    }
    .setup-file { display: grid; gap: 0.375rem; }
    .setup-file textarea.input { min-height: 4rem; font-size: 0.8125rem; line-height: 1.5; white-space: pre; overflow: auto; resize: vertical; }
    .setup-file .path { font-size: 0.8125rem; font-weight: 500; overflow-wrap: anywhere; }
    .snippet { display: grid; gap: 0.375rem; }
    .snippet pre {
      margin: 0; padding: 0.625rem 0.75rem; overflow: auto; font: 400 0.75rem/1.5 var(--font-mono);
      border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--background);
    }
    .snippet-top { display: flex; gap: 0.5rem; align-items: center; justify-content: space-between; flex-wrap: wrap; }
    .snippet-top .path { font-size: 0.8125rem; font-weight: 500; overflow-wrap: anywhere; }
    .aside { border: 1px solid var(--border); border-radius: var(--radius-lg); }
    .aside > summary { cursor: pointer; padding: 0.75rem 1rem; font-size: 0.875rem; font-weight: 500; }
    .aside-body { display: grid; gap: 1rem; padding: 0 1rem 1rem; }
    .aside-body p { margin: 0; font-size: 0.875rem; }
    .written { margin: 0; padding-left: 1.25rem; font-size: 0.8125rem; }
    .written li { overflow-wrap: anywhere; }
  `;
  document.head.append(style);

  const { field, input, textarea, send, refresh, go, showErrors, noticeBox } = sd.studio;

  // The flow's state outlives a redraw: a file change redraws the page, and a
  // person half way through must find the step and the text they left.
  const S = {
    step: 1,
    detect: null,
    url: '',
    urlError: '',
    probe: null,
    probing: false,
    description: '',
    drafting: false,
    draftError: null,
    files: [],
    usage: null,
    mode: null,
    issues: [],
    writing: false,
    written: null,
    finished: false,
    checklist: '',
    runError: '',
  };
  let host = null;

  sd.setupOpen = () => Boolean(S.written && !S.finished);

  const STEPS = ['Your app', 'What Studio found', 'Draft', 'Preview', 'First run'];
  const AGENT_CLAUDE = '/stuntdouble setup';
  const AGENT_CODEX = [
    'Set up Stunt Double for this project. Create these files under .stuntdouble/ and change nothing else:',
    '- stuntdouble.json: {"format":"stuntdouble/1","local_base_url":null,"headless":false,"model_screenshots":"on_request","safety":"third_party"}',
    '- .gitignore holding the line .live/',
    '- actors/<slug>.json: {"name","description","knowledge":[],"persist_login":false}. Name the actor by its role, never a human name. Test accounts only, never real credentials.',
    '- checklists/<slug>.json: {"name","actor":"<actor slug>","url","instructions","checks":[{"key","description"}]} with 3 to 8 observable pass/fail checks, each with a lowercase, hyphenated key that never changes.',
    'Find the dev server and the routes from package.json and the route folders, then write two to four checklists for the main flows.',
  ].join('\n');

  function paint() {
    if (!host) return;
    host.replaceChildren(...build());
  }

  function goTo(step) {
    S.step = step;
    paint();
    host?.querySelector('.step[data-state="current"] .step-title')?.focus();
    announce('Step ' + step + ' of ' + STEPS.length + ': ' + STEPS[step - 1]);
  }

  // ── Small pieces ──────────────────────────────────────────────────────────
  function snippet(path, text) {
    const copyButton = h(
      'button',
      { type: 'button', class: 'btn outline', onclick: () => copy(text, copyButton) },
      icon('copy'),
      h('span', {}, 'Copy')
    );
    return h(
      'div',
      { class: 'snippet' },
      h(
        'div',
        { class: 'snippet-top' },
        path ? h('code', { class: 'path' }, path) : h('span', {}),
        copyButton
      ),
      h('pre', {}, text)
    );
  }

  const wiring = (slugs) => [
    {
      path: 'CLAUDE.md',
      text:
        '## Stunt Double\n\nBrowser checks live in .stuntdouble/ (checklists: ' +
        (slugs.join(', ') || 'see checklists/') +
        '). Run one with `/stuntdouble run <checklist>`. Never edit .stuntdouble/runs/ by hand.',
    },
    {
      path: '.claude/settings.local.json',
      text: '{\n  "permissions": {\n    "allow": ["mcp__plugin_stuntdouble_local"]\n  }\n}',
    },
  ];

  function wiringNote(slugs) {
    return h(
      'details',
      { class: 'aside' },
      h('summary', {}, 'Two lines for Claude Code, which Studio does not write'),
      h(
        'div',
        { class: 'aside-body' },
        h(
          'p',
          { class: 'muted' },
          'CLAUDE.md and .claude/settings.json steer your coding agent and may hold rules of your own, so Studio never edits them. If you use Claude Code, add these yourself: the first tells it where the checklists are, the second stops it asking before every browser action (merge it into the file if it already exists).'
        ),
        wiring(slugs).map((w) => snippet(w.path, w.text))
      )
    );
  }

  function agentAside() {
    return h(
      'details',
      { class: 'aside' },
      h('summary', {}, 'Set up with Claude Code or Codex instead'),
      h(
        'div',
        { class: 'aside-body' },
        h(
          'p',
          { class: 'muted' },
          'Your coding agent can write the same files. Paste one of these into it from this folder, and Studio picks them up when they appear.'
        ),
        h('p', {}, h('strong', {}, 'Claude Code')),
        snippet('', AGENT_CLAUDE),
        h(
          'p',
          { class: 'muted' },
          'Needs the Stunt Double plugin: claude plugin marketplace add stunt-double/stuntdouble-mcp'
        ),
        h('p', {}, h('strong', {}, 'Codex')),
        snippet('', AGENT_CODEX)
      )
    );
  }

  /** One step: head always, body only for the current one. */
  function step(n, summary, body, change) {
    const state = n < S.step ? 'done' : n === S.step ? 'current' : 'todo';
    return h(
      'li',
      { class: 'step', 'data-state': state, 'aria-current': state === 'current' ? 'step' : false },
      h(
        'div',
        { class: 'step-head' },
        h(
          'span',
          { class: 'step-mark', 'aria-hidden': 'true' },
          state === 'done' ? icon('check-circle') : String(n)
        ),
        h('h2', { class: 'step-title', tabindex: '-1' }, STEPS[n - 1]),
        state === 'done' && [
          h('span', { class: 'step-summary' }, summary),
          change &&
            h(
              'button',
              { type: 'button', class: 'btn ghost', onclick: () => goTo(n) },
              h('span', {}, 'Change')
            ),
        ]
      ),
      state === 'current' && h('div', { class: 'step-body' }, [body].flat(5))
    );
  }

  const primary = (label, onclick, attrs = {}) =>
    h('button', { type: 'button', class: 'btn primary', onclick, ...attrs }, h('span', {}, label));
  const secondary = (label, onclick, attrs = {}) =>
    h('button', { type: 'button', class: 'btn outline', onclick, ...attrs }, h('span', {}, label));

  // ── 1. The app ────────────────────────────────────────────────────────────
  async function runProbe() {
    S.probing = true;
    S.urlError = '';
    paint();
    const res = await send('POST', '/api/studio/setup/probe', { url: S.url.trim() });
    S.probing = false;
    if (res.ok) S.probe = res.data;
    else S.urlError = res.data.issues?.[0]?.message || res.data.error || 'Could not check that.';
    paint();
  }

  function describeDev(dev) {
    if (!dev.framework) {
      return h(
        'p',
        { class: 'facts-line muted' },
        'Studio could not tell which framework this is. Enter the address your app runs at.'
      );
    }
    return h(
      'p',
      { class: 'facts-line' },
      dev.framework,
      dev.command && [', ', h('code', {}, dev.command)],
      ', ',
      h('code', {}, dev.url),
      h(
        'span',
        { class: 'muted' },
        dev.source === 'script' ? ' (the port is in your dev script)' : ' (the default port)'
      )
    );
  }

  function appStep() {
    const dev = S.detect.dev;
    const urlInput = input({
      name: 'url',
      type: 'url',
      value: S.url,
      placeholder: 'http://localhost:3000',
      autocomplete: 'url',
      oninput: (e) => {
        S.url = e.target.value;
        S.probe = null;
        S.urlError = '';
      },
    });
    const urlField = field('Address to test', urlInput, {
      path: 'url',
      hint: 'Localhost works: the browser runs on this machine.',
    });
    if (S.urlError) {
      urlField.querySelector('.field-error').textContent = S.urlError;
      urlInput.setAttribute('aria-invalid', 'true');
    }
    const result = S.probing
      ? h('p', { class: 'probe muted' }, 'Checking')
      : S.probe &&
        h(
          'p',
          { class: 'probe ' + (S.probe.reachable ? 'ok' : 'bad'), role: 'status' },
          icon(S.probe.reachable ? 'check-circle' : 'alert-triangle'),
          h('span', {}, S.probe.message)
        );
    return [
      describeDev(dev),
      urlField,
      h(
        'div',
        { class: 'form-actions' },
        secondary('Check it', runProbe, { disabled: S.probing }),
        result
      ),
      h(
        'div',
        { class: 'form-actions' },
        primary('Continue', () => {
          if (!S.url.trim()) {
            S.urlError = 'Enter the address of your app';
            return paint();
          }
          goTo(2);
        })
      ),
    ];
  }

  // ── 2. What Studio found ──────────────────────────────────────────────────
  function foundStep() {
    const { routes, product } = S.detect;
    const shown = routes.slice(0, 14);
    const about = [product.name, product.description].filter(Boolean).join(': ');
    const describe = textarea(
      {
        name: 'description',
        rows: '2',
        maxlength: '500',
        placeholder: 'Someone who runs a small online shop and has never used the product',
        oninput: (e) => (S.description = e.target.value),
      },
      S.description
    );
    return [
      routes.length
        ? [
            h(
              'p',
              {},
              'Studio found ' +
                routes.length +
                (routes.length === 1 ? ' page' : ' pages') +
                ' in the project files.'
            ),
            h(
              'ul',
              { class: 'routes', 'aria-label': 'Pages found' },
              shown.map((r) => h('li', {}, h('code', { title: r.source }, r.path))),
              routes.length > shown.length &&
                h('li', { class: 'muted' }, 'and ' + (routes.length - shown.length) + ' more')
            ),
          ]
        : h(
            'p',
            { class: 'muted' },
            'No pages found in the project files. Studio will draft from the address alone.'
          ),
      about ? h('p', { class: 'muted' }, 'From the README and package.json: ' + about) : null,
      field('Who is the user?', describe, {
        path: 'description',
        hint: 'One line, optional. It shapes the actor.',
      }),
      h(
        'div',
        { class: 'form-actions' },
        primary('Continue', () => goTo(3))
      ),
    ];
  }

  // ── 3. Draft ──────────────────────────────────────────────────────────────
  async function draft(mode) {
    S.drafting = mode;
    S.draftError = null;
    paint();
    const res = await send('POST', '/api/studio/setup/draft', {
      url: S.url.trim(),
      description: S.description.trim() || undefined,
      mode,
    });
    S.drafting = false;
    if (res.ok) {
      S.files = res.data.files;
      S.usage = res.data.usage;
      S.mode = res.data.mode;
      S.issues = [];
      S.checklist = '';
      return goTo(4);
    }
    S.draftError = {
      message: res.data.error || res.data.issues?.[0]?.message || 'Could not draft.',
      template: Boolean(res.data.template),
    };
    paint();
  }

  function draftStep() {
    const c = S.detect.connection;
    const busy = Boolean(S.drafting);
    return [
      S.draftError &&
        h(
          'div',
          { class: 'notice warning', role: 'alert' },
          icon('alert-triangle'),
          h('p', {}, S.draftError.message)
        ),
      c
        ? h(
            'p',
            {},
            'Studio drafts with ',
            h('code', {}, c.model),
            ' on your connection: one call, with the page list, the start of the README and your line about the user. You see every file before it is written.'
          )
        : h(
            'p',
            {},
            'No model connection yet, so Studio drafts from templates for the pages it found, and you edit them next. Connect a model in ',
            h('a', { class: 'link', href: '/settings', 'data-nav': true }, 'Settings'),
            ' to have one drafted from your README instead.'
          ),
      h(
        'div',
        { class: 'form-actions' },
        c
          ? [
              primary(
                S.drafting === 'model' ? 'Drafting' : 'Draft with ' + c.model,
                () => draft('model'),
                { disabled: busy }
              ),
              secondary(
                S.drafting === 'template' ? 'Drafting' : 'Use templates instead',
                () => draft('template'),
                { disabled: busy }
              ),
            ]
          : primary(S.drafting ? 'Drafting' : 'Use templates', () => draft('template'), {
              disabled: busy,
            })
      ),
    ];
  }

  // ── 4. Preview ────────────────────────────────────────────────────────────
  const slugsOf = () =>
    S.files.filter((f) => f.path.startsWith('checklists/')).map((f) => f.path.slice(11, -5));

  function usageLine() {
    if (S.mode === 'template' || !S.usage) return 'Drafted from templates: no model was called.';
    const u = S.usage;
    const tokens = (u.input_tokens + u.output_tokens).toLocaleString('en-GB');
    const cost =
      u.cost_usd != null ? ', about $' + u.cost_usd.toFixed(u.cost_usd < 0.01 ? 4 : 2) : '';
    return (
      'Drafted with ' +
      u.model +
      ': ' +
      u.attempts +
      (u.attempts === 1 ? ' call, ' : ' calls (the first was not valid), ') +
      tokens +
      ' tokens' +
      cost +
      '.'
    );
  }

  async function write() {
    S.writing = true;
    paint();
    const res = await send('POST', '/api/studio/setup/write', { files: S.files });
    S.writing = false;
    if (res.ok) {
      S.written = res.data.written;
      S.issues = [];
      await refresh();
      return goTo(5);
    }
    S.issues = res.data.issues || [{ path: '', message: res.data.error || 'Could not write.' }];
    paint();
  }

  function previewStep() {
    const notice = noticeBox();
    const form = h(
      'form',
      {
        class: 'setup-form form',
        novalidate: true,
        onsubmit: (event) => {
          event.preventDefault();
          write();
        },
      },
      notice,
      h('p', { class: 'muted' }, usageLine()),
      h(
        'p',
        {},
        'Nothing is written yet. These ' + S.files.length + ' files go in ',
        h('code', {}, '.stuntdouble/'),
        ' only, and you can edit any of them first.'
      ),
      S.files.map((file) => {
        const area = textarea(
          {
            name: file.path,
            spellcheck: 'false',
            wrap: 'off',
            rows: String(Math.min(22, file.content.split('\n').length + 1)),
            class: 'input mono',
            oninput: (e) => (file.content = e.target.value),
          },
          file.content
        );
        const wrap = field(file.path, area, { path: 'files.' + file.path });
        wrap.classList.add('setup-file');
        wrap.querySelector('label').className = 'path mono';
        return wrap;
      }),
      wiringNote(slugsOf()),
      h(
        'div',
        { class: 'form-actions' },
        h(
          'button',
          { type: 'submit', class: 'btn primary', disabled: S.writing },
          h('span', {}, S.writing ? 'Writing' : 'Write ' + S.files.length + ' files')
        ),
        secondary('Back', () => goTo(3))
      )
    );
    queueMicrotask(() => S.issues.length && showErrors(form, S.issues, notice));
    return form;
  }

  // ── 5. First run ──────────────────────────────────────────────────────────
  async function startLocal() {
    S.runError = '';
    const res = await send('POST', '/api/studio/run', { checklist: S.checklist, where: 'local' });
    if (!res.ok) {
      S.runError = res.data.error || 'The run did not start.';
      return paint();
    }
    S.finished = true;
    go('/runs/' + encodeURIComponent(res.data.run_id));
  }

  async function startCloud() {
    S.runError = '';
    const res = await send('POST', '/api/studio/run', { checklist: S.checklist, where: 'cloud' });
    if (!res.ok) {
      S.runError = res.data.error || 'The run did not start.';
      return paint();
    }
    S.finished = true;
    go('/');
  }

  function runStep() {
    const slugs = slugsOf();
    S.checklist ||= slugs.includes('first-look') ? 'first-look' : slugs[0];
    const connected = Boolean(S.detect.connection);
    const cloud = sd.studio.status()?.cloud;
    const pick =
      slugs.length > 1 &&
      field(
        'Checklist',
        sd.studio.select(
          { name: 'checklist', onchange: (e) => (S.checklist = e.target.value) },
          slugs.map((s) => [s, s]),
          S.checklist
        ),
        { path: 'checklist' }
      );
    const link = (href, label, extra = 'btn outline') =>
      h(
        'a',
        { class: extra, href, 'data-nav': true, onclick: () => (S.finished = true) },
        h('span', {}, label)
      );
    return [
      h('p', {}, 'Written to ', h('code', {}, '.stuntdouble/'), ':'),
      h(
        'ul',
        { class: 'written' },
        (S.written || []).map((p) => h('li', {}, h('code', {}, p)))
      ),
      wiringNote(slugs),
      pick,
      S.runError &&
        h(
          'div',
          { class: 'notice warning', role: 'alert' },
          icon('alert-triangle'),
          h('p', {}, S.runError)
        ),
      h(
        'div',
        { class: 'form-actions' },
        connected
          ? primary('Run locally', startLocal)
          : link('/settings', 'Connect a model to run locally', 'btn primary'),
        cloud?.signed_in
          ? secondary('Run in the cloud', startCloud)
          : link('/settings', 'Sign in to run in the cloud'),
        link('/checklists', 'Open the Studio', 'btn ghost')
      ),
      h('p', { class: 'muted' }, 'Or in Claude Code, from this folder:'),
      snippet('', '/stuntdouble run ' + S.checklist),
    ];
  }

  // ── The page ──────────────────────────────────────────────────────────────
  function build() {
    const d = S.detect;
    return [
      pageHeader({
        title: 'Set up ' + d.name,
        description:
          'Studio drafts an actor and a few checklists for this project, shows you every file, and writes them to .stuntdouble/ only when you say so.',
      }),
      h(
        'div',
        { class: 'setup' },
        h(
          'ol',
          { class: 'steps' },
          step(1, S.url, appStep(), true),
          step(
            2,
            S.description.trim() || 'No description',
            S.step === 2 ? foundStep() : null,
            true
          ),
          step(
            3,
            S.mode === 'template' ? 'Templates' : S.mode === 'model' ? 'Drafted with a model' : '',
            S.step === 3 ? draftStep() : null,
            !S.written
          ),
          step(
            4,
            S.written ? 'Written' : S.files.length + ' files',
            S.step === 4 ? previewStep() : null,
            false
          ),
          step(5, '', S.step === 5 ? runStep() : null, false)
        ),
        S.step < 4 && agentAside()
      ),
    ];
  }

  sd.renderSetup = async function renderSetup() {
    if (!S.detect) {
      S.detect = await getJson('/api/studio/setup/detect');
      S.url ||= S.detect.dev.url;
      host = h('div', {});
      paint();
      runProbe();
    } else {
      host = h('div', {});
      paint();
    }
    return host;
  };
})();
