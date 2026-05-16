// Auth.js v5 mounts both GET and POST under this catch-all route.
// `handlers` is an object { GET, POST } created in /auth.ts.
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
