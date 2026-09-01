import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

// Prism's own CodeMirror skin. Every colour comes from a CSS variable so the
// editor sits inside the window's material instead of on top of it: no panel,
// no border, no second background. The token colours are fixed (index.css says
// why); everything structural follows the active style.

const chrome = EditorView.theme(
  {
    '&': {
      height: '100%',
      width: '100%',
      color: 'var(--p-text-soft)',
      backgroundColor: 'transparent',
      fontSize: '13px'
    },
    '.cm-scroller': {
      fontFamily: "'Cascadia Mono', 'Consolas', ui-monospace, monospace",
      lineHeight: '1.55',
      overflow: 'auto'
    },
    // The scroller holds focus while nobody is editing, so that the arrows can
    // scroll it. That is plumbing, not a state worth drawing: Chromium's ring
    // around the whole document frame has to go.
    '.cm-scroller:focus, .cm-scroller:focus-visible': { outline: 'none' },
    '.cm-content': { padding: '18px 0', caretColor: 'var(--p-accent-hi)' },
    '.cm-line': { padding: '0 18px' },

    // A viewer that happens to be editable: the caret only shows once the
    // editor actually has focus, so an unfocused file reads as a document.
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--p-accent-hi)', borderLeftWidth: '2px' },
    '&:not(.cm-focused) .cm-cursor': { display: 'none' },
    '&.cm-focused, &:focus, &:focus-visible': { outline: 'none' },

    '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--p-code-sel)' },
    '&.cm-focused .cm-selectionBackground, &.cm-focused ::selection': {
      backgroundColor: 'color-mix(in srgb, var(--p-accent) 55%, transparent)'
    },
    '.cm-activeLine': { backgroundColor: 'var(--p-code-active-line)' },
    '&:not(.cm-focused) .cm-activeLine': { backgroundColor: 'transparent' },

    // --p-dim, not --p-dim2: the theme generates dim2 against a 3.2:1 target,
    // which is fine for a label beside something else and not fine for line
    // numbers you actually read. dim is generated against 4.5:1.
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--p-dim)',
      border: 'none',
      paddingRight: '4px'
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--p-text-soft)' },
    '&:not(.cm-focused) .cm-activeLineGutter': { color: 'var(--p-dim)' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 18px', minWidth: '38px' },
    // Fold arrows are chrome, and chrome fades when it isn't needed: they only
    // appear once the pointer is over the gutter they belong to.
    '.cm-foldGutter .cm-gutterElement': {
      color: 'var(--p-dim2)',
      cursor: 'pointer',
      opacity: '0',
      transition: 'opacity 120ms ease'
    },
    '.cm-gutters:hover .cm-foldGutter .cm-gutterElement': { opacity: '1' },
    '.cm-foldGutter .cm-gutterElement:hover': { color: 'var(--p-text)' },
    '.cm-foldPlaceholder': {
      background: 'var(--p-hover)',
      border: '1px solid var(--p-line)',
      borderRadius: '3px',
      color: 'var(--p-dim)',
      padding: '0 5px',
      margin: '0 2px'
    },

    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'var(--p-hover)',
      outline: '1px solid var(--p-line)',
      color: 'inherit'
    },
    '.cm-nonmatchingBracket': { color: 'var(--p-code-invalid)' },

    // Search. CodeMirror's panel is the app's furniture here, so it takes the
    // top bar's surface and the same quiet controls, not its own stock look.
    '.cm-panels': {
      backgroundColor: 'var(--p-title)',
      color: 'var(--p-text)',
      borderTop: '1px solid var(--p-divider)'
    },
    '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--p-divider)' },
    '.cm-panel.cm-search': {
      padding: '9px 12px',
      fontFamily: 'var(--p-font-ui)',
      fontSize: '12px',
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '6px'
    },
    '.cm-panel.cm-search br': { display: 'none' },
    '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
      fontFamily: 'var(--p-font-ui)',
      fontSize: '12px',
      margin: '0'
    },
    '.cm-panel.cm-search label': { color: 'var(--p-dim)', display: 'inline-flex', alignItems: 'center', gap: '4px' },
    // Checkboxes take the accent rather than Chromium's blue.
    '.cm-panel.cm-search input[type=checkbox]': { accentColor: 'var(--p-accent)' },
    // Both selectors on purpose: CodeMirror's base theme styles these by class
    // (.cm-textfield / .cm-button), and only a class beats a class.
    // Ctrl+G's panel is a `cm-dialog`, not a `cm-search`, and without these it
    // renders a stock browser input in the middle of a styled app (2026-08-31).
    '.cm-panel.cm-dialog': { padding: '6px 8px' },
    '.cm-panel.cm-dialog input[type=text], .cm-panel.cm-dialog .cm-textfield': {
      background: 'var(--p-bg)',
      border: '1px solid var(--p-line)',
      borderRadius: '999px',
      color: 'var(--p-text)',
      outline: 'none',
      padding: '4px 10px',
      minWidth: '120px'
    },
    '.cm-panel.cm-dialog input[type=text]:focus, .cm-panel.cm-dialog .cm-textfield:focus': {
      borderColor: 'var(--p-accent-hi)',
      outline: 'none',
      boxShadow: 'none'
    },
    '.cm-panel.cm-dialog button:not([name=close]), .cm-panel.cm-dialog .cm-button': {
      background: 'transparent',
      backgroundImage: 'none',
      border: '1px solid var(--p-line)',
      borderRadius: '999px',
      color: 'var(--p-text-soft)',
      padding: '3px 10px'
    },
    '.cm-panel.cm-search input[type=text], .cm-panel.cm-search .cm-textfield': {
      background: 'var(--p-bg)',
      border: '1px solid var(--p-line)',
      borderRadius: '999px',
      color: 'var(--p-text)',
      outline: 'none',
      padding: '4px 10px',
      minWidth: '160px'
    },
    '.cm-panel.cm-search input[type=text]:focus, .cm-panel.cm-search .cm-textfield:focus': {
      borderColor: 'var(--p-accent-hi)',
      outline: 'none',
      boxShadow: 'none'
    },
    '.cm-panel.cm-search button:not([name=close]), .cm-panel.cm-search .cm-button': {
      background: 'transparent',
      backgroundImage: 'none',
      border: '1px solid var(--p-line)',
      borderRadius: '999px',
      color: 'var(--p-text-soft)',
      cursor: 'pointer',
      padding: '4px 11px'
    },
    '.cm-panel.cm-search button:not([name=close]):hover, .cm-panel.cm-search .cm-button:hover': {
      background: 'var(--p-hover)',
      backgroundImage: 'none',
      color: 'var(--p-text)'
    },
    '.cm-panel.cm-search .cm-button:active': { backgroundImage: 'none' },
    '.cm-panel.cm-search button[name=close]': {
      background: 'transparent',
      border: 'none',
      color: 'var(--p-dim)',
      cursor: 'pointer',
      fontSize: '16px',
      padding: '0 6px'
    },
    '.cm-panel.cm-search button[name=close]:hover': { color: 'var(--p-text)' },
    '.cm-searchMatch': { backgroundColor: 'var(--p-code-match)', borderRadius: '2px' },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'color-mix(in srgb, var(--p-accent) 75%, transparent)'
    },

    // The squiggle. Wavy underline in the error colour, nothing in the gutter:
    // a viewer points at the problem, it doesn't file a report.
    '.cm-lintRange-error': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--p-code-invalid)',
      textUnderlineOffset: '3px',
      textDecorationSkipInk: 'none'
    },
    '.cm-lint-marker': { display: 'none' },
    '.cm-tooltip': {
      background: 'var(--p-side-flat)',
      border: '1px solid var(--p-line)',
      borderRadius: '6px',
      color: 'var(--p-text)'
    },
    '.cm-tooltip.cm-tooltip-lint': {
      fontFamily: 'var(--p-font-ui)',
      fontSize: '12px',
      maxWidth: '420px',
      padding: '2px 4px'
    },
    '.cm-diagnostic': { borderLeft: 'none', padding: '4px 8px' },
    '.cm-diagnostic-error': { borderLeft: '2px solid var(--p-code-invalid)' }
  },
  { dark: true }
)

const tokens = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--p-code-comment)', fontStyle: 'italic' },
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword], color: 'var(--p-code-keyword)' },
  { tag: [t.modifier, t.self, t.null, t.atom, t.bool], color: 'var(--p-code-const)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.escape], color: 'var(--p-code-string)' },
  { tag: [t.number, t.integer, t.float, t.unit], color: 'var(--p-code-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--p-code-fn)' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: 'var(--p-code-type)' },
  { tag: [t.constant(t.variableName), t.standard(t.variableName), t.labelName], color: 'var(--p-code-const)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--p-text-soft)' },
  { tag: [t.variableName, t.definition(t.variableName)], color: 'var(--p-text)' },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator, t.derefOperator], color: 'var(--p-code-op)' },
  { tag: [t.meta, t.processingInstruction, t.annotation, t.documentMeta], color: 'var(--p-code-meta)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--p-code-keyword)' },
  { tag: [t.attributeValue], color: 'var(--p-code-string)' },
  { tag: t.link, color: 'var(--p-code-fn)', textDecoration: 'underline' },
  { tag: t.heading, color: 'var(--p-text)', fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '600', color: 'var(--p-text)' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.monospace, color: 'var(--p-code-string)' },
  { tag: [t.inserted], color: 'var(--p-code-string)' },
  { tag: [t.deleted], color: 'var(--p-code-invalid)' },
  { tag: [t.invalid], color: 'var(--p-code-invalid)' }
])

export const prismCodeTheme = [chrome, syntaxHighlighting(tokens)]
