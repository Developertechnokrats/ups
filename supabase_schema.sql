-- ============================================================
-- UPS Applicant Dashboard — Supabase Schema  (v2 — fixed dates)
-- Run this entire file in your Supabase SQL Editor
-- If re-running, the ALTER TABLE lines will fix existing columns
-- ============================================================

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
  start_date            date,           -- DATE only, no timezone (was timestamptz)
  applied_count         integer default 0,
  last_appointment_date date,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

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
  status_name           text,
  job_status            text,
  created_at            timestamptz default now()
);

-- If you already ran v1, run these to fix the column type:
-- alter table applicants alter column start_date type date using start_date::date;

alter table applicants enable row level security;
alter table applications enable row level security;

create policy "Allow all on applicants"   on applicants   for all using (true) with check (true);
create policy "Allow all on applications" on applications for all using (true) with check (true);

create index if not exists idx_applicants_start_date   on applicants(start_date);
create index if not exists idx_applicants_last_date    on applicants(last_appointment_date);
create index if not exists idx_applicants_email        on applicants(email);
create index if not exists idx_applications_email      on applications(email);
create index if not exists idx_applications_app_date   on applications(application_date);
create index if not exists idx_applications_applicant  on applications(applicant_id);
