import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { MainLayout } from '@/components/layout/MainLayout';
import { LabLayout } from '@/components/layout/LabLayout';
import { useAuthStore } from '@/stores/authStore';
import { Logo } from '@/components/common/Logo';
import { AppTour } from '@/components/tour/AppTour';
import { TourLauncher } from '@/components/tour/TourLauncher';

const PortalPage = lazy(() => import('@/features/portal/PortalPage'));
const WorkspacePage = lazy(() => import('@/features/workspace/WorkspacePage'));
const OrchestrationPage = lazy(() => import('@/features/orchestration/OrchestrationPage'));
const InstancesPage = lazy(() => import('@/features/instances/InstancesPage'));
const PoliciesPage = lazy(() => import('@/features/policies/PoliciesPage'));
const ConsolePage = lazy(() => import('@/features/console/ConsolePage'));
const ExperimentPage = lazy(() => import('@/features/experiments/ExperimentPage'));
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'));
const ReportDetailPage = lazy(() => import('@/features/reports/ReportDetailPage'));

function PageLoader() {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <Logo size={44} />
      <Spin />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();
  if (status !== 'authenticated') {
    return <Navigate to="/portal" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <>
      <Suspense fallback={<PageLoader />}>
        <Routes>
        <Route path="/portal" element={<PortalPage />} />
        <Route
          element={
            <RequireAuth>
              <MainLayout />
            </RequireAuth>
          }
        >
          <Route path="/workspace" element={<WorkspacePage />} />
          <Route path="/orchestration" element={<OrchestrationPage />} />
          <Route path="/instances" element={<InstancesPage />} />
          <Route path="/policies/:instanceId" element={<PoliciesPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/reports/:reportId" element={<ReportDetailPage />} />
        </Route>
        <Route
          element={
            <RequireAuth>
              <LabLayout />
            </RequireAuth>
          }
        >
          <Route path="/console/:sessionId" element={<ConsolePage />} />
          <Route path="/experiments/:pairId" element={<ExperimentPage />} />
        </Route>
        <Route path="/" element={<Navigate to="/workspace" replace />} />
        <Route path="*" element={<Navigate to="/workspace" replace />} />
      </Routes>
      </Suspense>
      <AppTour />
      <TourLauncher />
    </>
  );
}