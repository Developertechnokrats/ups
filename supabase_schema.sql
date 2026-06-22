-- ============================================================
-- UPS Applicant Dashboard — Supabase Schema v3
-- Run ALL of this in your Supabase SQL Editor
-- ============================================================

-- Create tables if they don't exist
create table if not exists applicants (
  id                    bigint generated always as identity primary key,
  applicant_id          text unique,
  firstname             text,
  lastname              text,
  email                 text unique not null,
  phone                 text,
  city                  text,
  state                 text,
  street_address_1      text,
  street_address_2      text,
  zip_code              text,
  country               text,
  start_date            date,
  applied_count         integer default 0,
  last_appointment_date date,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create table if not exists applications (
  id                    bigint generated always as identity primary key,
  applicant_id          text,
  email                 text not null,
  job_id                text,
  job_title             text,
  job_code              text,
  department            text,
  interviewing_managers text,
  is_job_active         boolean,
  application_date      date,
  status_id             integer,
  status_name           text,
  job_status            text,
  created_at            timestamptz default now()
);

-- RLS
alter table applicants enable row level security;
alter table applications enable row level security;

drop policy if exists "Allow all on applicants"   on applicants;
drop policy if exists "Allow all on applications" on applications;
create policy "Allow all on applicants"   on applicants   for all using (true) with check (true);
create policy "Allow all on applications" on applications for all using (true) with check (true);

-- Indexes
create index if not exists idx_applicants_start_date   on applicants(start_date);
create index if not exists idx_applicants_last_date    on applicants(last_appointment_date);
create index if not exists idx_applicants_email        on applicants(email);
create index if not exists idx_applications_email      on applications(email);
create index if not exists idx_applications_app_date   on applications(application_date);
create index if not exists idx_applications_applicant  on applications(applicant_id);

-- ============================================================
-- DATA FIX: Convert corrupt Excel serial dates to real dates
-- Excel serial N -> date: '1899-12-30'::date + N
-- This fixes rows where year > 2100 (e.g. year 45378)
-- ============================================================

-- Fix last_appointment_date in applicants
update applicants
set last_appointment_date = ('1899-12-30'::date + extract(epoch from last_appointment_date::timestamptz)::int / 86400)::date
where extract(year from last_appointment_date) > 2100;

-- Simpler approach: if year > 2100, the stored value came from Excel serial
-- The corrupt value is stored as e.g. '45378-01-01' (year=45378)
-- Excel serial = year stored as integer (45378)
-- Real date = '1899-12-30'::date + 45378 days
update applicants
set last_appointment_date = ('1899-12-30'::date + extract(year from last_appointment_date)::int)::date
where last_appointment_date is not null
  and extract(year from last_appointment_date) > 2100;

update applicants
set start_date = ('1899-12-30'::date + extract(year from start_date)::int)::date
where start_date is not null
  and extract(year from start_date) > 2100;

update applications
set application_date = ('1899-12-30'::date + extract(year from application_date)::int)::date
where application_date is not null
  and extract(year from application_date) > 2100;

-- Verify the fix
select
  count(*) as total_applicants,
  count(last_appointment_date) as has_last_date,
  count(start_date) as has_start_date,
  min(last_appointment_date) as earliest_last_date,
  max(last_appointment_date) as latest_last_date,
  sum(case when extract(year from last_appointment_date) > 2100 then 1 else 0 end) as still_corrupt
from applicants;

-- ============================================================
-- GHL Integration — add to applicants table
-- Run these in Supabase SQL Editor
-- ============================================================

alter table applicants
  add column if not exists ghl_contact_id text,
  add column if not exists ghl_synced_at  timestamptz,
  add column if not exists ghl_status     text;   -- 'synced' | 'error' | null

create index if not exists idx_applicants_ghl_id on applicants(ghl_contact_id);


-- ============================================================
-- Appointments table — from GHL export
-- (correct column names matching GHL export file)
-- ============================================================

create table if not exists appointments (
  id                bigint generated always as identity primary key,
  appointment_id    text unique,
  email             text not null,
  contact_name      text,
  requested_time    timestamptz,
  date_added        timestamptz,
  calendar          text,
  phone             text,
  appointment_owner text,
  mode              text,
  source            text,
  outcome           text,
  rescheduled       text,
  created_at        timestamptz default now()
);

create index if not exists idx_appt_email          on appointments(email);
create index if not exists idx_appt_phone          on appointments(phone);
create index if not exists idx_appt_requested      on appointments(requested_time);
create index if not exists idx_appt_appointment_id on appointments(appointment_id);

-- RLS
alter table appointments enable row level security;
drop policy if exists "Allow all on appointments" on appointments;
create policy "Allow all on appointments" on appointments for all using (true) with check (true);


-- Add normalized phone columns for fast indexed phone matching
alter table applicants   add column if not exists phone_normalized text;
alter table appointments add column if not exists phone_normalized text;

-- Populate normalized phones (last 10 digits, digits only)
update applicants
set phone_normalized = right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
where phone is not null and length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 10;

update appointments
set phone_normalized = right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
where phone is not null and length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 10;

-- Index normalized phones and lowercased emails for fast view queries
create index if not exists idx_applicants_phone_norm   on applicants(phone_normalized);
create index if not exists idx_appointments_phone_norm on appointments(phone_normalized);
create index if not exists idx_appointments_email_lower on appointments(lower(email));
create index if not exists idx_applicants_email_lower   on applicants(lower(email));

-- Add has_appointment column if not exists
alter table applicants add column if not exists has_appointment boolean default false;

-- View: Fresh to Contact
-- Uses pre-computed phone_normalized for fast indexed matching (no timeout)
drop view if exists fresh_to_contact_count;
drop view if exists fresh_to_contact;

create view fresh_to_contact as
select
  a.id, a.applicant_id, a.firstname, a.lastname, a.email, a.phone,
  a.city, a.state, a.start_date, a.applied_count,
  a.last_appointment_date, a.ghl_contact_id, a.ghl_status
from applicants a
where
  -- No Hired or Disqualified status
  not exists (
    select 1 from applications ap
    where lower(ap.email) = lower(a.email)
      and lower(ap.status_name) in ('hired', 'disqualified')
  )
  -- No appointment matched by EMAIL or PHONE (pre-computed, indexed)
  and not exists (
    select 1 from appointments apt
    where lower(apt.email) = lower(a.email)
       or (a.phone_normalized is not null
           and apt.phone_normalized is not null
           and apt.phone_normalized = a.phone_normalized)
  );

-- ============================================================
-- fresh_to_contact VIEW
-- (already created above with email + phone matching)


-- ============================================================
-- Orphaned Appointments & Manual Overrides
-- ============================================================

-- Table to store manual "mark as contacted" actions
create table if not exists contacted_overrides (
  id             bigint generated always as identity primary key,
  appointment_id text unique not null,
  email          text,
  contact_name   text,
  note           text,
  marked_at      timestamptz default now()
);

create index if not exists idx_overrides_appointment_id on contacted_overrides(appointment_id);

alter table contacted_overrides enable row level security;
drop policy if exists "Allow all on contacted_overrides" on contacted_overrides;
create policy "Allow all on contacted_overrides" on contacted_overrides for all using (true) with check (true);

-- View: Orphaned Appointments
-- Appointments that have NO match in applicants by email or phone_normalized
-- AND have not been manually marked as contacted
drop view if exists orphaned_appointments;

create view orphaned_appointments as
select
  apt.id,
  apt.appointment_id,
  apt.email,
  apt.contact_name,
  apt.phone,
  apt.phone_normalized,
  apt.requested_time,
  apt.calendar,
  apt.outcome,
  apt.source,
  apt.rescheduled,
  apt.created_at
from appointments apt
where
  -- No match by email
  not exists (
    select 1 from applicants a
    where lower(a.email) = lower(apt.email)
  )
  -- No match by phone_normalized
  and not exists (
    select 1 from applicants a
    where a.phone_normalized is not null
      and apt.phone_normalized is not null
      and a.phone_normalized = apt.phone_normalized
  )
  -- Not manually marked as contacted
  and not exists (
    select 1 from contacted_overrides co
    where co.appointment_id = apt.appointment_id
  );
