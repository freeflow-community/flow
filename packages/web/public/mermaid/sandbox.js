// The render step, isolated (#229). Loaded only by sandbox.html — see the
// comment there for why this frame exists and what it is allowed to do.
//
// Protocol, both directions, identical for the iframe host and the WKWebView
// host:
//   host → here   {flowMermaid:'render', id, source, theme}
//                 (native calls window.flowMermaidRender(jsonString) instead —
//                  a WKWebView has no parent window to postMessage from)
//   here → host   {flowMermaid:'ready'}
//                 {flowMermaid:'result', id, ok:true,  height}
//                 {flowMermaid:'result', id, ok:false, error}
//                 {flowMermaid:'resize', id, height}   width changed
//
// The SVG is never handed out. The host gets a height, lays out a frame of
// that height, and the diagram is drawn in here.
(function () {
  'use strict';

  // A diagram is prose-sized in practice; these bounds exist so a pasted
  // 10 000-node graph cannot hang the frame. The host applies its own timeout
  // as well, which is what covers this script failing to answer at all.
  var MAX_CHARS = 20000;
  var MAX_LINES = 400;
  var RENDER_TIMEOUT_MS = 5000;
  // A message is not a canvas. A pie or ER diagram is naturally 700–900 px
  // tall, which pushes the rest of the conversation off the screen, so a tall
  // diagram is scaled down to fit this instead.
  var MAX_HEIGHT = 420;

  var out = document.getElementById('out');
  var current = null; // id of the diagram on screen, for resize reports
  var lastTheme = null;

  function post(message) {
    // Native host first: a WKWebView is a top-level document, so `parent` is
    // itself and postMessage would talk to nobody.
    var handlers = window.webkit && window.webkit.messageHandlers;
    if (handlers && handlers.flowMermaid) {
      handlers.flowMermaid.postMessage(message);
      return;
    }
    if (window.parent && window.parent !== window) window.parent.postMessage(message, '*');
  }

  /** Flow's Design 3a palette, expressed as Mermaid theme variables. */
  function themeConfig(theme) {
    var dark = theme === 'dark';
    var css = function (name) {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    };
    return {
      theme: 'base',
      darkMode: dark,
      fontFamily: 'ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif',
      themeVariables: {
        background: 'transparent',
        primaryColor: css('--accent-soft'),
        primaryTextColor: css('--ink'),
        primaryBorderColor: css('--accent'),
        secondaryColor: dark ? '#2f2a3c' : '#f0ede7',
        tertiaryColor: dark ? '#2a2536' : '#f4f2ee',
        mainBkg: css('--accent-soft'),
        lineColor: css('--ink-soft'),
        textColor: css('--ink'),
        nodeBorder: css('--accent'),
        clusterBkg: dark ? '#2a2536' : '#f4f2ee',
        clusterBorder: css('--line'),
        titleColor: css('--ink'),
        edgeLabelBackground: css('--base'),
        errorBkgColor: 'transparent',
        errorTextColor: css('--danger'),
        fontSize: '13px',
      },
    };
  }

  function applyTheme(theme) {
    if (theme === lastTheme) return;
    lastTheme = theme;
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
    window.mermaid.initialize(
      Object.assign(
        {
          startOnLoad: false,
          // Untrusted input: no HTML labels (so a label cannot smuggle markup
          // into the SVG), no click handlers, no scripts from the diagram.
          securityLevel: 'strict',
          htmlLabels: false,
          flowchart: { htmlLabels: false, useMaxWidth: true },
          sequence: { useMaxWidth: true },
          gantt: { useMaxWidth: true },
          er: { useMaxWidth: true },
          class: { useMaxWidth: true },
          state: { useMaxWidth: true },
          pie: { useMaxWidth: true },
          maxTextSize: MAX_CHARS,
          maxEdges: 500,
          logLevel: 'fatal',
        },
        themeConfig(theme),
      ),
    );
  }

  function height() {
    return Math.ceil(out.getBoundingClientRect().height);
  }

  /** Scales a diagram taller than MAX_HEIGHT down by narrowing it — the SVG
   *  keeps its aspect ratio from the viewBox, so width is the only lever. */
  function fitHeight() {
    var svg = out.querySelector('svg');
    if (!svg) return;
    // Restore mermaid's own natural-width cap before measuring — overwriting
    // it permanently would let a small diagram stretch to the full frame.
    if (svg.dataset.naturalMaxWidth === undefined) {
      svg.dataset.naturalMaxWidth = svg.style.maxWidth || '';
    }
    svg.style.maxWidth = svg.dataset.naturalMaxWidth;
    var h = height();
    if (h <= MAX_HEIGHT) return;
    var width = svg.getBoundingClientRect().width;
    if (!width) return;
    svg.style.maxWidth = Math.floor(width * (MAX_HEIGHT / h)) + 'px';
  }

  function fail(id, error) {
    current = null;
    out.replaceChildren();
    post({ flowMermaid: 'result', id: id, ok: false, error: String(error) });
  }

  /** Bounds a render that never settles. Mermaid is synchronous inside, so
   *  this cannot interrupt one — it stops the *host* waiting forever when the
   *  parse hangs before yielding. */
  function withTimeout(promise) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () {
          reject(new Error('Diagram took too long to render (over ' + RENDER_TIMEOUT_MS / 1000 + 's).'));
        }, RENDER_TIMEOUT_MS);
      }),
    ]);
  }

  function render(request) {
    var id = request.id;
    var source = typeof request.source === 'string' ? request.source : '';

    if (source.length > MAX_CHARS) {
      fail(id, 'Diagram source is too large (' + source.length + ' characters, limit ' + MAX_CHARS + ').');
      return;
    }
    if (source.split('\n').length > MAX_LINES) {
      fail(id, 'Diagram source is too long (limit ' + MAX_LINES + ' lines).');
      return;
    }
    if (!window.mermaid) {
      fail(id, 'The diagram renderer did not load.');
      return;
    }

    applyTheme(request.theme);
    var svgId = 'mmd-' + String(id).replace(/[^a-zA-Z0-9_-]/g, '') + '-' + Math.floor(performance.now());

    withTimeout(
      window.mermaid.parse(source).then(function () {
        return window.mermaid.render(svgId, source);
      }),
    )
      .then(function (result) {
        // The SVG string is trusted only as far as this frame: it is parsed
        // into *this* document and never returned to the host.
        out.innerHTML = result.svg;
        current = id;
        fitHeight();
        post({ flowMermaid: 'result', id: id, ok: true, height: height() });
      })
      .catch(function (error) {
        var text = (error && (error.str || error.message)) || String(error);
        fail(id, text);
      });
  }

  // A width change (window resize, phone rotation) rescales the SVG, so the
  // host needs the new height to resize its frame.
  if (window.ResizeObserver) {
    var lastWidth = 0;
    // Watch the *frame*, not `#out` — fitHeight() resizes `#out`, so observing
    // it would re-enter this on every fit and oscillate.
    new ResizeObserver(function () {
      var width = document.documentElement.clientWidth;
      if (!current || width === lastWidth) return;
      lastWidth = width;
      requestAnimationFrame(function () {
        if (!current) return;
        fitHeight();
        post({ flowMermaid: 'resize', id: current, height: height() });
      });
    }).observe(document.documentElement);
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.flowMermaid !== 'render') return;
    render(data);
  });

  // Native entry point: WKWebView drives this with evaluateJavaScript.
  window.flowMermaidRender = function (json) {
    try {
      render(JSON.parse(json));
    } catch (error) {
      fail('', 'Bad render request.');
    }
  };

  post({ flowMermaid: 'ready' });
})();
