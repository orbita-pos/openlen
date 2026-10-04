// GENERADO por scripts/backend-vendor-gotrue.ts — no editar a mano.
// Las migraciones del esquema `auth` de GoTrue, tal cual: https://github.com/supabase/auth/tree/ce9a8eee0cc042be8c7a42981a7ddae631e41d91/migrations
// Licencia MIT (Copyright (c) 2021-2025 Supabase <support@supabase.com>). `{{ index .Options "Namespace" }}` es el
// esquema donde se aplican; lo sustituye lib/backend/schema.ts.

export const GOTRUE_SHA = "ce9a8eee0cc042be8c7a42981a7ddae631e41d91";

export const GOTRUE_MIGRATIONS: ReadonlyArray<{ readonly version: string; readonly name: string; readonly sql: string }> = [
 {
  "version": "00",
  "name": "00_init_auth_schema.up.sql",
  "sql": "-- auth.users definition\n\nCREATE TABLE IF NOT EXISTS {{ index .Options \"Namespace\" }}.users (\n\tinstance_id uuid NULL,\n\tid uuid NOT NULL UNIQUE,\n\taud varchar(255) NULL,\n\t\"role\" varchar(255) NULL,\n\temail varchar(255) NULL UNIQUE,\n\tencrypted_password varchar(255) NULL,\n\tconfirmed_at timestamptz NULL,\n\tinvited_at timestamptz NULL,\n\tconfirmation_token varchar(255) NULL,\n\tconfirmation_sent_at timestamptz NULL,\n\trecovery_token varchar(255) NULL,\n\trecovery_sent_at timestamptz NULL,\n\temail_change_token varchar(255) NULL,\n\temail_change varchar(255) NULL,\n\temail_change_sent_at timestamptz NULL,\n\tlast_sign_in_at timestamptz NULL,\n\traw_app_meta_data jsonb NULL,\n\traw_user_meta_data jsonb NULL,\n\tis_super_admin bool NULL,\n\tcreated_at timestamptz NULL,\n\tupdated_at timestamptz NULL,\n\tCONSTRAINT users_pkey PRIMARY KEY (id)\n);\nCREATE INDEX IF NOT EXISTS users_instance_id_email_idx ON {{ index .Options \"Namespace\" }}.users USING btree (instance_id, email);\nCREATE INDEX IF NOT EXISTS users_instance_id_idx ON {{ index .Options \"Namespace\" }}.users USING btree (instance_id);\ncomment on table {{ index .Options \"Namespace\" }}.users is 'Auth: Stores user login data within a secure schema.';\n\n-- auth.refresh_tokens definition\n\nCREATE TABLE IF NOT EXISTS {{ index .Options \"Namespace\" }}.refresh_tokens (\n\tinstance_id uuid NULL,\n\tid bigserial NOT NULL,\n\t\"token\" varchar(255) NULL,\n\tuser_id varchar(255) NULL,\n\trevoked bool NULL,\n\tcreated_at timestamptz NULL,\n\tupdated_at timestamptz NULL,\n\tCONSTRAINT refresh_tokens_pkey PRIMARY KEY (id)\n);\nCREATE INDEX IF NOT EXISTS refresh_tokens_instance_id_idx ON {{ index .Options \"Namespace\" }}.refresh_tokens USING btree (instance_id);\nCREATE INDEX IF NOT EXISTS refresh_tokens_instance_id_user_id_idx ON {{ index .Options \"Namespace\" }}.refresh_tokens USING btree (instance_id, user_id);\nCREATE INDEX IF NOT EXISTS refresh_tokens_token_idx ON {{ index .Options \"Namespace\" }}.refresh_tokens USING btree (token);\ncomment on table {{ index .Options \"Namespace\" }}.refresh_tokens is 'Auth: Store of tokens used to refresh JWT tokens once they expire.';\n\n-- auth.instances definition\n\nCREATE TABLE IF NOT EXISTS {{ index .Options \"Namespace\" }}.instances (\n\tid uuid NOT NULL,\n\tuuid uuid NULL,\n\traw_base_config text NULL,\n\tcreated_at timestamptz NULL,\n\tupdated_at timestamptz NULL,\n\tCONSTRAINT instances_pkey PRIMARY KEY (id)\n);\ncomment on table {{ index .Options \"Namespace\" }}.instances is 'Auth: Manages users across multiple sites.';\n\n-- auth.audit_log_entries definition\n\nCREATE TABLE IF NOT EXISTS {{ index .Options \"Namespace\" }}.audit_log_entries (\n\tinstance_id uuid NULL,\n\tid uuid NOT NULL,\n\tpayload json NULL,\n\tcreated_at timestamptz NULL,\n\tCONSTRAINT audit_log_entries_pkey PRIMARY KEY (id)\n);\nCREATE INDEX IF NOT EXISTS audit_logs_instance_id_idx ON {{ index .Options \"Namespace\" }}.audit_log_entries USING btree (instance_id);\ncomment on table {{ index .Options \"Namespace\" }}.audit_log_entries is 'Auth: Audit trail for user actions.';\n\n-- auth.schema_migrations definition\n\nCREATE TABLE IF NOT EXISTS {{ index .Options \"Namespace\" }}.schema_migrations (\n\t\"version\" varchar(255) NOT NULL,\n\tCONSTRAINT schema_migrations_pkey PRIMARY KEY (\"version\")\n);\ncomment on table {{ index .Options \"Namespace\" }}.schema_migrations is 'Auth: Manages updates to the auth system.';\n\t\t\n-- Gets the User ID from the request cookie\ncreate or replace function {{ index .Options \"Namespace\" }}.uid() returns uuid as $$\n  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;\n$$ language sql stable;\n\n-- Gets the User ID from the request cookie\ncreate or replace function {{ index .Options \"Namespace\" }}.role() returns text as $$\n  select nullif(current_setting('request.jwt.claim.role', true), '')::text;\n$$ language sql stable;\n"
 },
 {
  "version": "20210710035447",
  "name": "20210710035447_alter_users.up.sql",
  "sql": "-- alter user schema\n\nALTER TABLE {{ index .Options \"Namespace\" }}.users \nADD COLUMN IF NOT EXISTS phone VARCHAR(15) NULL UNIQUE DEFAULT NULL,\nADD COLUMN IF NOT EXISTS phone_confirmed_at timestamptz NULL DEFAULT NULL,\nADD COLUMN IF NOT EXISTS phone_change VARCHAR(15) NULL DEFAULT '',\nADD COLUMN IF NOT EXISTS phone_change_token VARCHAR(255) NULL DEFAULT '',\nADD COLUMN IF NOT EXISTS phone_change_sent_at timestamptz NULL DEFAULT NULL;\n\nDO $$\nBEGIN\n  IF NOT EXISTS(SELECT *\n    FROM information_schema.columns\n    WHERE table_schema = '{{ index .Options \"Namespace\" }}' and table_name='users' and column_name='email_confirmed_at')\n  THEN\n      ALTER TABLE \"{{ index .Options \"Namespace\" }}\".\"users\" RENAME COLUMN \"confirmed_at\" TO \"email_confirmed_at\";\n  END IF;\nEND $$;\n\n"
 },
 {
  "version": "20210722035447",
  "name": "20210722035447_adds_confirmed_at.up.sql",
  "sql": "-- adds confirmed at\n\nALTER TABLE {{ index .Options \"Namespace\" }}.users\nADD COLUMN IF NOT EXISTS confirmed_at timestamptz GENERATED ALWAYS AS (LEAST (users.email_confirmed_at, users.phone_confirmed_at)) STORED;\n"
 },
 {
  "version": "20210730183235",
  "name": "20210730183235_add_email_change_confirmed.up.sql",
  "sql": "-- adds email_change_confirmed\n\nALTER TABLE {{ index .Options \"Namespace\" }}.users\nADD COLUMN IF NOT EXISTS email_change_token_current varchar(255) null DEFAULT '', \nADD COLUMN IF NOT EXISTS email_change_confirm_status smallint DEFAULT 0 CHECK (email_change_confirm_status >= 0 AND email_change_confirm_status <= 2);\n\nDO $$\nBEGIN\n  IF NOT EXISTS(SELECT *\n    FROM information_schema.columns\n    WHERE table_schema = '{{ index .Options \"Namespace\" }}' and table_name='users' and column_name='email_change_token_new')\n  THEN\n      ALTER TABLE \"{{ index .Options \"Namespace\" }}\".\"users\" RENAME COLUMN \"email_change_token\" TO \"email_change_token_new\";\n  END IF;\nEND $$;\n"
 },
 {
  "version": "20210909172000",
  "name": "20210909172000_create_identities_table.up.sql",
  "sql": "-- adds identities table \n\nCREATE TABLE IF NOT EXISTS {{ index .Options \"Namespace\" }}.identities (\n    id text NOT NULL,\n    user_id uuid NOT NULL,\n    identity_data JSONB NOT NULL,\n    provider text NOT NULL,\n    last_sign_in_at timestamptz NULL,\n    created_at timestamptz NULL,\n    updated_at timestamptz NULL,\n    CONSTRAINT identities_pkey PRIMARY KEY (provider, id),\n    CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES {{ index .Options \"Namespace\" }}.users(id) ON DELETE CASCADE\n);\nCOMMENT ON TABLE {{ index .Options \"Namespace\" }}.identities is 'Auth: Stores identities associated to a user.';\n"
 },
 {
  "version": "20210927181326",
  "name": "20210927181326_add_refresh_token_parent.up.sql",
  "sql": "-- adds parent column\n\nALTER TABLE {{ index .Options \"Namespace\" }}.refresh_tokens\nADD COLUMN IF NOT EXISTS parent varchar(255) NULL;\n\nDO $$\nBEGIN\n  IF NOT EXISTS(SELECT *\n    FROM information_schema.constraint_column_usage\n    WHERE table_schema = '{{ index .Options \"Namespace\" }}' and table_name='refresh_tokens' and constraint_name='refresh_tokens_token_unique')\n  THEN\n      ALTER TABLE \"{{ index .Options \"Namespace\" }}\".\"refresh_tokens\" ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (\"token\");\n  END IF;\n\n  IF NOT EXISTS(SELECT *\n    FROM information_schema.constraint_column_usage\n    WHERE table_schema = '{{ index .Options \"Namespace\" }}' and table_name='refresh_tokens' and constraint_name='refresh_tokens_parent_fkey')\n  THEN\n      ALTER TABLE \"{{ index .Options \"Namespace\" }}\".\"refresh_tokens\" ADD CONSTRAINT refresh_tokens_parent_fkey FOREIGN KEY (parent) REFERENCES {{ index .Options \"Namespace\" }}.refresh_tokens(\"token\");\n  END IF;\n\n  CREATE INDEX IF NOT EXISTS refresh_tokens_parent_idx ON \"{{ index .Options \"Namespace\" }}\".\"refresh_tokens\" USING btree (parent);\nEND $$;\n\n"
 },
 {
  "version": "20211122151130",
  "name": "20211122151130_create_user_id_idx.up.sql",
  "sql": "-- create index on identities.user_id\n\nCREATE INDEX IF NOT EXISTS identities_user_id_idx ON \"{{ index .Options \"Namespace\" }}\".identities using btree (user_id);\n"
 },
 {
  "version": "20211124214934",
  "name": "20211124214934_update_auth_functions.up.sql",
  "sql": "-- update auth functions\n\ncreate or replace function {{ index .Options \"Namespace\" }}.uid() \nreturns uuid \nlanguage sql stable\nas $$\n  select \n  coalesce(\n    current_setting('request.jwt.claim.sub', true),\n    (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')\n  )::uuid\n$$;\n\ncreate or replace function {{ index .Options \"Namespace\" }}.role() \nreturns text \nlanguage sql stable\nas $$\n  select \n  coalesce(\n    current_setting('request.jwt.claim.role', true),\n    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')\n  )::text\n$$;\n\ncreate or replace function {{ index .Options \"Namespace\" }}.email() \nreturns text \nlanguage sql stable\nas $$\n  select \n  coalesce(\n    current_setting('request.jwt.claim.email', true),\n    (current_setting('request.jwt.claims', true)::jsonb ->> 'email')\n  )::text\n$$;\n"
 },
 {
  "version": "20211202183645",
  "name": "20211202183645_update_auth_uid.up.sql",
  "sql": "-- update auth.uid()\n\ncreate or replace function {{ index .Options \"Namespace\" }}.uid()\nreturns uuid\nlanguage sql stable\nas $$\n  select\n  nullif(\n    coalesce(\n      current_setting('request.jwt.claim.sub', true),\n      (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')\n    ),\n    ''\n  )::uuid\n$$;\n"
 },
 {
  "version": "20220114185221",
  "name": "20220114185221_update_user_idx.up.sql",
  "sql": "-- updates users_instance_id_email_idx definition\n\nDROP INDEX IF EXISTS users_instance_id_email_idx;\nCREATE INDEX IF NOT EXISTS users_instance_id_email_idx on \"{{ index .Options \"Namespace\" }}\".users using btree (instance_id, lower(email));\n"
 },
 {
  "version": "20220114185340",
  "name": "20220114185340_add_banned_until.up.sql",
  "sql": "-- adds banned_until column\n\nALTER TABLE {{ index .Options \"Namespace\" }}.users\nADD COLUMN IF NOT EXISTS banned_until timestamptz NULL;\n"
 },
 {
  "version": "20220224000811",
  "name": "20220224000811_update_auth_functions.up.sql",
  "sql": "-- update auth functions\n\ncreate or replace function {{ index .Options \"Namespace\" }}.uid() \nreturns uuid \nlanguage sql stable\nas $$\n  select \n  coalesce(\n    nullif(current_setting('request.jwt.claim.sub', true), ''),\n    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')\n  )::uuid\n$$;\n\ncreate or replace function {{ index .Options \"Namespace\" }}.role() \nreturns text \nlanguage sql stable\nas $$\n  select \n  coalesce(\n    nullif(current_setting('request.jwt.claim.role', true), ''),\n    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')\n  )::text\n$$;\n\ncreate or replace function {{ index .Options \"Namespace\" }}.email() \nreturns text \nlanguage sql stable\nas $$\n  select \n  coalesce(\n    nullif(current_setting('request.jwt.claim.email', true), ''),\n    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')\n  )::text\n$$;\n"
 },
 {
  "version": "20220323170000",
  "name": "20220323170000_add_user_reauthentication.up.sql",
  "sql": "-- adds reauthentication_token and reauthentication_sent_at \n\nALTER TABLE {{ index .Options \"Namespace\" }}.users\nADD COLUMN IF NOT EXISTS reauthentication_token varchar(255) null default '',\nADD COLUMN IF NOT EXISTS reauthentication_sent_at timestamptz null default null;\n"
 },
 {
  "version": "20220429102000",
  "name": "20220429102000_add_unique_idx.up.sql",
  "sql": "-- add partial unique indices to confirmation_token, recovery_token, email_change_token_current, email_change_token_new, phone_change_token, reauthentication_token\n-- ignores partial unique index creation on fields which contain empty strings, whitespaces or purely numeric otps\n\nDROP INDEX IF EXISTS confirmation_token_idx; \nDROP INDEX IF EXISTS recovery_token_idx;\nDROP INDEX IF EXISTS email_change_token_current_idx;\nDROP INDEX IF EXISTS email_change_token_new_idx;\nDROP INDEX IF EXISTS reauthentication_token_idx;\n\nCREATE UNIQUE INDEX IF NOT EXISTS confirmation_token_idx ON {{ index .Options \"Namespace\" }}.users USING btree (confirmation_token) WHERE confirmation_token !~ '^[0-9 ]*$';\nCREATE UNIQUE INDEX IF NOT EXISTS recovery_token_idx ON {{ index .Options \"Namespace\" }}.users USING btree (recovery_token) WHERE recovery_token !~ '^[0-9 ]*$';\nCREATE UNIQUE INDEX IF NOT EXISTS email_change_token_current_idx ON {{ index .Options \"Namespace\" }}.users USING btree (email_change_token_current) WHERE email_change_token_current !~ '^[0-9 ]*$';\nCREATE UNIQUE INDEX IF NOT EXISTS email_change_token_new_idx ON {{ index .Options \"Namespace\" }}.users USING btree (email_change_token_new) WHERE email_change_token_new !~ '^[0-9 ]*$';\nCREATE UNIQUE INDEX IF NOT EXISTS reauthentication_token_idx ON {{ index .Options \"Namespace\" }}.users USING btree (reauthentication_token) WHERE reauthentication_token !~ '^[0-9 ]*$';\n"
 },
 {
  "version": "20220531120530",
  "name": "20220531120530_add_auth_jwt_function.up.sql",
  "sql": "-- add auth.jwt function\n\ncomment on function {{ index .Options \"Namespace\" }}.uid() is 'Deprecated. Use auth.jwt() -> ''sub'' instead.';\ncomment on function {{ index .Options \"Namespace\" }}.role() is 'Deprecated. Use auth.jwt() -> ''role'' instead.';\ncomment on function {{ index .Options \"Namespace\" }}.email() is 'Deprecated. Use auth.jwt() -> ''email'' instead.';\n\ncreate or replace function {{ index .Options \"Namespace\" }}.jwt()\nreturns jsonb\nlanguage sql stable\nas $$\n  select \n    coalesce(\n        nullif(current_setting('request.jwt.claim', true), ''),\n        nullif(current_setting('request.jwt.claims', true), '')\n    )::jsonb\n$$;\n"
 },
 {
  "version": "20220614074223",
  "name": "20220614074223_add_ip_address_to_audit_log.postgres.up.sql",
  "sql": "-- Add IP Address to audit log\nALTER TABLE {{ index .Options \"Namespace\" }}.audit_log_entries\nADD COLUMN IF NOT EXISTS ip_address VARCHAR(64) NOT NULL DEFAULT '';\n"
 },
 {
  "version": "20220811173540",
  "name": "20220811173540_add_sessions_table.up.sql",
  "sql": "-- Add session_id column to refresh_tokens table\ncreate table if not exists {{ index .Options \"Namespace\" }}.sessions (\n    id uuid not null,\n    user_id uuid not null,\n    created_at timestamptz null,\n    updated_at timestamptz null,\n    constraint sessions_pkey primary key (id),\n    constraint sessions_user_id_fkey foreign key (user_id) references {{ index .Options \"Namespace\" }}.users(id) on delete cascade\n);\ncomment on table {{ index .Options \"Namespace\" }}.sessions is 'Auth: Stores session data associated to a user.';\n\nalter table {{ index .Options \"Namespace\" }}.refresh_tokens\nadd column if not exists session_id uuid null;\n\ndo $$\nbegin\n  if not exists(select *\n    from information_schema.constraint_column_usage\n    where table_schema = '{{ index .Options \"Namespace\" }}' and table_name='sessions' and constraint_name='refresh_tokens_session_id_fkey')\n  then\n      alter table \"{{ index .Options \"Namespace\" }}\".\"refresh_tokens\" add constraint refresh_tokens_session_id_fkey foreign key (session_id) references {{ index .Options \"Namespace\" }}.sessions(id) on delete cascade;\n  end if;\nEND $$;\n"
 },
 {
  "version": "20221003041349",
  "name": "20221003041349_add_mfa_schema.up.sql",
  "sql": "-- see: https://stackoverflow.com/questions/7624919/check-if-a-user-defined-type-already-exists-in-postgresql/48382296#48382296\ndo $$ begin\n    create type {{ index .Options \"Namespace\" }}.factor_type as enum('totp', 'webauthn');\nexception\n    when duplicate_object then null;\nend $$;\n\ndo $$ begin\n    create type {{ index .Options \"Namespace\" }}.factor_status as enum('unverified', 'verified');\nexception\n    when duplicate_object then null;\nend $$;\n\ndo $$ begin\n    create type {{ index .Options \"Namespace\" }}.aal_level as enum('aal1', 'aal2', 'aal3');\nexception\n    when duplicate_object then null;\nend $$;\n\n-- auth.mfa_factors definition\ncreate table if not exists {{ index .Options \"Namespace\" }}.mfa_factors(\n       id uuid not null,\n       user_id uuid not null,\n       friendly_name text null,\n       factor_type {{ index .Options \"Namespace\" }}.factor_type not null,\n       status {{ index .Options \"Namespace\" }}.factor_status not null,\n       created_at timestamptz not null,\n       updated_at timestamptz not null,\n       secret text null,\n       constraint mfa_factors_pkey primary key(id),\n       constraint mfa_factors_user_id_fkey foreign key (user_id) references {{ index .Options \"Namespace\" }}.users(id) on delete cascade\n);\ncomment on table {{ index .Options \"Namespace\" }}.mfa_factors is 'auth: stores metadata about factors';\n\ncreate unique index if not exists mfa_factors_user_friendly_name_unique on {{ index .Options \"Namespace\" }}.mfa_factors (friendly_name, user_id) where trim(friendly_name) <> '';\n\n-- auth.mfa_challenges definition\ncreate table if not exists {{ index .Options \"Namespace\" }}.mfa_challenges(\n       id uuid not null,\n       factor_id uuid not null,\n       created_at timestamptz not null,\n       verified_at timestamptz  null,\n       ip_address  inet not null,\n       constraint mfa_challenges_pkey primary key (id),\n       constraint mfa_challenges_auth_factor_id_fkey foreign key (factor_id) references {{ index .Options \"Namespace\" }}.mfa_factors(id) on delete cascade\n);\ncomment on table {{ index .Options \"Namespace\" }}.mfa_challenges is 'auth: stores metadata about challenge requests made';\n\n\n\n-- add factor_id and amr claims to session\ncreate table if not exists {{ index .Options \"Namespace\" }}.mfa_amr_claims(\n    session_id uuid not null,\n    created_at timestamptz not null,\n    updated_at timestamptz not null,\n    authentication_method text not null,\n    constraint mfa_amr_claims_session_id_authentication_method_pkey unique(session_id, authentication_method),\n    constraint mfa_amr_claims_session_id_fkey foreign key(session_id) references {{ index .Options \"Namespace\" }}.sessions(id) on delete cascade\n);\ncomment on table {{ index .Options \"Namespace\" }}.mfa_amr_claims is 'auth: stores authenticator method reference claims for multi factor authentication';\n"
 },
 {
  "version": "20221003041400",
  "name": "20221003041400_add_aal_and_factor_id_to_sessions.up.sql",
  "sql": "-- add factor_id to sessions\n alter table {{ index .Options \"Namespace\" }}.sessions add column if not exists factor_id uuid null;\n alter table {{ index .Options \"Namespace\" }}.sessions add column if not exists aal {{ index .Options \"Namespace\" }}.aal_level null;\n"
 },
 {
  "version": "20221011041400",
  "name": "20221011041400_add_mfa_indexes.up.sql",
  "sql": "alter table {{ index .Options \"Namespace\" }}.mfa_amr_claims\n  add column if not exists id uuid not null;\n\ndo $$\nbegin\n  if not exists\n     (select constraint_name\n      from information_schema.table_constraints\n      where table_schema = '{{ index .Options \"Namespace\" }}'\n      and table_name = 'mfa_amr_claims'\n      and constraint_name = 'amr_id_pk')\n  then\n    alter table {{ index .Options \"Namespace\" }}.mfa_amr_claims add constraint amr_id_pk primary key(id);\n  end if;\nend $$;\n\ncreate index if not exists user_id_created_at_idx on {{ index .Options \"Namespace\" }}.sessions (user_id, created_at);\ncreate index if not exists factor_id_created_at_idx on {{ index .Options \"Namespace\" }}.mfa_factors (user_id, created_at);\n\n"
 },
 {
  "version": "20221020193600",
  "name": "20221020193600_add_sessions_user_id_index.up.sql",
  "sql": "create index if not exists sessions_user_id_idx on {{ index .Options \"Namespace\" }}.sessions (user_id);\n\n"
 },
 {
  "version": "20221021073300",
  "name": "20221021073300_add_refresh_tokens_session_id_revoked_index.up.sql",
  "sql": "create index if not exists refresh_tokens_session_id_revoked_idx on {{ index .Options \"Namespace\" }}.refresh_tokens (session_id, revoked);\n"
 },
 {
  "version": "20221021082433",
  "name": "20221021082433_add_saml.up.sql",
  "sql": "-- Multi-instance mode (see auth.instances) table intentionally not supported and ignored.\n\ncreate table if not exists {{ index .Options \"Namespace\" }}.sso_providers (\n\tid uuid not null,\n\tresource_id text null,\n\tcreated_at timestamptz null,\n\tupdated_at timestamptz null,\n\tprimary key (id),\n\tconstraint \"resource_id not empty\" check (resource_id = null or char_length(resource_id) > 0)\n);\n\ncomment on table {{ index .Options \"Namespace\" }}.sso_providers is 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';\ncomment on column {{ index .Options \"Namespace\" }}.sso_providers.resource_id is 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';\n\ncreate unique index if not exists sso_providers_resource_id_idx on {{ index .Options \"Namespace\" }}.sso_providers (lower(resource_id));\n\ncreate table if not exists {{ index .Options \"Namespace\" }}.sso_domains (\n\tid uuid not null,\n\tsso_provider_id uuid not null,\n\tdomain text not null,\n\tcreated_at timestamptz null,\n\tupdated_at timestamptz null,\n\tprimary key (id),\n\tforeign key (sso_provider_id) references {{ index .Options \"Namespace\" }}.sso_providers (id) on delete cascade,\n\tconstraint \"domain not empty\" check (char_length(domain) > 0)\n);\n\ncreate index if not exists sso_domains_sso_provider_id_idx on {{ index .Options \"Namespace\" }}.sso_domains (sso_provider_id);\ncreate unique index if not exists sso_domains_domain_idx on {{ index .Options \"Namespace\" }}.sso_domains (lower(domain));\n\ncomment on table {{ index .Options \"Namespace\" }}.sso_domains is 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';\n\ncreate table if not exists {{ index .Options \"Namespace\" }}.saml_providers (\n\tid uuid not null,\n\tsso_provider_id uuid not null,\n\tentity_id text not null unique,\n\tmetadata_xml text not null,\n\tmetadata_url text null,\n\tattribute_mapping jsonb null,\n\tcreated_at timestamptz null,\n\tupdated_at timestamptz null,\n\tprimary key (id),\n\tforeign key (sso_provider_id) references {{ index .Options \"Namespace\" }}.sso_providers (id) on delete cascade,\n\tconstraint \"metadata_xml not empty\" check (char_length(metadata_xml) > 0),\n\tconstraint \"metadata_url not empty\" check (metadata_url = null or char_length(metadata_url) > 0),\n\tconstraint \"entity_id not empty\" check (char_length(entity_id) > 0)\n);\n\ncreate index if not exists saml_providers_sso_provider_id_idx on {{ index .Options \"Namespace\" }}.saml_providers (sso_provider_id);\n\ncomment on table {{ index .Options \"Namespace\" }}.saml_providers is 'Auth: Manages SAML Identity Provider connections.';\n\ncreate table if not exists {{ index .Options \"Namespace\" }}.saml_relay_states (\n\tid uuid not null,\n\tsso_provider_id uuid not null,\n\trequest_id text not null,\n\tfor_email text null,\n\tredirect_to text null,\n\tfrom_ip_address inet null,\n\tcreated_at timestamptz null,\n\tupdated_at timestamptz null,\n\tprimary key (id),\n\tforeign key (sso_provider_id) references {{ index .Options \"Namespace\" }}.sso_providers (id) on delete cascade,\n\tconstraint \"request_id not empty\" check(char_length(request_id) > 0)\n);\n\ncreate index if not exists saml_relay_states_sso_provider_id_idx on {{ index .Options \"Namespace\" }}.saml_relay_states (sso_provider_id);\ncreate index if not exists saml_relay_states_for_email_idx on {{ index .Options \"Namespace\" }}.saml_relay_states (for_email);\n\ncomment on table {{ index .Options \"Namespace\" }}.saml_relay_states is 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';\n\ncreate table if not exists {{ index .Options \"Namespace\" }}.sso_sessions (\n\tid uuid not null,\n\tsession_id uuid not null,\n\tsso_provider_id uuid null,\n\tnot_before timestamptz null,\n\tnot_after timestamptz null,\n\tidp_initiated boolean default false,\n\tcreated_at timestamptz null,\n\tupdated_at timestamptz null,\n\tprimary key (id),\n\tforeign key (session_id) references {{ index .Options \"Namespace\" }}.sessions (id) on delete cascade,\n\tforeign key (sso_provider_id) references {{ index .Options \"Namespace\" }}.sso_providers (id) on delete cascade\n);\n\ncreate index if not exists sso_sessions_session_id_idx on {{ index .Options \"Namespace\" }}.sso_sessions (session_id);\ncreate index if not exists sso_sessions_sso_provider_id_idx on {{ index .Options \"Namespace\" }}.sso_sessions (sso_provider_id);\n\ncomment on table {{ index .Options \"Namespace\" }}.sso_sessions is 'Auth: A session initiated by an SSO Identity Provider';\n\n"
 },
 {
  "version": "20221027105023",
  "name": "20221027105023_add_identities_user_id_idx.up.sql",
  "sql": "create index if not exists identities_user_id_idx on {{ index .Options \"Namespace\" }}.identities using btree (user_id);\n"
 },
 {
  "version": "20221114143122",
  "name": "20221114143122_add_session_not_after_column.up.sql",
  "sql": "alter table only {{ index .Options \"Namespace\" }}.sessions\n  add column if not exists not_after timestamptz;\n\ncomment on column {{ index .Options \"Namespace\" }}.sessions.not_after is 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';\n"
 },
 {
  "version": "20221114143410",
  "name": "20221114143410_remove_parent_foreign_key_refresh_tokens.up.sql",
  "sql": "alter table only {{ index .Options \"Namespace\" }}.refresh_tokens\n  drop constraint refresh_tokens_parent_fkey;\n"
 },
 {
  "version": "20221125140132",
  "name": "20221125140132_backfill_email_identity.up.sql",
  "sql": "-- backfill the auth.identities column by adding an email identity \n-- for all auth.users with an email and password \n\ndo $$\nbegin\n\tinsert into {{ index .Options \"Namespace\" }}.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)\n\tselect id, id as user_id, jsonb_build_object('sub', id, 'email', email) as identity_data, 'email' as provider, null as last_sign_in_at, '2022-11-25' as created_at, '2022-11-25' as updated_at\n\tfrom {{ index .Options \"Namespace\" }}.users as users\n\twhere encrypted_password != '' and email is not null and not exists(select user_id from {{ index .Options \"Namespace\" }}.identities where user_id = users.id);\nend;\n$$;\n"
 },
 {
  "version": "20221208132122",
  "name": "20221208132122_backfill_email_last_sign_in_at.up.sql",
  "sql": "-- previous backfill migration left last_sign_in_at to be null, which broke some projects\n\ndo $$\nbegin\nupdate {{ index .Options \"Namespace\" }}.identities\n  set last_sign_in_at = '2022-11-25'\n  where\n    last_sign_in_at is null and\n    created_at = '2022-11-25' and\n    updated_at = '2022-11-25' and\n    provider = 'email' and\n    id::text = user_id::text;\nend $$;\n"
 },
 {
  "version": "20221215195500",
  "name": "20221215195500_modify_users_email_unique_index.up.sql",
  "sql": "-- this change is relatively temporary\n-- it is meant to keep database consistency guarantees until there is proper\n-- introduction of account linking / merging / delinking APIs, at which point\n-- rows in the users table will allow duplicates but with programmatic control\n\nalter table only {{ index .Options \"Namespace\" }}.users\n  add column if not exists is_sso_user boolean not null default false;\n\ncomment on column {{ index .Options \"Namespace\" }}.users.is_sso_user is 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';\n\ndo $$\nbegin\n  alter table only {{ index .Options \"Namespace\" }}.users\n    drop constraint if exists users_email_key;\nexception\n-- dependent object: https://www.postgresql.org/docs/current/errcodes-appendix.html\nwhen SQLSTATE '2BP01' then\n  raise notice 'Unable to drop users_email_key constraint due to dependent objects, please resolve this manually or SSO may not work';\nend $$;\n\ncreate unique index if not exists users_email_partial_key on {{ index .Options \"Namespace\" }}.users (email) where (is_sso_user = false);\n\ncomment on index {{ index .Options \"Namespace\" }}.users_email_partial_key is 'Auth: A partial unique index that applies only when is_sso_user is false';\n"
 },
 {
  "version": "20221215195800",
  "name": "20221215195800_add_identities_email_column.up.sql",
  "sql": "do $$\nbegin\n  update\n    {{ index .Options \"Namespace\" }}.identities as identities\n  set\n    identity_data = identity_data || jsonb_build_object('email', (select email from {{ index .Options \"Namespace\" }}.users where id = identities.user_id)),\n    updated_at = '2022-11-25'\n  where identities.provider = 'email' and identity_data->>'email' is null;\nend $$;\n\nalter table only {{ index .Options \"Namespace\" }}.identities\n  add column if not exists email text generated always as (lower(identity_data->>'email')) stored;\n\ncomment on column {{ index .Options \"Namespace\" }}.identities.email is 'Auth: Email is a generated column that references the optional email property in the identity_data';\n\ncreate index if not exists identities_email_idx on {{ index .Options \"Namespace\" }}.identities (email text_pattern_ops);\n\ncomment on index {{ index .Options \"Namespace\" }}.identities_email_idx is 'Auth: Ensures indexed queries on the email column';\n"
 },
 {
  "version": "20221215195900",
  "name": "20221215195900_remove_sso_sessions.up.sql",
  "sql": "-- sso_sessions is not used as all of the necessary data is in sessions\ndrop table if exists {{ index .Options \"Namespace\" }}.sso_sessions;\n\n"
 },
 {
  "version": "20230116124310",
  "name": "20230116124310_alter_phone_type.up.sql",
  "sql": "-- alter phone field column type to accomodate for soft deletion \n\ndo $$\nbegin\n  alter table {{ index .Options \"Namespace\" }}.users\n    alter column phone type text,\n    alter column phone_change type text;\nexception\n  -- SQLSTATE errcodes https://www.postgresql.org/docs/current/errcodes-appendix.html\n  when SQLSTATE '0A000' then\n    raise notice 'Unable to change data type of phone, phone_change columns due to use by a view or rule';\n  when SQLSTATE '2BP01' then\n    raise notice 'Unable to change data type of phone, phone_change columns due to dependent objects';\n  when SQLSTATE 'XX000' then\n    raise notice 'Unable to change data type of phone, phone_change columns due to internal error (OrioleDB)';\nend $$;\n"
 },
 {
  "version": "20230116124412",
  "name": "20230116124412_add_deleted_at.up.sql",
  "sql": "-- adds deleted_at column to auth.users \n\nalter table {{ index .Options \"Namespace\" }}.users \nadd column if not exists deleted_at timestamptz null;\n"
 },
 {
  "version": "20230131181311",
  "name": "20230131181311_backfill_invite_identities.up.sql",
  "sql": "-- backfills the missing email identity for invited users\n\ndo $$\nbegin\n\tinsert into {{ index .Options \"Namespace\" }}.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)\n\tselect id, id as user_id, jsonb_build_object('sub', id, 'email', email) as identity_data, 'email' as provider, null as last_sign_in_at, '2023-01-25' as created_at, '2023-01-25' as updated_at\n\tfrom {{ index .Options \"Namespace\" }}.users as users\n\twhere invited_at is not null and not exists (select user_id from {{ index .Options \"Namespace\" }}.identities where user_id = users.id and provider = 'email');\nend $$;\n"
 },
 {
  "version": "20230322519590",
  "name": "20230322519590_add_flow_state_table.up.sql",
  "sql": "-- see: https://stackoverflow.com/questions/7624919/check-if-a-user-defined-type-already-exists-in-postgresql/48382296#48382296\ndo $$ begin\n    create type {{ index .Options \"Namespace\" }}.code_challenge_method as enum('s256', 'plain');\nexception\n    when duplicate_object then null;\nend $$;\ncreate table if not exists {{ index .Options \"Namespace\" }}.flow_state(\n       id uuid primary key,\n       user_id uuid null,\n       auth_code text not null,\n       code_challenge_method {{ index .Options \"Namespace\" }}.code_challenge_method not null,\n       code_challenge text not null,\n       provider_type text not null,\n       provider_access_token text null,\n       provider_refresh_token text null,\n       created_at timestamptz null,\n       updated_at timestamptz null\n);\ncreate index if not exists idx_auth_code on {{ index .Options \"Namespace\" }}.flow_state(auth_code);\ncomment on table {{ index .Options \"Namespace\" }}.flow_state is 'stores metadata for pkce logins';\n"
 },
 {
  "version": "20230402418590",
  "name": "20230402418590_add_authentication_method_to_flow_state_table.up.sql",
  "sql": "alter table {{index .Options \"Namespace\" }}.flow_state\nadd column if not exists authentication_method text not null;\ncreate index if not exists idx_user_id_auth_method on {{index .Options \"Namespace\" }}.flow_state (user_id, authentication_method);\n\n-- Update comment as we have generalized the table\ncomment on table {{ index .Options \"Namespace\" }}.flow_state is 'stores metadata for pkce logins';\n"
 },
 {
  "version": "20230411005111",
  "name": "20230411005111_remove_duplicate_idx.up.sql",
  "sql": "drop index if exists {{index .Options \"Namespace\" }}.refresh_tokens_token_idx;\n"
 },
 {
  "version": "20230508135423",
  "name": "20230508135423_add_cleanup_indexes.up.sql",
  "sql": "-- Indexes used for cleaning up old or stale objects.\n\ncreate index if not exists\n  refresh_tokens_updated_at_idx\n  on {{ index .Options \"Namespace\" }}.refresh_tokens (updated_at desc);\n\ncreate index if not exists\n  flow_state_created_at_idx\n  on {{ index .Options \"Namespace\" }}.flow_state (created_at desc);\n\ncreate index if not exists\n  saml_relay_states_created_at_idx\n  on {{ index .Options \"Namespace\" }}.saml_relay_states (created_at desc);\n\ncreate index if not exists\n  sessions_not_after_idx\n  on {{ index .Options \"Namespace\" }}.sessions (not_after desc);\n"
 },
 {
  "version": "20230523124323",
  "name": "20230523124323_add_mfa_challenge_cleanup_index.up.sql",
  "sql": "-- Index used to clean up mfa challenges\n\ncreate index if not exists\n  mfa_challenge_created_at_idx\n  on {{ index .Options \"Namespace\" }}.mfa_challenges (created_at desc);\n"
 },
 {
  "version": "20230818113222",
  "name": "20230818113222_add_flow_state_to_relay_state.up.sql",
  "sql": "alter table {{ index .Options \"Namespace\" }}.saml_relay_states add column if not exists flow_state_id uuid references {{ index .Options \"Namespace\" }}.flow_state(id) on delete cascade default null;\n"
 },
 {
  "version": "20230914180801",
  "name": "20230914180801_add_mfa_factors_user_id_idx.up.sql",
  "sql": "create index if not exists mfa_factors_user_id_idx on {{ index .Options \"Namespace\" }}.mfa_factors(user_id);\n"
 },
 {
  "version": "20231027141322",
  "name": "20231027141322_add_session_refresh_columns.up.sql",
  "sql": "alter table if exists {{ index .Options \"Namespace\" }}.sessions\n  add column if not exists refreshed_at timestamp without time zone,\n  add column if not exists user_agent text,\n  add column if not exists ip inet;\n"
 },
 {
  "version": "20231114161723",
  "name": "20231114161723_add_sessions_tag.up.sql",
  "sql": "alter table if exists {{ index .Options \"Namespace\" }}.sessions\n  add column if not exists tag text;\n"
 },
 {
  "version": "20231117164230",
  "name": "20231117164230_add_id_pkey_identities.up.sql",
  "sql": "do $$\nbegin\n    if not exists(select * \n        from information_schema.columns\n        where table_schema = '{{ index .Options \"Namespace\" }}' and table_name='identities' and column_name='provider_id')\n    then\n        alter table if exists {{ index .Options \"Namespace\" }}.identities \n        rename column id to provider_id;\n    end if;\nend$$;\n\nalter table if exists {{ index .Options \"Namespace\" }}.identities \n    drop constraint if exists identities_pkey,\n    add column if not exists id uuid default gen_random_uuid() primary key;\n\ndo $$\nbegin\n  if not exists\n     (select constraint_name\n      from information_schema.table_constraints\n      where table_schema = '{{ index .Options \"Namespace\" }}'\n      and table_name = 'identities'\n      and constraint_name = 'identities_provider_id_provider_unique')\n  then\n    alter table if exists {{ index .Options \"Namespace\" }}.identities \n    add constraint identities_provider_id_provider_unique \n    unique(provider_id, provider);\n  end if;\nend $$;\n"
 },
 {
  "version": "20240115144230",
  "name": "20240115144230_remove_ip_address_from_saml_relay_state.up.sql",
  "sql": "do $$\nbegin\n   if exists (select from information_schema.columns where table_schema = '{{ index .Options \"Namespace\" }}' and table_name = 'saml_relay_states' and column_name = 'from_ip_address') then\n      alter table {{ index .Options \"Namespace\" }}.saml_relay_states drop column from_ip_address;\n   end if;\nend\n$$;\n"
 },
 {
  "version": "20240214120130",
  "name": "20240214120130_add_is_anonymous_column.up.sql",
  "sql": "do $$\nbegin\n   alter table {{ index .Options \"Namespace\" }}.users \n   add column if not exists is_anonymous boolean not null default false;\n\n   create index if not exists users_is_anonymous_idx  on {{ index .Options \"Namespace\" }}.users using btree (is_anonymous);\nend\n$$;\n"
 },
 {
  "version": "20240306115329",
  "name": "20240306115329_add_issued_at_to_flow_state.up.sql",
  "sql": "do $$ begin\nalter table {{ index .Options \"Namespace\" }}.flow_state add column if not exists auth_code_issued_at timestamptz null;\nend $$\n"
 },
 {
  "version": "20240314092811",
  "name": "20240314092811_add_saml_name_id_format.up.sql",
  "sql": "do $$ begin\nalter table {{ index .Options \"Namespace\" }}.saml_providers add column if not exists name_id_format text null;\nend $$\n"
 },
 {
  "version": "20240427152123",
  "name": "20240427152123_add_one_time_tokens_table.up.sql",
  "sql": "do $$ begin\n  create type {{ index .Options \"Namespace\" }}.one_time_token_type as enum (\n    'confirmation_token',\n    'reauthentication_token',\n    'recovery_token',\n    'email_change_token_new',\n    'email_change_token_current',\n    'phone_change_token'\n  );\nexception\n  when duplicate_object then null;\nend $$;\n\n\ndo $$ begin\n  create table if not exists {{ index .Options \"Namespace\" }}.one_time_tokens (\n    id uuid primary key,\n    user_id uuid not null references {{ index .Options \"Namespace\" }}.users on delete cascade,\n    token_type {{ index .Options \"Namespace\" }}.one_time_token_type not null,\n    token_hash text not null,\n    relates_to text not null,\n    created_at timestamp without time zone not null default now(),\n    updated_at timestamp without time zone not null default now(),\n    check (char_length(token_hash) > 0)\n  );\n\n  begin\n    create index if not exists one_time_tokens_token_hash_hash_idx on {{ index .Options \"Namespace\" }}.one_time_tokens using hash (token_hash);\n    create index if not exists one_time_tokens_relates_to_hash_idx on {{ index .Options \"Namespace\" }}.one_time_tokens using hash (relates_to);\n  exception when others then\n    -- Fallback to btree indexes if hash creation fails\n    create index if not exists one_time_tokens_token_hash_hash_idx on {{ index .Options \"Namespace\" }}.one_time_tokens using btree (token_hash);\n    create index if not exists one_time_tokens_relates_to_hash_idx on {{ index .Options \"Namespace\" }}.one_time_tokens using btree (relates_to);\n  end;\n\n  create unique index if not exists one_time_tokens_user_id_token_type_key on {{ index .Options \"Namespace\" }}.one_time_tokens (user_id, token_type);\nend $$;\n"
 },
 {
  "version": "20240612123726",
  "name": "20240612123726_enable_rls_update_grants.up.sql",
  "sql": "do $$ begin\n    -- enable RLS policy on auth tables\n    alter table {{ index .Options \"Namespace\" }}.schema_migrations enable row level security;\n    alter table {{ index .Options \"Namespace\" }}.instances enable row level security;\n    alter table {{ index .Options \"Namespace\" }}.users enable row level security;\n    alter table {{ index .Options \"Namespace\" }}.audit_log_entries enable row level security;\n    alter table {{ index .Options \"Namespace\" }}.saml_relay_states enable row level security;\n    alter table {{ index .Options \"Namespace\" }}.refresh_tokens enable row level security;\n    alter table {{ index .Options \"Namespace\" }}.mfa_factors enable row level security;\n    alter table {{ index .Options \"Namespace\" }}.sessions enable row level security;\n    alter table {{ index .Options \"Namespace\" }}.sso_providers enable row level security;\n    alter table {{ index .Options \"Namespace\" }}.sso_domains enable row level security;\n    alter table {{ index .Options \"Namespace\" }}.mfa_challenges enable row level security;\n    alter table {{ index .Options \"Namespace\" }}.mfa_amr_claims enable row level security;\n    alter table {{ index .Options \"Namespace\" }}.saml_providers enable row level security;\n    alter table {{ index .Options \"Namespace\" }}.flow_state enable row level security;\n    alter table {{ index .Options \"Namespace\" }}.identities enable row level security;\n    alter table {{ index .Options \"Namespace\" }}.one_time_tokens enable row level security;\n    -- allow postgres role to select from auth tables and allow it to grant select to other roles\n    grant select on {{ index .Options \"Namespace\" }}.schema_migrations to postgres with grant option;\n    grant select on {{ index .Options \"Namespace\" }}.instances to postgres with grant option;\n    grant select on {{ index .Options \"Namespace\" }}.users to postgres with grant option;\n    grant select on {{ index .Options \"Namespace\" }}.audit_log_entries to postgres with grant option;\n    grant select on {{ index .Options \"Namespace\" }}.saml_relay_states to postgres with grant option;\n    grant select on {{ index .Options \"Namespace\" }}.refresh_tokens to postgres with grant option;\n    grant select on {{ index .Options \"Namespace\" }}.mfa_factors to postgres with grant option;\n    grant select on {{ index .Options \"Namespace\" }}.sessions to postgres with grant option;\n    grant select on {{ index .Options \"Namespace\" }}.sso_providers to postgres with grant option;\n    grant select on {{ index .Options \"Namespace\" }}.sso_domains to postgres with grant option;\n    grant select on {{ index .Options \"Namespace\" }}.mfa_challenges to postgres with grant option;\n    grant select on {{ index .Options \"Namespace\" }}.mfa_amr_claims to postgres with grant option;\n    grant select on {{ index .Options \"Namespace\" }}.saml_providers to postgres with grant option;\n    grant select on {{ index .Options \"Namespace\" }}.flow_state to postgres with grant option;\n    grant select on {{ index .Options \"Namespace\" }}.identities to postgres with grant option;\n    grant select on {{ index .Options \"Namespace\" }}.one_time_tokens to postgres with grant option;\nend $$;\n"
 },
 {
  "version": "20240729123726",
  "name": "20240729123726_add_mfa_phone_config.up.sql",
  "sql": "do $$ begin\n    alter type {{ index .Options \"Namespace\" }}.factor_type add value 'phone';\nexception\n    when duplicate_object then null;\nend $$;\n\n\nalter table {{ index .Options \"Namespace\" }}.mfa_factors add column if not exists phone text unique default null;\nalter table {{ index .Options \"Namespace\" }}.mfa_challenges add column if not exists otp_code text null;\n\n\ncreate unique index if not exists unique_verified_phone_factor on {{ index .Options \"Namespace\" }}.mfa_factors (user_id, phone);\n"
 },
 {
  "version": "20240802193726",
  "name": "20240802193726_add_mfa_factors_column_last_challenged_at.up.sql",
  "sql": "alter table {{ index .Options \"Namespace\" }}.mfa_factors add column if not exists last_challenged_at timestamptz unique default null;\n"
 },
 {
  "version": "20240806073726",
  "name": "20240806073726_drop_uniqueness_constraint_on_phone.up.sql",
  "sql": "alter table {{ index .Options \"Namespace\" }}.mfa_factors drop constraint if exists mfa_factors_phone_key;\ndo $$\nbegin\n    -- if both indexes exist, it means that the schema_migrations table was truncated and the migrations had to be rerun\n    if (\n        select count(*) = 2\n        from pg_indexes \n        where indexname in ('unique_verified_phone_factor', 'unique_phone_factor_per_user')\n        and schemaname = '{{ index .Options \"Namespace\" }}'\n    ) then\n        execute 'drop index {{ index .Options \"Namespace\" }}.unique_verified_phone_factor';\n    end if;\n\n    if exists (\n         select 1\n         from pg_indexes\n         where indexname = 'unique_verified_phone_factor'\n         and schemaname = '{{ index .Options \"Namespace\" }}'\n    ) then\n        execute 'alter index {{ index .Options \"Namespace\" }}.unique_verified_phone_factor rename to unique_phone_factor_per_user';\n    end if;\nend $$;\n"
 },
 {
  "version": "20241009103726",
  "name": "20241009103726_add_web_authn.up.sql",
  "sql": "alter table {{ index .Options \"Namespace\" }}.mfa_factors add column if not exists web_authn_credential jsonb null;\nalter table {{ index .Options \"Namespace\" }}.mfa_factors add column if not exists web_authn_aaguid uuid null;\nalter table {{ index .Options \"Namespace\" }}.mfa_challenges add column if not exists web_authn_session_data jsonb null;\n"
 },
 {
  "version": "20250717082212",
  "name": "20250717082212_add_disabled_to_sso_providers.up.sql",
  "sql": "do $$ begin\n\n    alter table only {{ index .Options \"Namespace\" }}.sso_providers\n        add column if not exists disabled boolean null;\n\n    create index if not exists sso_providers_resource_id_pattern_idx\n        on {{ index .Options \"Namespace\" }}.sso_providers\n            (resource_id text_pattern_ops);\nend $$;\n"
 },
 {
  "version": "20250731150234",
  "name": "20250731150234_add_oauth_clients_table.up.sql",
  "sql": "-- Create enums for OAuth client fields\ndo $$ begin\n    create type {{ index .Options \"Namespace\" }}.oauth_registration_type as enum('dynamic', 'manual');\nexception\n    when duplicate_object then null;\nend $$;\n\n-- Create oauth_clients table for OAuth client management\ncreate table if not exists {{ index .Options \"Namespace\" }}.oauth_clients (\n    id uuid not null,\n    client_id text not null,\n    client_secret_hash text not null,\n    registration_type {{ index .Options \"Namespace\" }}.oauth_registration_type not null,\n    redirect_uris text not null,\n    grant_types text not null,\n    client_name text null,\n    client_uri text null,\n    logo_uri text null,\n    created_at timestamptz not null default now(),\n    updated_at timestamptz not null default now(),\n    deleted_at timestamptz null,\n    constraint oauth_clients_pkey primary key (id),\n    constraint oauth_clients_client_id_key unique (client_id),\n    constraint oauth_clients_client_name_length check (char_length(client_name) <= 1024),\n    constraint oauth_clients_client_uri_length check (char_length(client_uri) <= 2048),\n    constraint oauth_clients_logo_uri_length check (char_length(logo_uri) <= 2048)\n);\n\n-- Create indexes\ncreate index if not exists oauth_clients_client_id_idx \n    on {{ index .Options \"Namespace\" }}.oauth_clients (client_id);\n\ncreate index if not exists oauth_clients_deleted_at_idx \n    on {{ index .Options \"Namespace\" }}.oauth_clients (deleted_at);\n"
 },
 {
  "version": "20250804100000",
  "name": "20250804100000_add_oauth_authorizations_consents.up.sql",
  "sql": "-- Create OAuth 2.1 support with enums, authorization, and consent tables\n\n-- Create enums for OAuth authorization management\ndo $$ begin\n    create type {{ index .Options \"Namespace\" }}.oauth_authorization_status as enum('pending', 'approved', 'denied', 'expired');\nexception\n    when duplicate_object then null;\nend $$;\n\ndo $$ begin\n    create type {{ index .Options \"Namespace\" }}.oauth_response_type as enum('code');\nexception\n    when duplicate_object then null;\nend $$;\n\n-- Create oauth_authorizations table for OAuth 2.1 authorization requests\ncreate table if not exists {{ index .Options \"Namespace\" }}.oauth_authorizations (\n    id uuid not null,\n    authorization_id text not null,\n    client_id uuid not null references {{ index .Options \"Namespace\" }}.oauth_clients(id) on delete cascade,\n    user_id uuid null references {{ index .Options \"Namespace\" }}.users(id) on delete cascade,\n    redirect_uri text not null,\n    scope text not null,\n    state text null,\n    resource text null,\n    code_challenge text null,\n    code_challenge_method {{ index .Options \"Namespace\" }}.code_challenge_method null,\n    response_type {{ index .Options \"Namespace\" }}.oauth_response_type not null default 'code',\n    \n    -- Flow control\n    status {{ index .Options \"Namespace\" }}.oauth_authorization_status not null default 'pending',\n    authorization_code text null,\n    \n    -- Timestamps\n    created_at timestamptz not null default now(),\n    expires_at timestamptz not null default (now() + interval '3 minutes'),\n    approved_at timestamptz null,\n    \n    constraint oauth_authorizations_pkey primary key (id),\n    constraint oauth_authorizations_authorization_id_key unique (authorization_id),\n    constraint oauth_authorizations_authorization_code_key unique (authorization_code),\n    constraint oauth_authorizations_redirect_uri_length check (char_length(redirect_uri) <= 2048),\n    constraint oauth_authorizations_scope_length check (char_length(scope) <= 4096),\n    constraint oauth_authorizations_state_length check (char_length(state) <= 4096),\n    constraint oauth_authorizations_resource_length check (char_length(resource) <= 2048),\n    constraint oauth_authorizations_code_challenge_length check (char_length(code_challenge) <= 128),\n    constraint oauth_authorizations_authorization_code_length check (char_length(authorization_code) <= 255),\n    constraint oauth_authorizations_expires_at_future check (expires_at > created_at)\n);\n\n-- Create indexes for oauth_authorizations\n--  for CleanupExpiredOAuthServerAuthorizations\ncreate index if not exists oauth_auth_pending_exp_idx\n    on {{ index .Options \"Namespace\" }}.oauth_authorizations (expires_at)\n    where status = 'pending';\n\n\n\n-- Create oauth_consents table for user consent management\ncreate table if not exists {{ index .Options \"Namespace\" }}.oauth_consents (\n    id uuid not null,\n    user_id uuid not null references {{ index .Options \"Namespace\" }}.users(id) on delete cascade,\n    client_id uuid not null references {{ index .Options \"Namespace\" }}.oauth_clients(id) on delete cascade,\n    scopes text not null,\n    granted_at timestamptz not null default now(),\n    revoked_at timestamptz null,\n    \n    constraint oauth_consents_pkey primary key (id),\n    constraint oauth_consents_user_client_unique unique (user_id, client_id),\n    constraint oauth_consents_scopes_length check (char_length(scopes) <= 2048),\n    constraint oauth_consents_scopes_not_empty check (char_length(trim(scopes)) > 0),\n    constraint oauth_consents_revoked_after_granted check (revoked_at is null or revoked_at >= granted_at)\n);\n\n-- Create indexes for oauth_consents\n-- Active consent look-up (user + client, only non-revoked rows)\ncreate index if not exists oauth_consents_active_user_client_idx\n    on {{ index .Options \"Namespace\" }}.oauth_consents (user_id, client_id)\n    where revoked_at is null;\n\n-- \"Show me all consents for this user, newest first\"\ncreate index if not exists oauth_consents_user_order_idx\n    on {{ index .Options \"Namespace\" }}.oauth_consents (user_id, granted_at desc);\n\n-- Bulk revoke for an entire client (only non-revoked rows)\ncreate index if not exists oauth_consents_active_client_idx\n    on {{ index .Options \"Namespace\" }}.oauth_consents (client_id)\n    where revoked_at is null;\n"
 },
 {
  "version": "20250901200500",
  "name": "20250901200500_add_oauth_client_type.up.sql",
  "sql": "-- Make client_secret_hash nullable to support public clients\n-- Public clients don't have client secrets, only confidential clients do\n\nalter table {{ index .Options \"Namespace\" }}.oauth_clients alter column client_secret_hash drop not null;\n\n-- Add client_type enum and column to oauth_clients table\ndo $$ begin\n    create type {{ index .Options \"Namespace\" }}.oauth_client_type as enum('public', 'confidential');\nexception\n    when duplicate_object then null;\nend $$;\n\n-- Add client_type column to oauth_clients table\nalter table {{ index .Options \"Namespace\" }}.oauth_clients  add column if not exists client_type {{ index .Options \"Namespace\" }}.oauth_client_type not null default 'confidential';\n"
 },
 {
  "version": "20250903112500",
  "name": "20250903112500_remove_oauth_client_id_column.up.sql",
  "sql": "-- Drop the client_id column and related constraints/indexes from oauth_clients table\n-- The id (uuid) field will serve as the public client_id\n\n-- Drop the unique constraint on client_id\nalter table {{ index .Options \"Namespace\" }}.oauth_clients \n    drop constraint if exists oauth_clients_client_id_key;\n\n-- Drop the index on client_id\ndrop index if exists {{ index .Options \"Namespace\" }}.oauth_clients_client_id_idx;\n\n-- Drop the client_id column\nalter table {{ index .Options \"Namespace\" }}.oauth_clients \n    drop column if exists client_id;\n"
 },
 {
  "version": "20250904133000",
  "name": "20250904133000_add_oauth_client_id_to_session.up.sql",
  "sql": "alter table if exists {{ index .Options \"Namespace\" }}.sessions\n  add column if not exists oauth_client_id uuid;\n\nalter table {{ index .Options \"Namespace\" }}.sessions\n  add constraint sessions_oauth_client_id_fkey foreign key (oauth_client_id)\n  references {{ index .Options \"Namespace\" }}.oauth_clients(id) on delete cascade not valid;\n\nalter table {{ index .Options \"Namespace\" }}.sessions\n  validate constraint sessions_oauth_client_id_fkey;\n\ncreate index if not exists sessions_oauth_client_id_idx on {{ index .Options \"Namespace\" }}.sessions (oauth_client_id);\n"
 },
 {
  "version": "20250925093508",
  "name": "20250925093508_add_last_webauthn_challenge_data.up.sql",
  "sql": "/* auth_migration: 20250925093508 */\nALTER TABLE {{ index .Options \"Namespace\" }}.mfa_factors \nADD COLUMN IF NOT EXISTS last_webauthn_challenge_data JSONB;\n/* auth_migration: 20250925093508 */\nCOMMENT ON COLUMN {{ index .Options \"Namespace\" }}.mfa_factors.last_webauthn_challenge_data IS 'Stores the latest WebAuthn challenge data including attestation/assertion for customer verification';\n"
 },
 {
  "version": "20251007112900",
  "name": "20251007112900_add_session_refresh_token_columns.up.sql",
  "sql": "/* auth_migration: 20251007112900 */\nALTER TABLE {{ index .Options \"Namespace\" }}.sessions\n  ADD COLUMN IF NOT EXISTS refresh_token_hmac_key text,\n  ADD COLUMN IF NOT EXISTS refresh_token_counter bigint;\n\n/* auth_migration: 20251007112900 */\nCOMMENT ON COLUMN {{ index .Options \"Namespace\" }}.sessions.refresh_token_hmac_key IS 'Holds a HMAC-SHA256 key used to sign refresh tokens for this session.';\n/* auth_migration: 20251007112900 */\nCOMMENT ON COLUMN {{ index .Options \"Namespace\" }}.sessions.refresh_token_counter IS 'Holds the ID (counter) of the last issued refresh token.';\n"
 },
 {
  "version": "20251104100000",
  "name": "20251104100000_add_nonce_to_oauth_authorizations.up.sql",
  "sql": "/* auth_migration: 20251104100000 */\nalter table {{ index .Options \"Namespace\" }}.oauth_authorizations\n    add column if not exists nonce text null;\n\n/* auth_migration: 20251104100000 */\nalter table {{ index .Options \"Namespace\" }}.oauth_authorizations\n    add constraint oauth_authorizations_nonce_length check (char_length(nonce) <= 255);\n"
 },
 {
  "version": "20251111201300",
  "name": "20251111201300_add_scopes_to_sessions.up.sql",
  "sql": "-- Add scopes column to sessions table for OAuth scope tracking\n-- This is nullable to avoid issues with existing sessions\n/* auth_migration: 202511112013000 */\nalter table if exists {{ index .Options \"Namespace\" }}.sessions\n  add column if not exists scopes text null;\n\n-- Add constraint to ensure scopes are reasonable length (4KB limit)\n/* auth_migration: 202511112013000 */\nalter table {{ index .Options \"Namespace\" }}.sessions\n  add constraint sessions_scopes_length check (char_length(scopes) <= 4096);\n"
 },
 {
  "version": "20251201000000",
  "name": "20251201000000_add_oauth_client_states_table.up.sql",
  "sql": "/* auth_migration: 20251201000000 */\nCREATE TABLE IF NOT EXISTS {{ index .Options \"Namespace\" }}.oauth_client_states(\n  id UUID PRIMARY KEY,\n  provider_type TEXT NOT NULL,\n  code_verifier TEXT,\n  created_at TIMESTAMPTZ NOT NULL\n);\n/* auth_migration: 20251201000000 */\nCREATE INDEX IF NOT EXISTS idx_oauth_client_states_created_at ON {{ index .Options \"Namespace\" }}.oauth_client_states(created_at);\n/* auth_migration: 20251201000000 */\nCOMMENT ON TABLE {{ index .Options \"Namespace\" }}.oauth_client_states IS 'Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.';\n"
 },
 {
  "version": "20260115000000",
  "name": "20260115000000_add_flow_state_oauth_context.up.sql",
  "sql": "-- Add columns for OAuth context (previously stored in JWT state parameter)\n/* auth_migration: 20260115000000 */\nALTER TABLE {{ index .Options \"Namespace\" }}.flow_state\n    ADD COLUMN IF NOT EXISTS invite_token TEXT NULL,\n    ADD COLUMN IF NOT EXISTS referrer TEXT NULL,\n    ADD COLUMN IF NOT EXISTS oauth_client_state_id UUID NULL,\n    ADD COLUMN IF NOT EXISTS linking_target_id UUID NULL,\n    ADD COLUMN IF NOT EXISTS email_optional BOOLEAN NOT NULL DEFAULT FALSE;\n\n-- Make PKCE fields nullable to support implicit flow\n/* auth_migration: 20260115000000 */\nALTER TABLE {{ index .Options \"Namespace\" }}.flow_state\n    ALTER COLUMN code_challenge DROP NOT NULL,\n    ALTER COLUMN code_challenge_method DROP NOT NULL,\n    ALTER COLUMN auth_code DROP NOT NULL;\n\n/* auth_migration: 20260115000000 */\nCOMMENT ON TABLE {{ index .Options \"Namespace\" }}.flow_state\n    IS 'Stores metadata for all OAuth/SSO login flows';\n"
 },
 {
  "version": "20260121000000",
  "name": "20260121000000_add_token_endpoint_auth_method.up.sql",
  "sql": "-- Add token_endpoint_auth_method column to oauth_clients table\n-- Per RFC 7591: \"If unspecified or omitted, the default is 'client_secret_basic'\"\n-- For public clients, the default is 'none' since they don't have a client secret\n/* auth_migration: 20260121000000 */\nalter table {{ index .Options \"Namespace\" }}.oauth_clients\n    add column if not exists token_endpoint_auth_method text check (token_endpoint_auth_method in ('client_secret_basic', 'client_secret_post', 'none'));\n\n-- Set default values for existing clients based on their client_type\n/* auth_migration: 20260121000000 */\nupdate {{ index .Options \"Namespace\" }}.oauth_clients\n    set token_endpoint_auth_method = case\n        when client_type = 'public' then 'none'\n        else 'client_secret_basic'\n    end\n    where token_endpoint_auth_method is null;\n\n-- Now make the column not null\n/* auth_migration: 20260121000000 */\nalter table {{ index .Options \"Namespace\" }}.oauth_clients\n    alter column token_endpoint_auth_method set not null;\n"
 },
 {
  "version": "20260219120000",
  "name": "20260219120000_add_custom_oauth_providers.up.sql",
  "sql": "-- Create unified custom OAuth/OIDC providers table\n-- This table stores both OAuth2 and OIDC providers with type discrimination\n\n/* auth_migration: 20260219120000 */\ncreate table if not exists {{ index .Options \"Namespace\" }}.custom_oauth_providers (\n    id uuid not null default gen_random_uuid(),\n\n    -- Provider type: 'oauth2' or 'oidc'\n    provider_type text not null check (provider_type in ('oauth2', 'oidc')),\n\n    -- Common fields for both OAuth2 and OIDC\n    identifier text not null,\n    name text not null,\n    client_id text not null,\n    client_secret text not null, -- Encrypted at application level\n    -- Store JSON-encoded string slices in jsonb columns\n    acceptable_client_ids text[] not null default '{}', -- Additional client IDs for multi-platform apps\n    scopes text[] not null default '{}',\n    pkce_enabled boolean not null default true,\n    attribute_mapping jsonb not null default '{}',\n    authorization_params jsonb not null default '{}',\n    enabled boolean not null default true,\n    email_optional boolean not null default false, -- Allow sign-in without email\n\n    -- OIDC-specific fields (null for OAuth2 providers)\n    issuer text null,\n    discovery_url text null, -- Optional override for .well-known/openid-configuration\n    skip_nonce_check boolean not null default false,\n    cached_discovery jsonb null,\n    discovery_cached_at timestamptz null,\n\n    -- OAuth2-specific fields (null for OIDC providers)\n    authorization_url text null,\n    token_url text null,\n    userinfo_url text null,\n    jwks_uri text null,\n\n    -- Timestamps\n    created_at timestamptz not null default now(),\n    updated_at timestamptz not null default now(),\n\n    -- Primary key and unique constraints\n    constraint custom_oauth_providers_pkey primary key (id),\n    constraint custom_oauth_providers_identifier_key unique (identifier),\n\n    -- OIDC-specific constraints\n    constraint custom_oauth_providers_oidc_requires_issuer check (\n        provider_type != 'oidc' or issuer is not null\n    ),\n    constraint custom_oauth_providers_oidc_issuer_https check (\n        provider_type != 'oidc' or issuer is null or issuer like 'https://%'\n    ),\n    constraint custom_oauth_providers_oidc_discovery_url_https check (\n        provider_type != 'oidc' or discovery_url is null or discovery_url like 'https://%'\n    ),\n\n    -- OAuth2-specific constraints\n    constraint custom_oauth_providers_oauth2_requires_endpoints check (\n        provider_type != 'oauth2' or (\n            authorization_url is not null and\n            token_url is not null and\n            userinfo_url is not null\n        )\n    ),\n    constraint custom_oauth_providers_authorization_url_https check (\n        authorization_url is null or authorization_url like 'https://%'\n    ),\n    constraint custom_oauth_providers_token_url_https check (\n        token_url is null or token_url like 'https://%'\n    ),\n    constraint custom_oauth_providers_userinfo_url_https check (\n        userinfo_url is null or userinfo_url like 'https://%'\n    ),\n    constraint custom_oauth_providers_jwks_uri_https check (\n        jwks_uri is null or jwks_uri like 'https://%'\n    ),\n\n    -- Format and length constraints\n    -- Identifier must be alphanumeric with optional hyphens (no leading/trailing hyphens)\n    constraint custom_oauth_providers_identifier_format check (\n        identifier ~ '^[a-z0-9][a-z0-9:-]{0,48}[a-z0-9]$'\n    ),\n    constraint custom_oauth_providers_name_length check (\n        char_length(name) >= 1 and char_length(name) <= 100\n    ),\n    constraint custom_oauth_providers_issuer_length check (\n        issuer is null or (char_length(issuer) >= 1 and char_length(issuer) <= 2048)\n    ),\n    constraint custom_oauth_providers_discovery_url_length check (\n        discovery_url is null or char_length(discovery_url) <= 2048\n    ),\n    constraint custom_oauth_providers_authorization_url_length check (\n        authorization_url is null or char_length(authorization_url) <= 2048\n    ),\n    constraint custom_oauth_providers_token_url_length check (\n        token_url is null or char_length(token_url) <= 2048\n    ),\n    constraint custom_oauth_providers_userinfo_url_length check (\n        userinfo_url is null or char_length(userinfo_url) <= 2048\n    ),\n    constraint custom_oauth_providers_jwks_uri_length check (\n        jwks_uri is null or char_length(jwks_uri) <= 2048\n    ),\n    constraint custom_oauth_providers_client_id_length check (\n        char_length(client_id) >= 1 and char_length(client_id) <= 512\n    )\n);\n\n/* auth_migration: 20260219120000 */\ncreate index if not exists custom_oauth_providers_identifier_idx\n    on {{ index .Options \"Namespace\" }}.custom_oauth_providers (identifier);\n\n/* auth_migration: 20260219120000 */\ncreate index if not exists custom_oauth_providers_provider_type_idx\n    on {{ index .Options \"Namespace\" }}.custom_oauth_providers (provider_type);\n\n/* auth_migration: 20260219120000 */\ncreate index if not exists custom_oauth_providers_enabled_idx\n    on {{ index .Options \"Namespace\" }}.custom_oauth_providers (enabled);\n\n/* auth_migration: 20260219120000 */\ncreate index if not exists custom_oauth_providers_created_at_idx\n    on {{ index .Options \"Namespace\" }}.custom_oauth_providers (created_at);\n"
 },
 {
  "version": "20260302000000",
  "name": "20260302000000_add_passkeys.up.sql",
  "sql": "-- WebAuthn credentials table stores passkey credential data\n/* auth_migration: 20260302000000 */\ncreate table if not exists {{ index .Options \"Namespace\" }}.webauthn_credentials (\n    id uuid not null default gen_random_uuid(),\n    user_id uuid not null references {{ index .Options \"Namespace\" }}.users (id) on delete cascade,\n    credential_id bytea not null,\n    public_key bytea not null,\n    attestation_type text not null default '',\n    aaguid uuid,\n    sign_count bigint not null default 0,\n    transports jsonb not null default '[]'::jsonb,\n    backup_eligible boolean not null default false,\n    backed_up boolean not null default false,\n    friendly_name text not null default '',\n    created_at timestamptz not null default now(),\n    updated_at timestamptz not null default now(),\n    last_used_at timestamptz,\n    constraint webauthn_credentials_pkey primary key (id)\n);\n\n/* auth_migration: 20260302000000 */\ncreate unique index if not exists webauthn_credentials_credential_id_key\n    on {{ index .Options \"Namespace\" }}.webauthn_credentials (credential_id);\n\n/* auth_migration: 20260302000000 */\ncreate index if not exists webauthn_credentials_user_id_idx\n    on {{ index .Options \"Namespace\" }}.webauthn_credentials (user_id);\n\n-- WebAuthn challenges table stores temporary challenge/session data\n/* auth_migration: 20260302000000 */\ncreate table if not exists {{ index .Options \"Namespace\" }}.webauthn_challenges (\n    id uuid not null default gen_random_uuid(),\n    user_id uuid references {{ index .Options \"Namespace\" }}.users (id) on delete cascade,\n    challenge_type text not null check (challenge_type in ('signup', 'registration', 'authentication')),\n    session_data jsonb not null,\n    created_at timestamptz not null default now(),\n    expires_at timestamptz not null,\n    constraint webauthn_challenges_pkey primary key (id)\n);\n\n/* auth_migration: 20260302000000 */\ncreate index if not exists webauthn_challenges_user_id_idx\n    on {{ index .Options \"Namespace\" }}.webauthn_challenges (user_id);\n\n/* auth_migration: 20260302000000 */\ncreate index if not exists webauthn_challenges_expires_at_idx\n    on {{ index .Options \"Namespace\" }}.webauthn_challenges (expires_at);\n"
 },
 {
  "version": "20260625000000",
  "name": "20260625000000_add_custom_claims_allowlist.up.sql",
  "sql": "-- Add custom_claims_allowlist column to custom_oauth_providers table\n-- Holds a flat list of raw IdP claim keys to copy verbatim into custom_claims.\n-- Empty (the default) means no custom claims are captured.\n/* auth_migration: 20260625000000 */\nalter table {{ index .Options \"Namespace\" }}.custom_oauth_providers\n    add column if not exists custom_claims_allowlist text[] not null default '{}';\n"
 },
 {
  "version": "20260821000000",
  "name": "20260821000000_add_scim_users.up.sql",
  "sql": "/* auth_migration: 20260821000000 */\n-- SCIM Users provisioned into one SSO provider. The resource is stored as a\n-- document; queryable columns are generated from it so the two cannot drift.\ncreate table if not exists {{ index .Options \"Namespace\" }}.scim_users (\n    id uuid not null,\n    sso_provider_id uuid not null references {{ index .Options \"Namespace\" }}.sso_providers (id) on delete cascade,\n    user_id uuid references {{ index .Options \"Namespace\" }}.users (id) on delete set null,\n    resource jsonb not null,\n    user_name text not null generated always as (lower(resource->>'userName')) stored,\n    external_id text generated always as (resource->>'externalId') stored,\n    active boolean not null generated always as (coalesce((resource->>'active')::boolean, true)) stored,\n    created_at timestamptz not null default now(),\n    updated_at timestamptz not null default now(),\n    deleted_at timestamptz,\n    constraint scim_users_pkey primary key (id)\n);\n\n/* auth_migration: 20260821000000 */\n-- userName is unique within a provider, case-folded, excluding soft-deleted rows.\ncreate unique index if not exists scim_users_user_name_key\n    on {{ index .Options \"Namespace\" }}.scim_users (sso_provider_id, user_name)\n    where deleted_at is null;\n\n/* auth_migration: 20260821000000 */\n-- externalId is unique within a provider when set; nulls are unconstrained.\ncreate unique index if not exists scim_users_external_id_key\n    on {{ index .Options \"Namespace\" }}.scim_users (sso_provider_id, external_id)\n    where external_id is not null and deleted_at is null;\n\n/* auth_migration: 20260821000000 */\n-- Links a SCIM user to its auth.users row; not partial, so an ON DELETE SET\n-- NULL from auth.users can find soft-deleted rows too.\ncreate index if not exists scim_users_user_id_idx\n    on {{ index .Options \"Namespace\" }}.scim_users (user_id);\n\n/* auth_migration: 20260821000000 */\ncreate index if not exists scim_users_id_idx\n    on {{ index .Options \"Namespace\" }}.scim_users (sso_provider_id, id)\n    where deleted_at is null;\n\n/* auth_migration: 20260821000000 */\ncreate index if not exists scim_users_user_name_idx\n    on {{ index .Options \"Namespace\" }}.scim_users (sso_provider_id, user_name collate \"C\", id)\n    where deleted_at is null;\n\n/* auth_migration: 20260821000000 */\ncreate index if not exists scim_users_created_at_idx\n    on {{ index .Options \"Namespace\" }}.scim_users (sso_provider_id, created_at, id)\n    where deleted_at is null;\n\n/* auth_migration: 20260821000000 */\ncreate index if not exists scim_users_updated_at_idx\n    on {{ index .Options \"Namespace\" }}.scim_users (sso_provider_id, updated_at, id)\n    where deleted_at is null;\n\n/* auth_migration: 20260821000000 */\ncreate index if not exists scim_users_sso_provider_id_idx\n    on {{ index .Options \"Namespace\" }}.scim_users (sso_provider_id);\n\n/* auth_migration: 20260821000000 */\n-- Supports purging soft-deleted rows.\ncreate index if not exists scim_users_deleted_at_idx\n    on {{ index .Options \"Namespace\" }}.scim_users (deleted_at);\n"
 },
 {
  "version": "20260821010000",
  "name": "20260821010000_add_scim_tokens.up.sql",
  "sql": "/* auth_migration: 20260821010000 */\n-- Bearer tokens authorising SCIM requests for one SSO provider. Only the\n-- SHA-256 digest is stored; a token carries 160 bits, so the digest needs no salt.\ncreate table if not exists {{ index .Options \"Namespace\" }}.scim_tokens (\n    id uuid not null,\n    sso_provider_id uuid not null references {{ index .Options \"Namespace\" }}.sso_providers (id) on delete cascade,\n    token_hash text not null,\n    prefix text not null,\n    created_at timestamptz not null default now(),\n    expires_at timestamptz,\n    revoked_at timestamptz,\n    last_used_at timestamptz,\n    constraint scim_tokens_pkey primary key (id),\n    constraint scim_tokens_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),\n    constraint scim_tokens_expires_at_future check (expires_at is null or expires_at > created_at),\n    constraint scim_tokens_revoked_after_created check (revoked_at is null or revoked_at >= created_at)\n);\n\n/* auth_migration: 20260821010000 */\n-- The digest resolves a request to a provider, so it is unique across all providers.\ncreate unique index if not exists scim_tokens_token_hash_key\n    on {{ index .Options \"Namespace\" }}.scim_tokens (token_hash);\n\n/* auth_migration: 20260821010000 */\n-- Not partial, so an ON DELETE CASCADE from sso_providers can find revoked\n-- tokens too.\ncreate index if not exists scim_tokens_sso_provider_id_idx\n    on {{ index .Options \"Namespace\" }}.scim_tokens (sso_provider_id);\n\n/* auth_migration: 20260821010000 */\n-- Supports purging expired tokens.\ncreate index if not exists scim_tokens_expires_at_idx\n    on {{ index .Options \"Namespace\" }}.scim_tokens (expires_at);\n\n/* auth_migration: 20260821010000 */\n-- Supports purging revoked tokens.\ncreate index if not exists scim_tokens_revoked_at_idx\n    on {{ index .Options \"Namespace\" }}.scim_tokens (revoked_at);\n"
 },
 {
  "version": "20260824000000",
  "name": "20260824000000_add_recovery_codes_factor_type.up.sql",
  "sql": "/* auth_migration: 20260824000000 */\ndo $$ begin\n    alter type {{ index .Options \"Namespace\" }}.factor_type add value 'recovery_code';\nexception\n    when duplicate_object then null;\nend $$;\n"
 },
 {
  "version": "20260824000001",
  "name": "20260824000001_add_recovery_codes_tables.up.sql",
  "sql": "/* auth_migration: 20260824000001 */\ncreate table if not exists {{ index .Options \"Namespace\" }}.mfa_recovery_code_sets (\n    id uuid primary key,\n    user_id uuid not null unique references {{ index .Options \"Namespace\" }}.users (id) on delete cascade,\n    mfa_factor_id uuid not null unique references {{ index .Options \"Namespace\" }}.mfa_factors (id) on delete cascade,\n    failed_verification_count integer not null default 0 check (failed_verification_count >= 0),\n    verification_locked_until timestamptz,\n    created_at timestamptz not null default now(),\n    updated_at timestamptz not null default now()\n);\n\n/* auth_migration: 20260824000001 */\ncreate table if not exists {{ index .Options \"Namespace\" }}.mfa_recovery_codes (\n    id uuid primary key,\n    mfa_recovery_code_set_id uuid not null references {{ index .Options \"Namespace\" }}.mfa_recovery_code_sets (id) on delete cascade,\n    code_hash text not null,\n    consumed_at timestamptz,\n    created_at timestamptz not null default now()\n);\n\n/* auth_migration: 20260824000001 */\ncreate index if not exists mfa_recovery_codes_set_id_idx\n    on {{ index .Options \"Namespace\" }}.mfa_recovery_codes (mfa_recovery_code_set_id);\n"
 },
 {
  "version": "20260831180000",
  "name": "20260831180000_add_expires_at_to_one_time_tokens.up.sql",
  "sql": "/* auth_migration: 20260831180000 */\nalter table {{ index .Options \"Namespace\" }}.one_time_tokens\n    add column if not exists expires_at timestamptz;\n"
 },
 {
  "version": "20260911120000",
  "name": "20260911120000_add_link_token_hash_to_one_time_tokens.up.sql",
  "sql": "/* auth_migration: 20260911120000 */\n-- High-entropy token hash for link (non-typed) OTP flows.\nalter table {{ index .Options \"Namespace\" }}.one_time_tokens\n    add column if not exists link_token_hash text;\n\ndo $$ begin\n  begin\n    create index if not exists one_time_tokens_link_token_hash_hash_idx on {{ index .Options \"Namespace\" }}.one_time_tokens using hash (link_token_hash);\n  exception when others then\n    -- Fallback to a btree index if hash creation fails\n    create index if not exists one_time_tokens_link_token_hash_hash_idx on {{ index .Options \"Namespace\" }}.one_time_tokens using btree (link_token_hash);\n  end;\nend $$;\n"
 }
];
