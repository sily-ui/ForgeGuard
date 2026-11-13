import Editor from '@monaco-editor/react';
import { useUiStore } from '@/stores/uiStore';

interface Props {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  height?: number | string;
  readOnly?: boolean;
  placeholder?: string;
}

// Monaco 编辑器：系统提示词 / JSON 编排，双空间主题。
export function PromptEditor({ value, onChange, language = 'markdown', height = 220, readOnly = false }: Props) {
  const space = useUiStore((s) => s.space);
  const lab = space === 'lab';
  return (
    <div style={{ border: '1px solid var(--fg-border)', borderRadius: 10, overflow: 'hidden' }}>
      <Editor
        height={height}
        language={language}
        theme={lab ? 'vs-dark' : 'light'}
        value={value}
        onChange={(v) => onChange(v ?? '')}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "'JetBrains Mono', Consolas, monospace",
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          padding: { top: 12, bottom: 12 },
          renderLineHighlight: 'line',
          automaticLayout: true,
          tabSize: 2,
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
          overviewRulerLanes: 0,
        }}
        loading={<div style={{ padding: 20, color: 'var(--fg-text-3)', fontSize: 12 }}>编辑器加载中…</div>}
      />
    </div>
  );
}