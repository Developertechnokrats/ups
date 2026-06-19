import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Only create client if real credentials exist
const isConfigured =
  supabaseUrl &&
  supabaseKey &&
  supabaseUrl !== 'your_supabase_project_url' &&
  supabaseUrl.startsWith('https://')

export const supabase = isConfigured ? createClient(supabaseUrl, supabaseKey) : null
export const hasSupabase = isConfigured

export async function fetchDuplicates({ fromDate, toDate } = {}) {
  if (!supabase) throw new Error('Supabase not configured')
  let query = supabase
    .from('applicants')
    .select(`*, applications (
      id, job_id, job_title, job_code, department,
      interviewing_managers, is_job_active,
      application_date, status_id, status_name, job_status
    )`)
    .gt('applied_count', 1)
    .order('applied_count', { ascending: false })
    .order('last_appointment_date', { ascending: false })

  if (fromDate) query = query.gte('last_appointment_date', fromDate)
  if (toDate)   query = query.lte('last_appointment_date', toDate)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function fetchStats() {
  if (!supabase) throw new Error('Supabase not configured')
  const [r1, r2, r3] = await Promise.all([
    supabase.from('applicants').select('*', { count: 'exact', head: true }),
    supabase.from('applications').select('*', { count: 'exact', head: true }),
    supabase.from('applicants').select('*', { count: 'exact', head: true }).gt('applied_count', 1),
  ])
  return {
    totalApplicants:   r1.count ?? 0,
    totalApplications: r2.count ?? 0,
    duplicates:        r3.count ?? 0,
  }
}

export async function upsertAllData(applicantRows, applicationRows) {
  if (!supabase) throw new Error('Supabase not configured')

  const { error: e1 } = await supabase
    .from('applicants')
    .upsert(applicantRows, { onConflict: 'email' })
  if (e1) throw e1

  const emails = applicantRows.map(a => a.email)
  const { error: e2 } = await supabase.from('applications').delete().in('email', emails)
  if (e2) throw e2

  for (let i = 0; i < applicationRows.length; i += 50) {
    const { error: e3 } = await supabase.from('applications').insert(applicationRows.slice(i, i + 50))
    if (e3) throw e3
  }
}
