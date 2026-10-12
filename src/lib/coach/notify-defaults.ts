// お知らせの設定の既定（行がない利用者）。DB の notification_prefs の既定と同じ（4.27）
export const DEFAULT_PREFS = { email_mode: "weekly_and_behind", push_mode: "weekly_and_behind", behind_weekday: 3 } as const;
