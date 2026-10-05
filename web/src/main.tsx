import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './lib/api';
import { RequireRole, useMe } from './lib/session';
import { FullPageSpinner, ToastProvider } from './components/ui';
import { LoginPage, ResetPasswordPage } from './pages/Auth';
import './styles.css';

// Each app is code-split so a guard's phone never downloads the admin portal, and vice versa.
const ResidentApp = lazy(() => import('./apps/resident/ResidentApp'));
const GuardApp = lazy(() => import('./apps/guard/GuardApp'));
const AdminApp = lazy(() => import('./apps/admin/AdminApp'));
const PlatformApp = lazy(() => import('./apps/platform/PlatformApp'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      networkMode: 'offlineFirst',
    },
    mutations: { networkMode: 'always' },
  },
});

function Home() {
  const { data, isLoading } = useMe();
  if (isLoading) return <FullPageSpinner />;
  return <Navigate to={data ? data.home : '/login'} replace />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Suspense fallback={<FullPageSpinner />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/app/*" element={<RequireRole roles={['resident']}><ResidentApp /></RequireRole>} />
              <Route path="/guard/*" element={<RequireRole roles={['guard']}><GuardApp /></RequireRole>} />
              <Route path="/admin/*" element={<RequireRole roles={['admin', 'facility_manager']}><AdminApp /></RequireRole>} />
              <Route path="/platform/*" element={<RequireRole roles={['super_admin']}><PlatformApp /></RequireRole>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
