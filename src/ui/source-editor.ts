import { EditorView, lineNumbers, highlightActiveLine, keymap, Decoration, DecorationSet, hoverTooltip, Tooltip } from '@codemirror/view';
import { EditorState, StateEffect, StateField, RangeSetBuilder, Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';

/** Effect to set the highlighted line numbers (1-indexed) */
const setHighlightedLines = StateEffect.define<number[]>();

const lineHighlightDeco = Decoration.line({ class: 'rdf-src-highlight' });

const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setHighlightedLines)) {
        const builder = new RangeSetBuilder<Decoration>();
        const lines = [...effect.value].sort((a, b) => a - b);
        for (const lineNo of lines) {
          if (lineNo >= 1 && lineNo <= tr.state.doc.lines) {
            const line = tr.state.doc.line(lineNo);
            builder.add(line.from, line.from, lineHighlightDeco);
          }
        }
        deco = builder.finish();
      }
    }
    return deco;
  },
  provide: f => EditorView.decorations.from(f)
});

export interface SourceEditorCallbacks {
  /** Called (debounced) when the user edits the document */
  onChange: (content: string) => void;
  /**
   * Called when the user hovers a prefixed term (e.g. foaf:Person).
   * Return a DOM element to show as tooltip, or null for no tooltip.
   */
  onTermHover?: (prefix: string, local: string, ns: string | null) => Promise<HTMLElement | null>;
}

/** Extract @prefix / PREFIX declarations from a Turtle document */
export function extractPrefixDecls(content: string): Record<string, string> {
  const prefixes: Record<string, string> = {};
  const re = /(?:@prefix|PREFIX)\s+([\w.-]*):\s*<([^>]*)>/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    prefixes[m[1]] = m[2];
  }
  return prefixes;
}

/**
 * A CodeMirror 6 source editor for Turtle/JSON-LD with line highlighting,
 * used in the split Source ↔ Graph view.
 */
export class RDFSourceEditor {
  private view: EditorView;
  private changeTimer: number | null = null;
  private suppressChange = false;

  constructor(parent: HTMLElement, initialContent: string, callbacks: SourceEditorCallbacks) {
    const extensions: Extension[] = [
      lineNumbers(),
      history(),
      highlightActiveLine(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      highlightField,
      EditorView.lineWrapping,
      // Hover tooltip on prefixed names (foaf:Person, oso:Platform, ...)
      hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
        if (!callbacks.onTermHover) return null;

        const line = view.state.doc.lineAt(pos);
        const text = line.text;
        const col = pos - line.from;

        // Find a prefixed-name token spanning the hover position
        const re = /([A-Za-z][\w.-]*)?:([\w.-]*)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          const start = m.index;
          const end = start + m[0].length;
          if (col >= start && col <= end) {
            // Skip URLs (http://...)
            if (/^https?$/i.test(m[1] || '')) return null;
            const prefix = m[1] || '';
            const local = m[2] || '';
            const prefixes = extractPrefixDecls(view.state.doc.toString());
            const ns = prefixes[prefix] || null;

            const dom = await callbacks.onTermHover(prefix, local, ns);
            if (!dom) return null;

            return {
              pos: line.from + start,
              end: line.from + end,
              above: true,
              create: () => ({ dom })
            };
          }
        }
        return null;
      }, { hoverTime: 400 }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '12px' },
        '.cm-scroller': { fontFamily: 'var(--font-monospace)', overflow: 'auto' },
        '.cm-content': { caretColor: 'var(--text-normal)' },
        '.cm-gutters': {
          backgroundColor: 'var(--background-secondary)',
          color: 'var(--text-faint)',
          border: 'none'
        }
      }),
      EditorView.updateListener.of(update => {
        if (update.docChanged && !this.suppressChange) {
          if (this.changeTimer !== null) window.clearTimeout(this.changeTimer);
          this.changeTimer = window.setTimeout(() => {
            callbacks.onChange(this.getContent());
          }, 600);
        }
      })
    ];

    this.view = new EditorView({
      state: EditorState.create({ doc: initialContent, extensions }),
      parent
    });
  }

  getContent(): string {
    return this.view.state.doc.toString();
  }

  /** Replace the whole document without triggering onChange */
  setContent(content: string) {
    this.suppressChange = true;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: content }
    });
    this.suppressChange = false;
  }

  /**
   * Highlight the given 1-indexed lines and scroll the first one into view.
   * Pass an empty array to clear.
   */
  highlightLines(lines: number[]) {
    this.view.dispatch({ effects: setHighlightedLines.of(lines) });
    if (lines.length > 0) {
      const first = Math.min(...lines);
      if (first >= 1 && first <= this.view.state.doc.lines) {
        const pos = this.view.state.doc.line(first).from;
        this.view.dispatch({
          effects: EditorView.scrollIntoView(pos, { y: 'center' })
        });
      }
    }
  }

  /**
   * Find all 1-indexed line numbers containing any of the given tokens.
   */
  findLinesContaining(tokens: string[]): number[] {
    const doc = this.view.state.doc;
    const result: number[] = [];
    const nonEmpty = tokens.filter(t => t.length > 0);
    if (nonEmpty.length === 0) return result;

    for (let i = 1; i <= doc.lines; i++) {
      const text = doc.line(i).text;
      if (nonEmpty.some(t => text.includes(t))) {
        result.push(i);
      }
    }
    return result;
  }

  /** Insert text at the current cursor position */
  insertAtCursor(text: string) {
    const pos = this.view.state.selection.main.head;
    this.view.dispatch({
      changes: { from: pos, insert: text },
      selection: { anchor: pos + text.length }
    });
    this.view.focus();
  }

  /**
   * Ensure a @prefix declaration exists; insert it at the top if missing.
   * Returns true if a declaration was added.
   */
  ensurePrefix(prefix: string, ns: string): boolean {
    const content = this.getContent();
    const existing = extractPrefixDecls(content);
    if (existing[prefix]) return false;

    const decl = `@prefix ${prefix}: <${ns}> .\n`;
    this.view.dispatch({
      changes: { from: 0, insert: decl }
    });
    return true;
  }

  focus() {
    this.view.focus();
  }

  destroy() {
    if (this.changeTimer !== null) window.clearTimeout(this.changeTimer);
    this.view.destroy();
  }
}
