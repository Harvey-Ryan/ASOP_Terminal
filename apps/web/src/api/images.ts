import { api, ApiError } from './client';
import type { ApiResponse, ServerImageDto } from '@dem/shared';

export const imagesApi = {
  list: (guildId: string) =>
    api.get<ApiResponse<ServerImageDto[]>>(`/guilds/${guildId}/images`).then((r) => r.data!),

  delete: (guildId: string, imageId: string) =>
    api.delete<ApiResponse>(`/guilds/${guildId}/images/${imageId}`).then(() => undefined),

  reorder: (guildId: string, ids: string[]) =>
    api.put<ApiResponse>(`/guilds/${guildId}/images/reorder`, { ids }).then(() => undefined),

  upload: async (guildId: string, file: File): Promise<ServerImageDto> => {
    const form = new FormData();
    form.append('image', file);
    // Use raw fetch — the api client always JSON-stringifies, which breaks multipart
    const res = await fetch(`/api/guilds/${guildId}/images`, {
      method: 'POST',
      credentials: 'include',
      body: form,
      // No Content-Type header — browser sets it with the correct boundary automatically
    });
    const body: ApiResponse<ServerImageDto> = await res.json().catch(() => ({ error: `HTTP ${res.status}` } as ApiResponse));
    if (!res.ok) throw new ApiError(res.status, body.error ?? `Upload failed (${res.status})`);
    return body.data!;
  },
};
