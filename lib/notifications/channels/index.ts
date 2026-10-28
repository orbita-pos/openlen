import { webPushChannel } from "./webpush";
import { emailChannel } from "./email";
import { fcmChannel } from "./fcm";
import type { NotificationChannel } from "../types";

export { webPushChannel } from "./webpush";
export { emailChannel } from "./email";

export const CHANNELS: NotificationChannel[] = [webPushChannel, fcmChannel, emailChannel];
