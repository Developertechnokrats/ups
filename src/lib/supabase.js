import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

// ── Fetch applicants with optional date range ─────────────────────────────
export async function fetchApplicants({ fromDate, toDate } = {}) {
  let query = supabase
    .from('applicants')
    .select(`
      *,
      applications (
        id, job_id, job_title, job_code, department,
        interviewing_managers, is_job_active,
        application_date, status_id, status_name, job_status
      )
    `)
    .order('last_appointment_date', { ascending: false })

  if (fromDate) query = query.gte('last_appointment_date', fromDate)
  if (toDate)   query = query.lte('last_appointment_date', toDate)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

// ── Fetch only duplicates (applied_count > 1) ─────────────────────────────
export async function fetchDuplicates({ fromDate, toDate } = {}) {
  let query = supabase
    .from('applicants')
    .select(`
      *,
      applications (
        id, job_id, job_title, job_code, department,
        interviewing_managers, is_job_active,
        application_date, status_id, status_name, job_status
      )
    `)
    .gt('applied_count', 1)
    .order('applied_count', { ascending: false })
    .order('last_appointment_date', { ascending: false })

  if (fromDate) query = query.gte('last_appointment_date', fromDate)
  if (toDate)   query = query.lte('last_appointment_date', toDate)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

// ── Fetch all applicants (including non-duplicates) ───────────────────────
export async function fetchAllApplicants({ fromDate, toDate } = {}) {
  let query = supabase
    .from('applicants')
    .select(`
      *,
      applications (
        id, job_id, job_title, job_code, department,
        interviewing_managers, is_job_active,
        application_date, status_id, status_name, job_status
      )
    `)
    .order('last_appointment_date', { ascending: false })

  if (fromDate) query = query.gte('last_appointment_date', fromDate)
  if (toDate)   query = query.lte('last_appointment_date', toDate)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

// ── Upsert all applicants + their applications ────────────────────────────
export async function upsertAllData(applicantRows, applicationRows) {
  // 1. Upsert applicants
  const { error: e1 } = await supabase
    .from('applicants')
    .upsert(applicantRows, { onConflict: 'email' })
  if (e1) throw e1

  // 2. Delete old applications for these emails, then re-insert
  const emails = applicantRows.map(a => a.email)
  const { error: e2 } = await supabase
    .from('applications')
    .delete()
    .in('email', emails)
  if (e2) throw e2

  // 3. Insert fresh applications in batches of 50
  for (let i = 0; i < applicationRows.length; i += 50) {
    const batch = applicationRows.slice(i, i + 50)
    const { error: e3 } = await supabase.from('applications').insert(batch)
    if (e3) throw e3
  }
}

// ── Stats counts ──────────────────────────────────────────────────────────
export async function fetchStats() {
  const [{ count: totalApplicants }, { count: totalApplications }, { count: duplicates }] = await Promise.all([
    supabase.from('applicants').select('*', { count: 'exact', head: true }),
    supabase.from('applications').select('*', { count: 'exact', head: true }),
    supabase.from('applicants').select('*', { count: 'exact', head: true }).gt('applied_count', 1),
  ])
  return { totalApplicants, totalApplications, duplicates }
}
