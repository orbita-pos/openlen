CREATE TABLE "bookableServices" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"durationMin" integer NOT NULL,
	"slotIncrementMin" integer DEFAULT 0 NOT NULL,
	"bufferBeforeMin" integer DEFAULT 0 NOT NULL,
	"bufferAfterMin" integer DEFAULT 0 NOT NULL,
	"minLeadTimeMin" integer DEFAULT 0 NOT NULL,
	"maxDaysAhead" integer DEFAULT 30 NOT NULL,
	"creatorTz" text NOT NULL,
	"weeklyHours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"exceptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"priceDisplay" text,
	"locationText" text,
	"status" text DEFAULT 'active' NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookingEvents" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"bookingId" text NOT NULL,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"detail" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"serviceId" text NOT NULL,
	"startUtc" timestamp with time zone NOT NULL,
	"endUtc" timestamp with time zone NOT NULL,
	"seatNo" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"memberId" text,
	"guestName" text,
	"guestEmail" text,
	"note" text,
	"creatorTz" text NOT NULL,
	"visitorTz" text,
	"rescheduledFromId" text,
	"rescheduledToId" text,
	"reminderStage" integer DEFAULT 0 NOT NULL,
	"icsSequence" integer DEFAULT 0 NOT NULL,
	"cancelledAt" timestamp with time zone,
	"cid" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcastRecipients" (
	"id" text PRIMARY KEY NOT NULL,
	"broadcastId" text NOT NULL,
	"memberId" text,
	"email" text NOT NULL,
	"status" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"audienceCount" integer,
	"sentCount" integer,
	"failedCount" integer,
	"failureReason" text,
	"sentAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businessProfiles" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chatAgentInviteTokens" (
	"tokenHash" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"email" text NOT NULL,
	"expires" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chatAgents" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"userId" text,
	"invitedEmail" text NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"acceptedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "chatConversations" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"aUserId" text NOT NULL,
	"bUserId" text NOT NULL,
	"lastMessageAt" timestamp,
	"aReadAt" timestamp,
	"bReadAt" timestamp,
	"assignedUserId" text,
	"assignedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chatEvents" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"chatUserId" text,
	"type" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chatMessages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversationId" text NOT NULL,
	"authorId" text NOT NULL,
	"body" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"readAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "chatSessions" (
	"tokenHash" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"chatUserId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"lastSeenAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chatUsers" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"username" text NOT NULL,
	"passwordHash" text,
	"email" text,
	"memberId" text,
	"displayName" text,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"lastSeenAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "collection_items" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"collectionId" text NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"description" text,
	"imageUrl" text,
	"priceDisplay" text,
	"badge" text,
	"ctaLabel" text,
	"ctaUrl" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"attrs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"preset" text DEFAULT 'products' NOT NULL,
	"layout" text DEFAULT 'grid' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customDomains" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"domain" text NOT NULL,
	"verificationToken" text NOT NULL,
	"verifiedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customDomains_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "emailSuppressions" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"email" text NOT NULL,
	"reason" text DEFAULT 'unsubscribed' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flightReports" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"subdomain" text NOT NULL,
	"releaseSha" text NOT NULL,
	"perfScore" integer,
	"a11yScore" integer,
	"bpScore" integer,
	"seoScore" integer,
	"lcpMs" integer,
	"cls" real,
	"tbtMs" integer,
	"fcpMs" integer,
	"speedIndexMs" integer,
	"totalBytes" integer,
	"requestCount" integer,
	"details" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberAuthEvents" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"memberId" text,
	"email" text,
	"type" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberLoginTokens" (
	"tokenHash" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"email" text NOT NULL,
	"slug" text,
	"expires" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberSessions" (
	"tokenHash" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"memberId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"lastSeenAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"family" text NOT NULL,
	"author" text DEFAULT 'OpenLen' NOT NULL,
	"pitch" text NOT NULL,
	"description" text NOT NULL,
	"storageKey" text NOT NULL,
	"storageUrl" text NOT NULL,
	"contentHash" text NOT NULL,
	"size" integer NOT NULL,
	"sceneSpec" jsonb,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"license" text DEFAULT 'cc0' NOT NULL,
	"thumbnailUrl" text,
	"tileUrl" text,
	"previewImageUrl" text,
	"featured" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"publishedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "notificationDeliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"eventType" text NOT NULL,
	"conversationId" text,
	"detail" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notificationJobs" (
	"id" text PRIMARY KEY NOT NULL,
	"dedupeKey" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"runAfter" timestamp DEFAULT now() NOT NULL,
	"lastError" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notificationPreferences" (
	"userId" text PRIMARY KEY NOT NULL,
	"webPushEnabled" boolean DEFAULT true NOT NULL,
	"emailEnabled" boolean DEFAULT true NOT NULL,
	"quietFrom" text,
	"quietUntil" text,
	"timezone" text DEFAULT 'America/Lima' NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processedWebhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"receivedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projectDeployments" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"provider" text NOT NULL,
	"remoteName" text NOT NULL,
	"liveUrl" text,
	"lastDeployedAt" timestamp,
	"lastDeploySha" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projectTranslations" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"locale" text NOT NULL,
	"entries" jsonb NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pushSubscriptions" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"userAgent" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"lastUsedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"variantLabel" text NOT NULL,
	"rootTag" text NOT NULL,
	"mode" text DEFAULT 'light' NOT NULL,
	"storageKey" text NOT NULL,
	"storageUrl" text NOT NULL,
	"contentHash" text NOT NULL,
	"size" integer NOT NULL,
	"designTokens" jsonb,
	"fonts" jsonb,
	"needsJs" boolean DEFAULT false NOT NULL,
	"hasPlaceholders" boolean DEFAULT false NOT NULL,
	"thumbnailUrl" text,
	"status" text DEFAULT 'published' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"publishedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "siteComments" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"page" text,
	"memberId" text,
	"authorName" text,
	"authorEmail" text,
	"body" text NOT NULL,
	"parentId" text,
	"status" text DEFAULT 'hidden' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "siteMembers" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"lastLoginAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "userConnections" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"provider" text NOT NULL,
	"accessToken" text NOT NULL,
	"refreshToken" text,
	"accountLabel" text,
	"teamId" text,
	"scope" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pageEvents" ADD COLUMN "page" text;--> statement-breakpoint
ALTER TABLE "pageEvents" ADD COLUMN "cid" text;--> statement-breakpoint
ALTER TABLE "pageEvents" ADD COLUMN "source" jsonb;--> statement-breakpoint
ALTER TABLE "projectChatMessages" ADD COLUMN "page" text;--> statement-breakpoint
ALTER TABLE "projectVersions" ADD COLUMN "page" text;--> statement-breakpoint
ALTER TABLE "projectVersions" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "logoUrl" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "profileId" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "publishedPagesHash" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "pages" jsonb;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "thumbnailUrl" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "tileUrl" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "screenshotUrl" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "polarCustomerId" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "polarSubscriptionId" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subscriptionStatus" text;--> statement-breakpoint
ALTER TABLE "bookableServices" ADD CONSTRAINT "bookableServices_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookingEvents" ADD CONSTRAINT "bookingEvents_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_serviceId_bookableServices_id_fk" FOREIGN KEY ("serviceId") REFERENCES "public"."bookableServices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcastRecipients" ADD CONSTRAINT "broadcastRecipients_broadcastId_broadcasts_id_fk" FOREIGN KEY ("broadcastId") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businessProfiles" ADD CONSTRAINT "businessProfiles_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatAgentInviteTokens" ADD CONSTRAINT "chatAgentInviteTokens_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatAgents" ADD CONSTRAINT "chatAgents_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatAgents" ADD CONSTRAINT "chatAgents_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatConversations" ADD CONSTRAINT "chatConversations_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatConversations" ADD CONSTRAINT "chatConversations_assignedUserId_users_id_fk" FOREIGN KEY ("assignedUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatEvents" ADD CONSTRAINT "chatEvents_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatMessages" ADD CONSTRAINT "chatMessages_conversationId_chatConversations_id_fk" FOREIGN KEY ("conversationId") REFERENCES "public"."chatConversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatSessions" ADD CONSTRAINT "chatSessions_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatSessions" ADD CONSTRAINT "chatSessions_chatUserId_chatUsers_id_fk" FOREIGN KEY ("chatUserId") REFERENCES "public"."chatUsers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatUsers" ADD CONSTRAINT "chatUsers_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collectionId_collections_id_fk" FOREIGN KEY ("collectionId") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customDomains" ADD CONSTRAINT "customDomains_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emailSuppressions" ADD CONSTRAINT "emailSuppressions_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flightReports" ADD CONSTRAINT "flightReports_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberAuthEvents" ADD CONSTRAINT "memberAuthEvents_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberLoginTokens" ADD CONSTRAINT "memberLoginTokens_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberSessions" ADD CONSTRAINT "memberSessions_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberSessions" ADD CONSTRAINT "memberSessions_memberId_siteMembers_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."siteMembers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificationPreferences" ADD CONSTRAINT "notificationPreferences_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projectDeployments" ADD CONSTRAINT "projectDeployments_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projectTranslations" ADD CONSTRAINT "projectTranslations_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pushSubscriptions" ADD CONSTRAINT "pushSubscriptions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteComments" ADD CONSTRAINT "siteComments_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteMembers" ADD CONSTRAINT "siteMembers_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userConnections" ADD CONSTRAINT "userConnections_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookableServices_projectId_idx" ON "bookableServices" USING btree ("projectId","status");--> statement-breakpoint
CREATE INDEX "bookingEvents_bookingId_idx" ON "bookingEvents" USING btree ("bookingId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_slot_uq" ON "bookings" USING btree ("serviceId","startUtc","seatNo") WHERE status in ('confirmed','pending');--> statement-breakpoint
CREATE INDEX "bookings_projectId_startUtc_idx" ON "bookings" USING btree ("projectId","startUtc");--> statement-breakpoint
CREATE INDEX "bookings_serviceId_startUtc_idx" ON "bookings" USING btree ("serviceId","startUtc");--> statement-breakpoint
CREATE INDEX "bookings_status_startUtc_idx" ON "bookings" USING btree ("status","startUtc");--> statement-breakpoint
CREATE INDEX "broadcastRecipients_broadcastId_idx" ON "broadcastRecipients" USING btree ("broadcastId");--> statement-breakpoint
CREATE INDEX "broadcasts_projectId_createdAt_idx" ON "broadcasts" USING btree ("projectId","createdAt");--> statement-breakpoint
CREATE INDEX "businessProfiles_userId_idx" ON "businessProfiles" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "businessProfiles_userId_default_uq" ON "businessProfiles" USING btree ("userId") WHERE "isDefault";--> statement-breakpoint
CREATE UNIQUE INDEX "chatAgents_projectId_email_uq" ON "chatAgents" USING btree ("projectId","invitedEmail");--> statement-breakpoint
CREATE INDEX "chatAgents_userId_idx" ON "chatAgents" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "chatConversations_pair_uq" ON "chatConversations" USING btree ("projectId","aUserId","bUserId");--> statement-breakpoint
CREATE INDEX "chatConversations_a_idx" ON "chatConversations" USING btree ("aUserId");--> statement-breakpoint
CREATE INDEX "chatConversations_b_idx" ON "chatConversations" USING btree ("bUserId");--> statement-breakpoint
CREATE INDEX "chatEvents_projectId_createdAt_idx" ON "chatEvents" USING btree ("projectId","createdAt");--> statement-breakpoint
CREATE INDEX "chatMessages_conversation_created_idx" ON "chatMessages" USING btree ("conversationId","createdAt");--> statement-breakpoint
CREATE INDEX "chatSessions_chatUserId_idx" ON "chatSessions" USING btree ("chatUserId");--> statement-breakpoint
CREATE UNIQUE INDEX "chatUsers_projectId_username_uq" ON "chatUsers" USING btree ("projectId","username");--> statement-breakpoint
CREATE UNIQUE INDEX "chatUsers_projectId_memberId_uq" ON "chatUsers" USING btree ("projectId","memberId");--> statement-breakpoint
CREATE INDEX "collection_items_collectionId_idx" ON "collection_items" USING btree ("collectionId","sortOrder");--> statement-breakpoint
CREATE INDEX "collection_items_projectId_idx" ON "collection_items" USING btree ("projectId","status");--> statement-breakpoint
CREATE INDEX "collections_projectId_idx" ON "collections" USING btree ("projectId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_project_active_uq" ON "collections" USING btree ("projectId") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "customDomains_projectId_idx" ON "customDomains" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "customDomains_verifiedAt_idx" ON "customDomains" USING btree ("verifiedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "emailSuppressions_projectId_email_uq" ON "emailSuppressions" USING btree ("projectId","email");--> statement-breakpoint
CREATE INDEX "flightReports_projectId_createdAt_idx" ON "flightReports" USING btree ("projectId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "flightReports_projectId_releaseSha_idx" ON "flightReports" USING btree ("projectId","releaseSha");--> statement-breakpoint
CREATE INDEX "memberAuthEvents_projectId_createdAt_idx" ON "memberAuthEvents" USING btree ("projectId","createdAt");--> statement-breakpoint
CREATE INDEX "memberSessions_memberId_idx" ON "memberSessions" USING btree ("memberId");--> statement-breakpoint
CREATE INDEX "models_status_family_idx" ON "models" USING btree ("status","family");--> statement-breakpoint
CREATE INDEX "notificationDeliveries_userId_createdAt_idx" ON "notificationDeliveries" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "notificationJobs_status_runAfter_idx" ON "notificationJobs" USING btree ("status","runAfter");--> statement-breakpoint
CREATE UNIQUE INDEX "projectDeployments_projectId_provider_idx" ON "projectDeployments" USING btree ("projectId","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "projectTranslations_projectId_locale_idx" ON "projectTranslations" USING btree ("projectId","locale");--> statement-breakpoint
CREATE INDEX "pushSubscriptions_userId_idx" ON "pushSubscriptions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "sections_status_type_idx" ON "sections" USING btree ("status","type");--> statement-breakpoint
CREATE INDEX "siteComments_projectId_page_createdAt_idx" ON "siteComments" USING btree ("projectId","page","createdAt");--> statement-breakpoint
CREATE INDEX "siteComments_projectId_status_idx" ON "siteComments" USING btree ("projectId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "siteMembers_projectId_email_uq" ON "siteMembers" USING btree ("projectId","email");--> statement-breakpoint
CREATE UNIQUE INDEX "userConnections_userId_provider_idx" ON "userConnections" USING btree ("userId","provider");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_profileId_businessProfiles_id_fk" FOREIGN KEY ("profileId") REFERENCES "public"."businessProfiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pageEvents_projectId_cid_idx" ON "pageEvents" USING btree ("projectId","cid");