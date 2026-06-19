-- ============================================================
-- UPS Applicant Dashboard — Supabase Schema
-- Run this entire file in your Supabase SQL Editor
-- ============================================================

-- TABLE 1: One row per unique person
create table if not exists applicants (
  id                    bigint generated always as identity primary key,
  applicant_id          text unique,           -- original ID from CSV (e.g. 10001357)
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
  start_date            timestamptz,           -- original application/start date
  applied_count         integer default 0,     -- total jobs applied (computed on upload)
  last_appointment_date date,                  -- most recent job application date
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- TABLE 2: One row per job application (many per applicant)
create table if not exists applications (
  id                    bigint generated always as identity primary key,
  applicant_id          text references applicants(applicant_id) on delete cascade,
  email                 text not null,
  job_id                text,
  job_title             text,
  job_code              text,
  department            text,
  interviewing_managers text,
  is_job_active         boolean,
  application_date      date,
  status_id             integer,
  status_name           text,                  -- Hired | Filed (No Thanks) | New
  job_status            text,                  -- Suspended etc.
  created_at            timestamptz default now()
);

-- Enable Row Level Security
alter table applicants enable row level security;
alter table applications enable row level security;

-- Open policies (tighten later when you add auth)
create policy "Allow all on applicants"    on applicants    for all using (true) with check (true);
create policy "Allow all on applications"  on applications  for all using (true) with check (true);

-- Indexes for fast filtering
create index if not exists idx_applicants_last_date   on applicants(last_appointment_date);
create index if not exists idx_applicants_email       on applicants(email);
create index if not exists idx_applications_email     on applications(email);
create index if not exists idx_applications_app_date  on applications(application_date);
create index if not exists idx_applications_applicant on applications(applicant_id);
