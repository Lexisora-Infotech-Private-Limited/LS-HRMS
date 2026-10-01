import { useEffect, useRef, useState } from 'react';
import { fileUrl, uploadFile } from '@/lib/api';
import { useToast } from '@/lib/toast';

export type RteTool = 'B' | 'I' | 'H2' | 'Link' | 'Image' | 'List' | 'Numbered';

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
  variant = 'boxed',
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  tools?: RteTool[];
  minHeight?: number;
  /** "plain": the feed composer look (chip toolbar, no outer box). */
  variant?: 'boxed' | 'plain';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const saved = useRef<Range | null>(null);
  const [uploading, setUploading] = useState(false);
  const { toastError } = useToast();
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
  const saveSelection = () => {
    const sel = window.getSelection();
    saved.current = sel && sel.rangeCount && ref.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
  };
  const restoreSelection = () => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    if (saved.current) sel.addRange(saved.current);
    else {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel.addRange(r);
    }
  };
  async function insertImage(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) return toastError(new Error('Images must be PNG, JPG or WebP'));
    if (file.size > 5 * 1024 * 1024) return toastError(new Error('Images can be up to 5 MB'));
    setUploading(true);
    try {
      const f = await uploadFile(file, 'feed');
      restoreSelection();
      document.execCommand('insertImage', false, fileUrl(f.id) ?? f.url);
      emit();
    } catch (e) {
      toastError(e);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  const run: Record<RteTool, () => void> = {
    B: () => exec('bold'),
    I: () => exec('italic'),
    H2: () => exec('formatBlock', 'h2'),
    // List: bullets; pressing it again inside a bulleted list switches to a numbered list.
    List: () => exec(document.queryCommandState('insertUnorderedList') ? 'insertOrderedList' : 'insertUnorderedList'),
    Numbered: () => exec('insertOrderedList'),
    Link: () => {
      const url = window.prompt('Link address (https://…)');
      if (url && /^(https?:\/\/|mailto:)/i.test(url.trim())) exec('createLink', url.trim());
    },
    Image: () => {
      saveSelection();
      fileRef.current?.click();
    },
  };
  const label: Record<RteTool, JSX.Element | string> = { B: <b>B</b>, I: <i>I</i>, H2: 'H2', Link: 'Link', Image: uploading ? 'Uploading…' : 'Image', List: 'List', Numbered: '1.' };
  const title: Record<RteTool, string> = { B: 'Bold', I: 'Italic', H2: 'Heading', Link: 'Link', Image: 'Insert image (PNG, JPG or WebP, up to 5 MB)', List: 'List (press again for a numbered list)', Numbered: 'Numbered list' };

  return (
    <div className={variant === 'plain' ? 'wp-rte wp-rte-plain' : 'wp-rte'}>
      <div className="wp-rte-bar" role="toolbar" aria-label="Formatting">
        {tools.map((t) => (
          <button key={t} type="button" title={title[t]} aria-label={title[t]} disabled={t === 'Image' && uploading} onMouseDown={(e) => e.preventDefault()} onClick={run[t]}>
            {label[t]}
          </button>
        ))}
        {tools.includes('Image') && <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void insertImage(e.target.files?.[0])} />}
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
