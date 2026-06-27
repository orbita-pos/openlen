export interface NotificationEvent {
  type: "chat_message";
  projectId: string;
  conversationId: string;
  recipientUserId: string;
  senderName: string;
  preview: string;
}

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
