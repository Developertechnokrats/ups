import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const isConfigured = supabaseUrl && supabaseKey &&
  supabaseUrl !== 'your_supabase_project_url' && supabaseUrl.startsWith('https://')

export const supabase   = isConfigured ? createClient(supabaseUrl, supabaseKey) : null
export const hasSupabase = isConfigured
export const PAGE_SIZE   = 50

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function withRetry(fn, attempts = 3, base = 600) {
  for (let i = 0; i < attempts; i++) {
    try { return await fn() }
    catch(e) { if (i === attempts - 1) throw e; await sleep(base * 2 ** i) }
  }
}

// ── Stats — counts only, instant ─────────────────────────────────────────
export async function fetchStats() {
  if (!supabase) throw new Error('Supabase not configured')
  const [r1, r2, r3] = await Promise.all([
    supabase.from('applicants').select('*', { count: 'exact', head: true }),
    supabase.from('applications').select('*', { count: 'exact', head: true }),
    supabase.from('applicants').select('*', { count: 'exact', head: true }).gt('applied_count', 1),
  ])
  if (r1.error) throw r1.error
  return { totalApplicants: r1.count ?? 0, totalApplications: r2.count ?? 0, duplicates: r3.count ?? 0 }
}

// ── Paginated fetch — returns one page of applicants + their applications ─
export async function fetchPage({ fromDate, toDate, duplicatesOnly = false, page = 0, search = '' } = {}) {
  if (!supabase) throw new Error('Supabase not configured')

  const from = page * PAGE_SIZE
  const to   = from + PAGE_SIZE - 1

  // Step 1: get applicants for this page
  let q = supabase
    .from('applicants')
    .select('*', { count: 'exact' })
    .order('applied_count',         { ascending: false })
    .order('last_appointment_date', { ascending: false })
    .range(from, to)

  if (duplicatesOnly) q = q.gt('applied_count', 1)
  if (fromDate)       q = q.gte('start_date', fromDate)
  if (toDate)         q = q.lte('start_date', toDate)
  if (search?.trim()) {
    const s = search.trim()
    q = q.or(`firstname.ilike.%${s}%,lastname.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`)
  }

  const { data: applicants, error, count } = await q
  if (error) throw error
  if (!applicants?.length) return { applicants: [], applications: [], totalCount: count ?? 0 }

  // Step 2: fetch applications only for this page's emails (fast, small set)
  const emails = applicants.map(a => a.email).filter(Boolean)
  const { data: applications, error: e2 } = await supabase
    .from('applications')
    .select('*')
    .in('email', emails)
  if (e2) throw e2

  return { applicants, applications: applications || [], totalCount: count ?? 0 }
}

// ── Write — batched with progress ────────────────────────────────────────
export async function upsertAllData(applicantRows, applicationRows, onProgress) {
  if (!supabase) throw new Error('Supabase not configured')

  const seen = new Set()
  const deduped = applicantRows.filter(a => {
    if (!a.email || seen.has(a.email)) return false
    seen.add(a.email); return true
  })

  // 1. Upsert applicants in batches of 500
  for (let i = 0; i < deduped.length; i += 500) {
    const batch = deduped.slice(i, i + 500)
    await withRetry(async () => {
      const { error } = await supabase.from('applicants').upsert(batch, { onConflict: 'email' })
      if (error) throw new Error('Applicants save failed: ' + error.message)
    })
    onProgress?.({ stage: 'applicants', done: Math.min(i + 500, deduped.length), total: deduped.length })
    if (i + 500 < deduped.length) await sleep(50)
  }

  // 2. Wipe all old applications
  onProgress?.({ stage: 'clearing', done: 0, total: 1 })
  await withRetry(async () => {
    const { error } = await supabase.from('applications').delete().gte('id', 0)
    if (error) throw new Error('Cleanup failed: ' + error.message)
  })

  // 3. Insert applications in batches of 500
  for (let i = 0; i < applicationRows.length; i += 500) {
    const batch = applicationRows.slice(i, i + 500)
    await withRetry(async () => {
      const { error } = await supabase.from('applications').insert(batch)
      if (error) throw new Error('Applications save failed: ' + error.message)
    })
    onProgress?.({ stage: 'applications', done: Math.min(i + 500, applicationRows.length), total: applicationRows.length })
    if (i + 500 < applicationRows.length) await sleep(50)
  }
}

// ── Clear all ─────────────────────────────────────────────────────────────
export async function clearAllData() {
  if (!supabase) throw new Error('Supabase not configured')
  const { error: e1 } = await supabase.from('applications').delete().gte('id', 0)
  if (e1) throw new Error('Failed to clear applications: ' + e1.message)
  const { error: e2 } = await supabase.from('applicants').delete().gte('id', 0)
  if (e2) throw new Error('Failed to clear applicants: ' + e2.message)
}
