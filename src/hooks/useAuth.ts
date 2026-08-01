import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { LOGIN_PATH } from "@/const";

/**
 * YABUZ OIL & GAS — auth hook
 * Wraps trpc.auth.me with redirects, logout and permission helpers.
 */
export function useAuth(options?: { redirectOnUnauthenticated?: boolean; redirectPath?: string }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const me = trpc.auth.me.useQuery(undefined, {
    staleTime: 60_000,
    retry: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSettled: async () => {
      await utils.auth.me.invalidate();
      navigate(LOGIN_PATH);
    },
  });

  const user = me.data?.user ?? null;
  const permissions = useMemo(() => new Set(me.data?.permissions ?? []), [me.data?.permissions]);
  const isAuthenticated = !!user;

  // Redirect unauthenticated viewers when requested.
  if (options?.redirectOnUnauthenticated && !me.isLoading && !isAuthenticated) {
    navigate(options.redirectPath ?? LOGIN_PATH, { replace: true });
  }

  const hasPermission = useCallback((key: string) => permissions.has(key), [permissions]);
  const hasAnyPermission = useCallback(
    (keys: string[]) => keys.some((k) => permissions.has(k)),
    [permissions],
  );

  return {
    user,
    permissions,
    isAuthenticated,
    isLoading: me.isLoading,
    hasPermission,
    hasAnyPermission,
    logout: () => logoutMutation.mutate(),
    isLoggingOut: logoutMutation.isPending,
    refresh: () => utils.auth.me.invalidate(),
  };
}
