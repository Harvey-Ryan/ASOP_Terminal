// Community corrections on the website (v1.53.0): the live list, the viewer's
// role, and the "Corrected · Game files" choice (kept in this browser).
// Rules: packages/shared/src/corrections.ts.

import { useMemo, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { correctionIndex, type ApiResponse, type CorrectionRoleDto, type GameBuildDto, type LiveCorrectionsDto } from '@dem/shared';
import { api, ApiError } from '../api/client';

export type DataView = 'corrected' | 'files';
const KEY = 'asop.dataView';
const listeners = new Set<() => void>();

function read(): DataView {
  try { return localStorage.getItem(KEY) === 'files' ? 'files' : 'corrected'; } catch { return 'corrected'; }
}

export function setDataView(v: DataView): void {
  try { localStorage.setItem(KEY, v); } catch { /* private mode: this tab only */ }
  current = v;
  listeners.forEach((l) => l());
}
let current: DataView = read();

/** Corrected values (default) or the game files as they are. */
export function useDataView(): DataView {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current, () => 'corrected');
}

export function useLiveCorrections() {
  const q = useQuery({
    queryKey: ['corrections', 'live'],
    queryFn: async () => (await api.get<ApiResponse<LiveCorrectionsDto>>('/corrections/live')).data!,
    staleTime: 60_000,
  });
  const index = useMemo(() => correctionIndex(q.data?.corrections ?? []), [q.data]);
  return { ...q, index };
}

export function useCorrectionRole() {
  return useQuery({
    queryKey: ['corrections', 'role'],
    queryFn: async () => (await api.get<ApiResponse<CorrectionRoleDto>>('/corrections/role')).data!,
    staleTime: 5 * 60_000,
  });
}

export function useGameBuild() {
  return useQuery({
    queryKey: ['game-tools', 'build'],
    queryFn: async () => (await api.get<ApiResponse<GameBuildDto>>('/game-tools/build')).data!,
    staleTime: 10 * 60_000,
  });
}

/** Upload a screenshot; returns its /uploads/corrections/… address. */
export async function uploadEvidence(file: File): Promise<string> {
  const form = new FormData();
  form.append('image', file);
  const res = await fetch('/api/corrections/evidence', { method: 'POST', credentials: 'include', body: form });
  const body = (await res.json().catch(() => ({}))) as ApiResponse<{ url: string }>;
  if (!res.ok || !body.data) throw new ApiError(res.status, body.error ?? `Upload failed (${res.status})`, res.headers.get('X-Request-Id'));
  return body.data.url;
}
