// ==UserScript==
// @name         ChatMathEquation
// @namespace    https://example.local/
// @version      0.1.0
// @description  Select rendered equations in ChatGPT, Gemini, Claude, and similar sites to copy LaTeX, Markdown math, or visible equation text.
// @author       ermaolaoye
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://gemini.google.com/*
// @match        https://claude.ai/*
// @match        https://*.openai.com/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TOOLBAR_ID = 'tm-equation-copy-toolbar';
  const STATE = {
    toolbar: null,
    activeEquation: null,
    activePayload: null,
    hideTimer: null,
  };

  const MATH_SELECTORS = [
    '.katex',
    '.katex-display',
    '.MathJax',
    '.math',
    '.arithmatex',
    'mjx-container',
    'math',
    '[data-testid*="math"]',
    '[class*="math-"]',
    '[class*="equation"]',
    '[aria-label*="\\"]',
  ].join(', ');

  function init() {
    ensureToolbar();
    document.addEventListener('selectionchange', debounce(handleSelectionChange, 60), true);
    document.addEventListener('mouseup', handleSelectionChange, true);
    document.addEventListener('keyup', handleSelectionChange, true);
    document.addEventListener('scroll', repositionToolbar, true);
    window.addEventListener('resize', repositionToolbar, true);
    document.addEventListener('mousedown', handleDocumentMouseDown, true);
  }

  function debounce(fn, wait) {
    let timer = null;
    return function debounced(...args) {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function ensureToolbar() {
    if (STATE.toolbar) {
      return STATE.toolbar;
    }

    const style = document.createElement('style');
    style.textContent = `
      #${TOOLBAR_ID} {
        position: fixed;
        z-index: 2147483647;
        display: none;
        gap: 6px;
        align-items: center;
        padding: 8px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(20, 20, 24, 0.96);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
        backdrop-filter: blur(12px);
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      }

      #${TOOLBAR_ID}[data-visible="true"] {
        display: flex;
      }

      #${TOOLBAR_ID} button {
        appearance: none;
        border: 0;
        border-radius: 9px;
        padding: 8px 10px;
        background: #2e6bff;
        color: #fff;
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        cursor: pointer;
        white-space: nowrap;
      }

      #${TOOLBAR_ID} button[data-kind="equation"] {
        background: #575b66;
      }

      #${TOOLBAR_ID} button[data-kind="markdown"] {
        background: #0d8f6f;
      }

      #${TOOLBAR_ID} button[data-kind="latex"] {
        background: #7a4dff;
      }

      #${TOOLBAR_ID} .tm-equation-copy-status {
        color: #cfd3dc;
        font-size: 12px;
        padding-left: 4px;
        min-width: 44px;
      }
    `;
    document.documentElement.appendChild(style);

    const toolbar = document.createElement('div');
    toolbar.id = TOOLBAR_ID;
    toolbar.innerHTML = `
      <button type="button" data-kind="latex">Copy LaTeX</button>
      <button type="button" data-kind="markdown">Copy Markdown</button>
      <button type="button" data-kind="equation">Copy Equation</button>
      <span class="tm-equation-copy-status"></span>
    `;

    toolbar.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    toolbar.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-kind]');
      if (!button || !STATE.activePayload) {
        return;
      }

      const kind = button.dataset.kind;
      const value = STATE.activePayload[kind];
      if (!value) {
        setStatus('Unavailable');
        return;
      }

      const ok = await copyText(value);
      setStatus(ok ? 'Copied' : 'Failed');
    });

    document.documentElement.appendChild(toolbar);
    STATE.toolbar = toolbar;
    return toolbar;
  }

  function setStatus(message) {
    if (!STATE.toolbar) {
      return;
    }

    const node = STATE.toolbar.querySelector('.tm-equation-copy-status');
    if (!node) {
      return;
    }

    node.textContent = message;
    window.clearTimeout(STATE.hideTimer);
    STATE.hideTimer = window.setTimeout(() => {
      node.textContent = '';
    }, 1200);
  }

  function handleDocumentMouseDown(event) {
    if (!STATE.toolbar) {
      return;
    }

    const clickedToolbar = event.target.closest(`#${TOOLBAR_ID}`);
    const clickedEquation = STATE.activeEquation && normalizeMathElement(event.target.closest(MATH_SELECTORS)) === STATE.activeEquation;
    if (!clickedToolbar && !clickedEquation) {
      hideToolbar();
    }
  }

  function handleSelectionChange() {
    const match = getSelectedEquation();
    if (!match) {
      hideToolbar();
      return;
    }

    const payload = buildPayload(match.element);
    if (!payload.latex && !payload.markdown && !payload.equation) {
      hideToolbar();
      return;
    }

    STATE.activeEquation = match.element;
    STATE.activePayload = payload;
    showToolbar(match.rect, payload);
  }

  function getSelectedEquation() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const rect = getBestRect(range);
    if (!rect || (!rect.width && !rect.height)) {
      return null;
    }

    const candidates = getMathCandidatesFromRange(range);
    if (candidates.length === 0) {
      return null;
    }

    const ranked = candidates
      .map((element) => ({
        element,
        score: scoreCandidate(element, rect),
      }))
      .sort((a, b) => b.score - a.score);

    return ranked[0] ? { element: ranked[0].element, rect: ranked[0].element.getBoundingClientRect() } : null;
  }

  function getBestRect(range) {
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width || rect.height);
    if (rects.length > 0) {
      return rects[0];
    }
    return range.getBoundingClientRect();
  }

  function getMathCandidatesFromRange(range) {
    const start = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentElement;
    const end = range.endContainer.nodeType === Node.ELEMENT_NODE
      ? range.endContainer
      : range.endContainer.parentElement;

    const candidates = new Set();
    collectCandidate(start, candidates);
    collectCandidate(end, candidates);

    const common = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;

    if (common) {
      common.querySelectorAll(MATH_SELECTORS).forEach((node) => {
        if (rangeIntersectsNode(range, node)) {
          candidates.add(normalizeMathElement(node));
        }
      });
    }

    return Array.from(candidates).filter(Boolean);
  }

  function collectCandidate(node, set) {
    if (!node || !(node instanceof Element)) {
      return;
    }

    const match = normalizeMathElement(node.closest(MATH_SELECTORS));
    if (match) {
      set.add(match);
    }
  }

  function normalizeMathElement(node) {
    if (!node) {
      return null;
    }

    if (node.matches('.katex-display') && node.querySelector('.katex')) {
      return node;
    }

    const displayParent = node.closest('.katex-display');
    if (displayParent) {
      return displayParent;
    }

    return node;
  }

  function rangeIntersectsNode(range, node) {
    try {
      return range.intersectsNode(node);
    } catch {
      const nodeRange = document.createRange();
      nodeRange.selectNodeContents(node);
      return !(
        range.compareBoundaryPoints(Range.END_TO_START, nodeRange) <= 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, nodeRange) >= 0
      );
    }
  }

  function scoreCandidate(element, selectionRect) {
    const rect = element.getBoundingClientRect();
    const intersectionWidth = Math.max(0, Math.min(rect.right, selectionRect.right) - Math.max(rect.left, selectionRect.left));
    const intersectionHeight = Math.max(0, Math.min(rect.bottom, selectionRect.bottom) - Math.max(rect.top, selectionRect.top));
    const overlapArea = intersectionWidth * intersectionHeight;
    const elementArea = Math.max(1, rect.width * rect.height);
    return overlapArea / elementArea + (isMathLike(element) ? 1 : 0);
  }

  function isMathLike(element) {
    return (
      element.matches('.katex, .katex-display, mjx-container, .MathJax, math') ||
      !!element.querySelector('.katex-mathml annotation, annotation, mjx-assistive-mml')
    );
  }

  function buildPayload(element) {
    const latex = extractLatex(element);
    const equation = extractEquationText(element);
    return {
      latex,
      markdown: latex ? wrapMarkdownMath(latex, isDisplayMath(element)) : '',
      equation,
    };
  }

  function extractLatex(element) {
    // Most renderers keep the original TeX in hidden MathML or assistive markup.
    const annotation = element.querySelector('annotation[encoding="application/x-tex"], annotation');
    if (annotation && annotation.textContent.trim()) {
      return cleanLatex(annotation.textContent);
    }

    const katexMathml = element.querySelector('.katex-mathml annotation');
    if (katexMathml && katexMathml.textContent.trim()) {
      return cleanLatex(katexMathml.textContent);
    }

    const script = element.querySelector('script[type^="math/tex"]');
    if (script && script.textContent.trim()) {
      return cleanLatex(script.textContent);
    }

    const ariaLatex = [
      element.getAttribute('data-latex'),
      element.getAttribute('data-tex'),
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
    ].find(Boolean);
    if (ariaLatex) {
      const cleaned = cleanLatex(ariaLatex);
      if (looksLikeLatex(cleaned)) {
        return cleaned;
      }
    }

    const nearbyCode = findNearbySourceCode(element);
    if (nearbyCode) {
      return nearbyCode;
    }

    return '';
  }

  function cleanLatex(value) {
    return value.replace(/^\s+|\s+$/g, '').replace(/^\$\$?/, '').replace(/\$\$?$/, '').trim();
  }

  function looksLikeLatex(value) {
    return /\\[A-Za-z]+|[_^{}]|\\\(|\\\)|\\\[|\\\]/.test(value);
  }

  function findNearbySourceCode(element) {
    const container = element.closest('p, li, div, section, article');
    if (!container) {
      return '';
    }

    const codeNodes = Array.from(container.querySelectorAll('code'));
    for (const codeNode of codeNodes) {
      const text = codeNode.textContent.trim();
      const extracted = extractMathFromMarkdown(text);
      if (extracted) {
        return extracted;
      }
    }

    const markdownMatch = extractMathFromMarkdown(container.textContent || '');
    return markdownMatch || '';
  }

  function extractMathFromMarkdown(text) {
    if (!text) {
      return '';
    }

    const display = text.match(/\$\$([\s\S]+?)\$\$/);
    if (display) {
      return cleanLatex(display[1]);
    }

    const inline = text.match(/(^|[^$])\$([^$\n]+?)\$(?!\$)/);
    if (inline) {
      return cleanLatex(inline[2]);
    }

    const bracket = text.match(/\\\[([\s\S]+?)\\\]/);
    if (bracket) {
      return cleanLatex(bracket[1]);
    }

    const paren = text.match(/\\\(([\s\S]+?)\\\)/);
    if (paren) {
      return cleanLatex(paren[1]);
    }

    return '';
  }

  function extractEquationText(element) {
    const clone = element.cloneNode(true);

    clone.querySelectorAll('.katex-mathml, .MJX_Assistive_MathML, mjx-assistive-mml, script, style, annotation').forEach((node) => {
      node.remove();
    });

    const text = (clone.innerText || clone.textContent || '')
      .replace(/\s+/g, ' ')
      .replace(/\u200b/g, '')
      .trim();

    return text;
  }

  function isDisplayMath(element) {
    return (
      element.matches('.katex-display') ||
      element.getAttribute('display') === 'block' ||
      window.getComputedStyle(element).display === 'block'
    );
  }

  function wrapMarkdownMath(latex, displayMode) {
    return displayMode ? `$$\n${latex}\n$$` : `$${latex}$`;
  }

  function showToolbar(rect, payload) {
    const toolbar = ensureToolbar();
    toolbar.dataset.visible = 'true';

    toolbar.querySelector('[data-kind="latex"]').disabled = !payload.latex;
    toolbar.querySelector('[data-kind="markdown"]').disabled = !payload.markdown;
    toolbar.querySelector('[data-kind="equation"]').disabled = !payload.equation;

    positionToolbar(rect);
  }

  function hideToolbar() {
    if (!STATE.toolbar) {
      return;
    }

    STATE.toolbar.dataset.visible = 'false';
    STATE.activeEquation = null;
    STATE.activePayload = null;
    setStatus('');
  }

  function repositionToolbar() {
    if (!STATE.toolbar || STATE.toolbar.dataset.visible !== 'true' || !STATE.activeEquation) {
      return;
    }

    positionToolbar(STATE.activeEquation.getBoundingClientRect());
  }

  function positionToolbar(targetRect) {
    const toolbar = ensureToolbar();
    const margin = 10;

    toolbar.style.left = '0px';
    toolbar.style.top = '0px';

    const toolbarRect = toolbar.getBoundingClientRect();
    let top = targetRect.top - toolbarRect.height - margin;
    if (top < margin) {
      top = targetRect.bottom + margin;
    }

    let left = targetRect.left + (targetRect.width - toolbarRect.width) / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - toolbarRect.width - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - toolbarRect.height - margin));

    toolbar.style.left = `${Math.round(left)}px`;
    toolbar.style.top = `${Math.round(top)}px`;
  }

  async function copyText(text) {
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text, 'text');
        return true;
      }
    } catch {
      // Ignore and fall through to the Clipboard API.
    }

    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();

    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }

    textarea.remove();
    return ok;
  }

  init();
})();
