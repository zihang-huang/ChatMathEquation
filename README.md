# ChatMathEquation

`ChatMathEquation` is a Tampermonkey userscript that helps you copy equations from AI chat interfaces such as ChatGPT, Gemini, and Claude.

<img width="765" height="314" alt="image" src="https://github.com/user-attachments/assets/d602a081-0b18-4f5e-a720-3dfaa5bd2987" />

When you select a rendered equation with your mouse, the script shows a floating toolbar near the equation. From that toolbar, you can copy:

- The original LaTeX source when it is available in the page DOM
- Markdown math syntax such as `$...$` or `$$...$$`
- The visible rendered equation text

## Features

- Works on common AI chat sites with rendered math
- Detects KaTeX, MathJax, MathML, and similar equation markup
- Shows a floating copy toolbar above or below the selected equation
- Uses multiple clipboard strategies for better browser compatibility

## Supported Sites

The current script metadata includes these matches:

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`
- `https://gemini.google.com/*`
- `https://claude.ai/*`
- `https://*.openai.com/*`

You can expand the `@match` entries later if you want the script to run on more sites.

## Installation

1. Install a userscript manager such as Tampermonkey.
2. Open Tampermonkey and create a new script.
3. Replace the default template with the contents of `tampermonkey-equation-copy.user.js`.
4. Save the script.
5. Open or refresh ChatGPT, Gemini, Claude, or another matched site.

## Usage

1. Open a page containing a rendered math equation.
2. Use your mouse to select part of the rendered equation.
3. A floating toolbar will appear near the equation.
4. Click one of the buttons:

- `Copy LaTeX`
- `Copy Markdown`
- `Copy Equation`

If the page exposes the original TeX source, `Copy LaTeX` and `Copy Markdown` will use that source. If not, those options may be unavailable.

## How It Extracts Equations

The script tries these sources in order:

1. Hidden MathML or annotation nodes that store TeX
2. KaTeX or MathJax assistive markup
3. Data attributes such as `data-latex`, `data-tex`, `aria-label`, or `title`
4. Nearby code or markdown text as a fallback

## Limitations

- Some sites do not preserve the original LaTeX in the DOM after rendering.
- In those cases, `Copy LaTeX` may not be available.
- `Copy Equation` depends on the rendered text being extractable from the visible equation markup.
- Site DOM changes may require selector updates in the future.

