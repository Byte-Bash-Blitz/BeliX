-- Safe, additive migration for 45-minute Common Hall attendance.
-- Existing rows are preserved; run this in the Supabase SQL editor.

create table if not exists public.meetings (
  meeting_id bigint generated always as identity primary key,
  title text not null,
  meeting_date date not null,
  meeting_time time without time zone null,
  start_time timestamp with time zone not null,
  end_time timestamp with time zone null,
  duration_minutes integer null,
  attended_members integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.meeting_attendance (
  meeting_attendance_id bigint generated always as identity primary key,
  meeting_id bigint not null references public.meetings(meeting_id) on delete cascade,
  member_id bigint not null references public.members(member_id) on delete cascade,
  username text null,
  display_name text null,
  joined_at timestamp with time zone not null,
  left_at timestamp with time zone not null,
  total_duration_minutes integer not null default 0,
  attendance_percentage integer null,
  points_awarded integer not null default 0,
  created_at timestamp with time zone not null default now()
);

alter table public.meeting_attendance
  add column if not exists attendance_status text,
  add column if not exists voice_duration_minutes integer,
  add column if not exists points_awarded integer default 0;

create index if not exists idx_meeting_attendance_meeting_member
  on public.meeting_attendance (meeting_id, member_id);

create table if not exists public.meeting_voice_sessions (
  voice_session_id bigint generated always as identity primary key,
  meeting_id bigint not null references public.meetings(meeting_id) on delete cascade,
  member_id bigint not null references public.members(member_id) on delete cascade,
  discord_user_id text,
  username text,
  display_name text,
  joined_at timestamp with time zone not null,
  left_at timestamp with time zone not null,
  duration_minutes integer not null default 0,
  created_at timestamp with time zone not null default now(),
  constraint meeting_voice_sessions_time_check check (left_at >= joined_at),
  constraint meeting_voice_sessions_duration_check check (duration_minutes >= 0),
  constraint meeting_voice_sessions_unique_join unique (meeting_id, member_id, joined_at)
);

create index if not exists idx_meeting_voice_sessions_meeting
  on public.meeting_voice_sessions (meeting_id);

alter table public.meeting_voice_sessions
  add column if not exists discord_user_id text,
  add column if not exists username text,
  add column if not exists display_name text;

create table if not exists public.meeting_point_awards (
  meeting_point_award_id bigint generated always as identity primary key,
  meeting_id bigint not null references public.meetings(meeting_id) on delete cascade,
  member_id bigint not null references public.members(member_id) on delete cascade,
  points integer not null default 10,
  awarded_at timestamp with time zone not null default now(),
  constraint meeting_point_awards_unique unique (meeting_id, member_id)
);

create index if not exists idx_meeting_point_awards_member
  on public.meeting_point_awards (member_id);
