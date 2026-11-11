import { api } from './client';
import type { ApiResponse, UserNotificationPrefsDto, UpdateNotificationPrefsBody } from '@dem/shared';

export const notificationsApi = {
  getPrefs: () =>
    api
      .get<ApiResponse<UserNotificationPrefsDto>>('/notifications/prefs')
      .then((r) => r.data!),

  updatePrefs: (body: UpdateNotificationPrefsBody) =>
    api
      .put<ApiResponse<UserNotificationPrefsDto>>('/notifications/prefs', body)
      .then((r) => r.data!),

  /** The secret in your calendar feed link (v1.16.0); made on first ask. */
  getCalendarToken: () =>
    api.get<ApiResponse<{ token: string }>>('/me/calendar').then((r) => r.data!.token),

  resetCalendarToken: () =>
    api.post<ApiResponse<{ token: string }>>('/me/calendar/reset').then((r) => r.data!.token),
};
