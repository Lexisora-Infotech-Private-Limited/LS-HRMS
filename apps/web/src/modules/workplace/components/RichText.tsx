import { useEffect, useRef } from 'react';

export type RteTool = 'B' | 'I' | 'H2' | 'Link' | 'List' | 'Numbered';

/**
 * Small contentEditable editor (wireframe toolbar B / I / H2 / Link / List). The server
 * sanitises the HTML to the allowlist (p, br, strong, em, h2, ul, ol, li, a, img).
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write here…',
  tools = ['B', 'I', 'H2', 'Link', 'List'],
  minHeight,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  tools?: RteTool[];
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Initialise once (and when the value is replaced from outside, e.g. opening another record).
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value && document.activeElement !== el) el.innerHTML = value;
  }, [value]);

  const emit = () => {
    const html = ref.current?.innerHTML ?? '';
    onChange(html === '<br>' ? '' : html);
  };
  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };
  const run: Record<RteTool, () => void> = {
    B: () => exec('bold'),
    I: () => exec('italic'),
    H2: () => exec('formatBlock', 'h2'),
    List: () => exec('insertUnorderedList'),
    Numbered: () => exec('insertOrderedList'),
    Link: () => {
      const url = window.prompt('Link address (https://…)');
      if (url && /^(https?:\/\/|mailto:)/i.test(url.trim())) exec('createLink', url.trim());
    },
  };
  const label: Record<RteTool, JSX.Element | string> = { B: <b>B</b>, I: <i>I</i>, H2: 'H2', Link: 'Link', List: 'List', Numbered: '1.' };

  return (
    <div className="wp-rte">
      <div className="wp-rte-bar" role="toolbar" aria-label="Formatting">
        {tools.map((t) => (
          <button key={t} type="button" title={t} onMouseDown={(e) => e.preventDefault()} onClick={run[t]}>
            {label[t]}
          </button>
        ))}
      </div>
      <div
        ref={ref}
        className="wp-rte-body"
        contentEditable
        role="textbox"
        aria-multiline
        data-placeholder={placeholder}
        style={minHeight ? { minHeight } : undefined}
        onInput={emit}
        onBlur={emit}
        onPaste={(e) => {
          // Paste as plain text; formatting comes from the toolbar.
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        }}
        suppressContentEditableWarning
      />
    </div>
  );
}

/** Server-sanitised HTML (notice/feed bodies). */
export function SafeHtml({ html }: { html: string }) {
  return <div className="wp-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Plain text of editor HTML (for "is it empty?" checks). */
export function htmlText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
