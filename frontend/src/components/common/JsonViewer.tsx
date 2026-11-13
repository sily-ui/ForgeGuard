import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';

interface Props {
  data: unknown;
  maxHeight?: number;
  collapsed?: boolean;
}

// 轻量 JSON 取证视图：等宽字体、可折叠、可复制，避免引入重型编辑器。
export function JsonViewer({ data, maxHeight = 280, collapsed = false }: Props) {
  const space = useUiStore((s) => s.space);
  const lab = space === 'lab';
  const [open, setOpen] = useState(!collapsed);
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => {
    try {
      return JSON.stringify(data ?? {}, null, 2);
    } catch {
      return String(data);
    }
  }, [data]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* 剪贴板不可用时静默 */
    }
  };

  return (
    <div
      style={{
        border: '1px solid var(--fg-border)',
        borderRadius: 8,
        background: lab ? '#0d1a20' : '#f7faf9',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '5px 10px',
          borderBottom: open ? '1px solid var(--fg-border)' : 'none',
          background: lab ? '#16242b' : '#eef3f1',
        }}
      >
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--fg-text-2)',
            fontSize: 11,
            fontWeight: 600,
            padding: 0,
          }}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="mono">JSON</span>
        </button>
        <button
          onClick={copy}
          title="复制"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? 'var(--fg-allow)' : 'var(--fg-text-3)', display: 'inline-flex', padding: 2 }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      {open && (
        <pre
          className="mono"
          style={{
            margin: 0,
            padding: '10px 12px',
            maxHeight,
            overflow: 'auto',
            fontSize: 11.5,
            lineHeight: 1.6,
            color: lab ? '#cfe0db' : '#2c3e3b',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {text}
        </pre>
      )}
    </div>
  );
}