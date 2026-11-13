import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { ConfigProvider } from 'antd';
import { Portal } from '@antv/x6-react-shape';
import { AntdProvider } from '@/theme/antdTheme';
import { App } from '@/app/App';
import { ConfirmModalBridge } from '@/components/common/confirmAction';
import '@/theme/global.css';

// X6 React 节点经 Portal 渲染进应用 React 树，避免每节点 createRoot/unmount 的同步卸载竞态。
const X6PortalProvider = Portal.getProvider();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 15000,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ConfigProvider locale={zhCN}>
          <AntdProvider>
            <AntdApp>
              <X6PortalProvider />
              <ConfirmModalBridge />
              <App />
            </AntdApp>
          </AntdProvider>
        </ConfigProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);