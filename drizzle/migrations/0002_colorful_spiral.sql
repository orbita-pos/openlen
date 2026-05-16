CREATE TABLE "rateLimitEvents" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
CREATE INDEX "rateLimitEvents_key_createdAt_idx" ON "rateLimitEvents" USING btree ("key","createdAt");