-- Run this in your Supabase SQL Editor to set up the table

create table if not exists applicants (
  id bigint generated always as identity primary key,
  firstname text,
  lastname text,
  email text unique not null,
  phone text,
  last_appointment_date date,
  applied_count integer default 0,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable Row Level Security (optional but recommended)
alter table applicants enable row level security;

-- Allow all operations for now (tighten later with auth)
create policy "Allow all" on applicants for all using (true) with check (true);

-- Index for date filtering
create index if not exists idx_applicants_last_date on applicants(last_appointment_date);
