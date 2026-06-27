import { webPushChannel } from "./webpush";
import { emailChannel } from "./email";
import type { NotificationChannel } from "../types";

export { webPushChannel } from "./webpush";
export { emailChannel } from "./email";

export const CHANNELS: NotificationChannel[] = [webPushChannel, emailChannel];
