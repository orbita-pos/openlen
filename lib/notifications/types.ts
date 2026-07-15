export interface ChatMessageEvent {
  type: "chat_message";
  projectId: string;
  conversationId: string;
  recipientUserId: string;
  senderName: string;
  preview: string;
}

export interface LiveSheetBrokenEvent {
  type: "live_sheet_broken";
  projectId: string;
  recipientUserId: string;
  sheetUrl: string;
  /** 0 = the sheet stopped returning rows entirely ("dejó de leerse"). */
  missingCount: number;
}

export type NotificationEvent = ChatMessageEvent | LiveSheetBrokenEvent;

export interface NotificationPrefs {
  webPushEnabled: boolean;
  emailEnabled: boolean;
  quietFrom: string | null;
  quietUntil: string | null;
  timezone: string;
}

export type DeliveryResult = "sent" | "skipped" | "failed";

export interface NotificationChannel {
  id: "webpush" | "email";
  isEnabled(prefs: NotificationPrefs): boolean;
  send(event: NotificationEvent): Promise<DeliveryResult>;
}
