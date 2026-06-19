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
const sleep = ms => new Promise(r => setTimeout(r, ms))

// Retry a single async operation up to `attempts` times with exponential backoff
async function withRetry(fn, attempts = 3, baseDelayMs = 500) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i === attempts - 1) throw e
      await sleep(baseDelayMs * Math.pow(2, i))  // 500ms, 1000ms, 2000ms
    }
  }
}

// Send batches sequentially with a small pause between each to avoid
// overwhelming Supabase's connection pool on large uploads
async function batchedWrite(table, rows, operation, batchSize, pauseMs, onProgress) {
  const total = rows.length
  let done = 0
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    await withRetry(() => operation(batch))
    done += batch.length
    onProgress?.({ done, total })
    if (i + batchSize < rows.length) await sleep(pauseMs)
  }
}

// ── Write ─────────────────────────────────────────────────────────────────
export async function upsertAllData(applicantRows, applicationRows, onProgress) {
  if (!supabase) throw new Error('Supabase not configured')

  // Dedup applicants by email — prevents ON CONFLICT collision within same batch
  const seenEmails = new Set()
  const dedupedApplicants = applicantRows.filter(a => {
    if (!a.email || seenEmails.has(a.email)) return false
    seenEmails.add(a.email)
    return true
  })

  // ── Step 1: Upsert applicants ──────────────────────────────────────────
  // 100 rows/batch, 150ms pause → safe for large files, ~3-4 min for 100k
  onProgress?.({ stage: 'applicants', done: 0, total: dedupedApplicants.length })
  await batchedWrite(
    'applicants',
    dedupedApplicants,
    async (batch) => {
      const { error } = await supabase
        .from('applicants')
        .upsert(batch, { onConflict: 'email' })
      if (error) throw new Error('Applicants save failed: ' + error.message)
    },
    100,   // batch size
    150,   // ms between batches
    ({ done, total }) => onProgress?.({ stage: 'applicants', done, total })
  )

  // ── Step 2: Wipe old applications (TRUNCATE-style via delete all) ──────
  // For large datasets, deleting by email list is too slow.
  // Instead: delete ALL applications then re-insert fresh.
  // This is safe because we just re-upserted all applicants above.
  onProgress?.({ stage: 'clearing', done: 0, total: 1 })
  await withRetry(async () => {
    const { error } = await supabase.from('applications').delete().gte('id', 0)
    if (error) throw new Error('Cleanup failed: ' + error.message)
  })

  // ── Step 3: Insert applications ────────────────────────────────────────
  // 50 rows/batch for applications (more columns = bigger payload), 100ms pause
  onProgress?.({ stage: 'applications', done: 0, total: applicationRows.length })
  await batchedWrite(
    'applications',
    applicationRows,
    async (batch) => {
      const { error } = await supabase.from('applications').insert(batch)
      if (error) throw new Error('Applications save failed: ' + error.message)
    },
    50,    // batch size
    100,   // ms between batches
    ({ done, total }) => onProgress?.({ stage: 'applications', done, total })
  )
}

// ── Read ──────────────────────────────────────────────────────────────────
// For large datasets, fetch applicants and their applications in two separate
// queries then join in JS — avoids Supabase's nested select row limit (1000)
async function fetchApplicantsBase(filter = {}) {
  const { fromDate, toDate, duplicatesOnly = false } = filter

  let query = supabase
    .from('applicants')
    .select('*')
    .order('applied_count', { ascending: false })
    .order('last_appointment_date', { ascending: false })

  if (duplicatesOnly) query = query.gt('applied_count', 1)
  if (fromDate) query = query.gte('start_date', fromDate)
  if (toDate)   query = query.lte('start_date', toDate)

  // Paginate through all results (Supabase default limit is 1000)
  const allRows = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await query.range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    allRows.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return allRows
}

async function fetchApplicationsForApplicants(applicantIds) {
  if (!applicantIds.length) return []
  const allApps = []
  // Fetch in chunks of 500 IDs
  for (let i = 0; i < applicantIds.length; i += 500) {
    const chunk = applicantIds.slice(i, i + 500)
    let from = 0
    const PAGE = 1000
    while (true) {
      const { data, error } = await supabase
        .from('applications')
        .select('*')
        .in('applicant_id', chunk)
        .range(from, from + PAGE - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      allApps.push(...data)
      if (data.length < PAGE) break
      from += PAGE
    }
  }
  return allApps
}

function joinApplicantsAndApplications(applicants, applications) {
  const appMap = {}
  for (const a of applications) {
    const key = a.applicant_id || a.email
    if (!appMap[key]) appMap[key] = []
    appMap[key].push(a)
  }
  return applicants.map(a => ({
    ...a,
    applications: appMap[a.applicant_id || a.email] || []
  }))
}

export async function fetchDuplicates({ fromDate, toDate } = {}) {
  if (!supabase) throw new Error('Supabase not configured')
  const applicants = await fetchApplicantsBase({ fromDate, toDate, duplicatesOnly: true })
  const apps = await fetchApplicationsForApplicants(applicants.map(a => a.applicant_id).filter(Boolean))
  return joinApplicantsAndApplications(applicants, apps)
}

export async function fetchAllApplicants({ fromDate, toDate } = {}) {
  if (!supabase) throw new Error('Supabase not configured')
  const applicants = await fetchApplicantsBase({ fromDate, toDate, duplicatesOnly: false })
  const apps = await fetchApplicationsForApplicants(applicants.map(a => a.applicant_id).filter(Boolean))
  return joinApplicantsAndApplications(applicants, apps)
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

// ── Clear all data ────────────────────────────────────────────────────────
export async function clearAllData() {
  if (!supabase) throw new Error('Supabase not configured')
  const { error: e1 } = await supabase.from('applications').delete().gte('id', 0)
  if (e1) throw new Error('Failed to clear applications: ' + e1.message)
  const { error: e2 } = await supabase.from('applicants').delete().gte('id', 0)
  if (e2) throw new Error('Failed to clear applicants: ' + e2.message)
}
