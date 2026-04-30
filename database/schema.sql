-- Database schema for BeliX Belmont Server (Supabase/PostgreSQL)

-- Members table to store member information and progress
create table public.members (
  member_id bigint not null,
  display_name text null,
  role text null,
  birthday date null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  discord_username text null,
  name text null,
  personal_email text null,
  academic_email text null,
  mobile_number text null,
  whatsapp_number text null,
  github_username text null,
  hackerrank_username text null,
  leetcode_username text null,
  instagram_username text null,
  duolingo_username text null,
  linkedin_url text null,
  portfolio_url text null,
  resume_url text null,
  belmonts_points integer null default 0,
  basher_no text null,
  joined_as_basher_date date null,
  dailyprogress integer null default 0,
  gpa text null,
  testimony text null,
  hobbies text null,
  roll_number text null,
  batch text null,
  problem_solved bigint null,
  members_discord_id bigint null,
  domain text null,
  constraint members_pkey primary key (member_id),
  constraint members_members_discord_id_key unique (members_discord_id)
) TABLESPACE pg_default;

create index IF not exists idx_members_birthday on public.members using btree (birthday) TABLESPACE pg_default;

create index IF not exists idx_members_discord_username on public.members using btree (discord_username) TABLESPACE pg_default;


-- Discord activity table to track member activities in the Belmonts Discord server
create table public.discord_activity (
  activity_id bigserial not null,
  member_id bigint null,
  discord_username text not null,
  activity_type text not null,
  channel_id text null,
  channel_name text null,
  message_count integer null default 0,
  voice_duration_minutes integer null default 0,
  reaction_count integer null default 0,
  activity_date date not null,
  activity_timestamp timestamp with time zone not null default now(),
  metadata jsonb null,
  created_at timestamp with time zone not null default now(),
  display_name text null,
  constraint discord_activity_pkey primary key (activity_id),
  constraint discord_activity_member_id_fkey foreign KEY (member_id) references members (member_id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_discord_activity_member_id on public.discord_activity using btree (member_id) TABLESPACE pg_default;

create index IF not exists idx_discord_activity_discord_username on public.discord_activity using btree (discord_username) TABLESPACE pg_default;

create index IF not exists idx_discord_activity_date on public.discord_activity using btree (activity_date) TABLESPACE pg_default;

create index IF not exists idx_discord_activity_type on public.discord_activity using btree (activity_type) TABLESPACE pg_default;


-- Points table to track member points and progress
create table public.points (
  member_id bigint not null,
  points integer not null default 0,
  last_update timestamp with time zone null,
  updated_at timestamp with time zone not null default now(),
  id bigint generated always as identity not null,
  constraint points_pkey primary key (id),
  constraint points_member_id_fkey foreign KEY (member_id) references members (member_id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_points_member_id on public.points using btree (member_id) TABLESPACE pg_default;