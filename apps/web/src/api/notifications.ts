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
};
