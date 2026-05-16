ALTER TABLE "projects" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deployUrl" text;--> statement-breakpoint
CREATE INDEX "projects_userId_status_idx" ON "projects" USING btree ("userId","status");