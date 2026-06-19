import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const isConfigured =
  supabaseUrl &&
  supabaseKey &&
  supabaseUrl !== 'your_supabase_project_url' &&
  supabaseUrl.startsWith('https://')

export const supabase = isConfigured ? createClient(supabaseUrl, supabaseKey) : null
export const hasSupabase = isConfigured

// ── Helpers ───────────────────────────────────────────────────────────────
// Upsert in safe batches, return count saved
async function batchUpsert(table, rows, batchSize = 200, onConflict = null) {
  let saved = 0
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const q = onConflict
      ? supabase.from(table).upsert(batch, { onConflict })
      : supabase.from(table).insert(batch)
    const { error } = await q
    if (error) throw new Error(`${table} batch ${Math.floor(i/batchSize)+1}: ${error.message}`)
    saved += batch.length
  }
  return saved
}

// ── Write ─────────────────────────────────────────────────────────────────
export async function upsertAllData(applicantRows, applicationRows, onProgress) {
  if (!supabase) throw new Error('Supabase not configured')

  // Final dedup by email before any DB call — prevents "ON CONFLICT DO UPDATE
  // command cannot affect row a second time" when same email appears in multiple
  // raw rows (people who applied for multiple jobs).
  const seenEmails = new Set()
  const dedupedApplicants = applicantRows.filter(a => {
    if (!a.email || seenEmails.has(a.email)) return false
    seenEmails.add(a.email)
    return true
  })

  // Step 1: upsert applicants in batches of 200
  for (let i = 0; i < dedupedApplicants.length; i += 200) {
    const batch = dedupedApplicants.slice(i, i + 200)
    const { error } = await supabase
      .from('applicants')
      .upsert(batch, { onConflict: 'email' })
    if (error) throw new Error('Applicants save failed: ' + error.message)
    onProgress?.({ stage: 'applicants', done: Math.min(i + 200, dedupedApplicants.length), total: dedupedApplicants.length })
  }

  // Step 2: delete old applications for these emails (clean slate)
  // Do in chunks to avoid URL length limits
  const emails = dedupedApplicants.map(a => a.email)
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100)
    const { error } = await supabase.from('applications').delete().in('email', chunk)
    if (error) throw new Error('Cleanup failed: ' + error.message)
  }

  // Step 3: insert applications in batches of 200
  onProgress?.({ stage: 'applications', done: 0, total: applicationRows.length })
  let appDone = 0
  for (let i = 0; i < applicationRows.length; i += 200) {
    const batch = applicationRows.slice(i, i + 200)
    const { error } = await supabase.from('applications').insert(batch)
    if (error) throw new Error('Applications save failed: ' + error.message)
    appDone += batch.length
    onProgress?.({ stage: 'applications', done: appDone, total: applicationRows.length })
  }
}

// ── Read ──────────────────────────────────────────────────────────────────
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

  if (fromDate) query = query.gte('start_date', fromDate)
  if (toDate)   query = query.lte('start_date', toDate)

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

// ── Fetch ALL applicants (including single-application ones) ──────────────
export async function fetchAllApplicants({ fromDate, toDate } = {}) {
  if (!supabase) throw new Error('Supabase not configured')
  let query = supabase
    .from('applicants')
    .select(`*, applications (
      id, job_id, job_title, job_code, department,
      interviewing_managers, is_job_active,
      application_date, status_id, status_name, job_status
    )`)
    .order('applied_count', { ascending: false })
    .order('last_appointment_date', { ascending: false })

  if (fromDate) query = query.gte('start_date', fromDate)
  if (toDate)   query = query.lte('start_date', toDate)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

// ── Wipe all data from both tables ────────────────────────────────────────
export async function clearAllData() {
  if (!supabase) throw new Error('Supabase not configured')
  // Delete applications first (foreign key constraint)
  const { error: e1 } = await supabase.from('applications').delete().gte('id', 0)
  if (e1) throw new Error('Failed to clear applications: ' + e1.message)
  const { error: e2 } = await supabase.from('applicants').delete().gte('id', 0)
  if (e2) throw new Error('Failed to clear applicants: ' + e2.message)
}
