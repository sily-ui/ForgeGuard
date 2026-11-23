import { useEffect } from 'react';
import { App, Modal } from 'antd';
import { ExclamationCircleFilled } from '@ant-design/icons';

interface Options {
  title: string;
  content?: string;
  okText?: string;
  danger?: boolean;
  onOk: () => void | Promise<unknown>;
}

// 静态 Modal.confirm 不消费 ConfigProvider 主题（深色舱会渲染成浅色），改用 App 上下文 modal。
let contextConfirm: typeof Modal.confirm | null = null;

export function ConfirmModalBridge() {
  const { modal } = App.useApp();
  useEffect(() => {
    contextConfirm = modal.confirm;
    return () => {
      if (contextConfirm === modal.confirm) contextConfirm = null;
    };
  }, [modal]);
  return null;
}

// 二次确认：回收、清理、终止等不可逆操作统一走此入口。
export function confirmAction({ title, content, okText = '确认', danger = true, onOk }: Options) {
  const confirm = contextConfirm ?? Modal.confirm;
  confirm({
    title,
    icon: <ExclamationCircleFilled style={{ color: danger ? 'var(--bb-block)' : 'var(--bb-observe)' }} />,
    content,
    okText,
    cancelText: '取消',
    okButtonProps: { danger },
    onOk,
    centered: true,
  });
}