-- pageEvents + pageEventsDaily: privacy-first analytics for published pages.
--
-- Drizzle-kit's `generate` added a lot of phantom CREATE/ALTER statements
-- because the meta snapshots are out of sync with the actual DB (the team
-- has been using `db:push` for prior schema changes, which doesn't update
-- snapshots). This file is hand-trimmed to contain ONLY the real diff —
-- the two new tables plus their FKs and indexes. Apply via psql or via
-- `npm run db:push -- --force` (which uses the live schema, not this SQL).

CREATE TABLE "pageEvents" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"type" text NOT NULL,
	"href" text,
	"linkLabel" text,
	"referrer" text,
	"country" text,
	"device" text,
	"browser" text,
	"uaHash" text,
	"ts" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pageEventsDaily" (
	"projectId" text NOT NULL,
	"day" date NOT NULL,
	"type" text NOT NULL,
	"href" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"device" text DEFAULT '' NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"uniques" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pageEventsDaily_projectId_day_type_href_country_device_pk" PRIMARY KEY("projectId","day","type","href","country","device")
);
--> statement-breakpoint
ALTER TABLE "pageEvents" ADD CONSTRAINT "pageEvents_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pageEventsDaily" ADD CONSTRAINT "pageEventsDaily_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "pageEvents_projectId_ts_idx" ON "pageEvents" USING btree ("projectId","ts");
--> statement-breakpoint
CREATE INDEX "pageEvents_projectId_type_ts_idx" ON "pageEvents" USING btree ("projectId","type","ts");
--> statement-breakpoint
CREATE INDEX "pageEventsDaily_projectId_day_idx" ON "pageEventsDaily" USING btree ("projectId","day");
