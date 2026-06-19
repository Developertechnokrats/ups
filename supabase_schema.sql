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
