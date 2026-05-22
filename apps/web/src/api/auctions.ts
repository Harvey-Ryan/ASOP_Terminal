import { api } from './client';
import type { ApiResponse, AuctionDto } from '@dem/shared';

export const auctionsApi = {
  list: (guildId: string) =>
    api.get<ApiResponse<AuctionDto[]>>(`/guilds/${guildId}/auctions`).then((r) => r.data ?? []),

  create: (
    guildId: string,
    body: { title: string; description?: string; durationSecs?: number },
  ) =>
    api
      .post<ApiResponse<AuctionDto>>(`/guilds/${guildId}/auctions`, body)
      .then((r) => r.data!),

  placeBid: (guildId: string, auctionId: string, body: { maxBid: number }) =>
    api
      .post<ApiResponse<AuctionDto>>(`/guilds/${guildId}/auctions/${auctionId}/bid`, body)
      .then((r) => r.data!),

  close: (guildId: string, auctionId: string) =>
    api
      .post<ApiResponse<AuctionDto>>(`/guilds/${guildId}/auctions/${auctionId}/close`, {})
      .then((r) => r.data!),

  cancel: (guildId: string, auctionId: string) =>
    api.delete<ApiResponse>(`/guilds/${guildId}/auctions/${auctionId}`).then((r) => r),
};
