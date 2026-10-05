import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ApiError, get, post } from './api';
import { cacheClear } from './offline';
import { FullPageSpinner } from '../components/ui';

export type Role = 'super_admin' | 'admin' | 'facility_manager' | 'resident' | 'guard';

export interface Me {
  user: { id: string; fullName: string; mobile: string; email: string | null; photoUrl: string | null };
  role: Role;
  home: string;
  society: { id: string; name: string; code: string; city: string; state: string; hasLogo: boolean } | null;
  flats: { id: string; number: string; unit_code: string; tower_name: string; relation: string; is_primary: boolean; move_in_date: string | null }[];
  gates: { id: string; name: string }[];
  defaultGateId: string | null;
  memberships: { societyId: string | null; societyName: string; role: Role }[];
}

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await get<Me>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  });
}

/** Signed-in user, guaranteed by <RequireRole>. */
export function useSession(): Me {
  const { data } = useMe();
  return data!;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { data, isLoading, error } = useMe();
  const loc = useLocation();
  if (isLoading) return <FullPageSpinner />;
  if (error && !data) return <FullPageSpinner label="Reconnecting…" />;
  if (!data) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (!roles.includes(data.role)) return <Navigate to={data.home} replace />;
  return <>{children}</>;
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await post('/auth/logout').catch(() => {});
    cacheClear();
    qc.clear();
    window.location.href = '/login';
  };
}
