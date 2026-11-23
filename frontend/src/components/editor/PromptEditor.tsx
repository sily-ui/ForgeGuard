import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import 'monaco-editor/min/vs/editor/editor.main.css';

// 使用本地打包的 monaco 并显式引入其 CSS：默认 CDN 加载在受限网络下可能只加载 JS 而缺失
// 样式，导致编辑器内部的 ime-textarea / edit-context 裸露成多余的输入框。
(globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};
loader.config({ monaco });

interface Props {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  height?: number | string;
  readOnly?: boolean;
  placeholder?: string;
}

// Monaco 编辑器：系统提示词 / JSON 编排。
export function PromptEditor({ value, onChange, language = 'markdown', height = 220, readOnly = false }: Props) {
  return (
    <div style={{ border: '1px solid var(--bb-border)', borderRadius: 8, overflow: 'hidden' }}>
      <Editor
        height={height}
        language={language}
        theme="light"
        value={value}
        onChange={(v) => onChange(v ?? '')}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 15,
          fontFamily: "'JetBrains Mono', Consolas, monospace",
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          padding: { top: 16, bottom: 16 },
          renderLineHighlight: 'line',
          automaticLayout: true,
          tabSize: 2,
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
          overviewRulerLanes: 0,
        }}
        loading={<div style={{ padding: 24, color: 'var(--bb-text-3)', fontSize: 14 }}>编辑器加载中…</div>}
      />
    </div>
  );
}