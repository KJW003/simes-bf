import { useQuery } from '@tanstack/react-query';

const BASE = (import.meta.env.VITE_API_URL as string) ?? '';

/**
 * Pings the API /health endpoint periodically.
 * Returns { isOnline, latencyMs, lastChecked }.
 */
export function useApiHealth(intervalMs = 30_000) {
  const { data, isError } = useQuery({
    queryKey: ['api-health'],
    queryFn: async () => {
      const start = performance.now();
      const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5_000) });
      const latencyMs = Math.round(performance.now() - start);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { isOnline: true, latencyMs, lastChecked: new Date().toISOString() };
    },
    refetchInterval: intervalMs,
    retry: 1,
    staleTime: intervalMs,
  });

  return {
    isOnline: !isError && !!data?.isOnline,
    latencyMs: data?.latencyMs ?? null,
    lastChecked: data?.lastChecked ?? null,
  };
}
