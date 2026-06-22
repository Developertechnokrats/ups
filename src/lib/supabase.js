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

  // Step 2: fetch ALL applications for this page's applicants
  // Must paginate: 50 applicants × avg jobs can easily exceed Supabase's 1000-row default limit
  const emails = applicants.map(a => a.email).filter(Boolean)
  const allApplications = []
  let appFrom = 0
  const APP_PAGE = 1000
  while (true) {
    const { data: appBatch, error: e2 } = await supabase
      .from('applications')
      .select('*')
      .in('email', emails)
      .range(appFrom, appFrom + APP_PAGE - 1)
    if (e2) throw e2
    if (!appBatch || appBatch.length === 0) break
    allApplications.push(...appBatch)
    if (appBatch.length < APP_PAGE) break
    appFrom += APP_PAGE
  }

  return { applicants, applications: allApplications, totalCount: count ?? 0 }
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

// ── Export fetch — gets ALL matching rows for CSV download ────────────────
export async function fetchAllForExport({ fromDate, toDate, duplicatesOnly = false, search = '' } = {}) {
  if (!supabase) throw new Error('Supabase not configured')
  const allApplicants = []
  let page = 0
  const PAGE = 1000  // larger page for export

  while (true) {
    let q = supabase
      .from('applicants')
      .select('*')
      .order('applied_count', { ascending: false })
      .order('last_appointment_date', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1)

    if (duplicatesOnly) q = q.gt('applied_count', 1)
    if (fromDate) q = q.gte('start_date', fromDate)
    if (toDate)   q = q.lte('start_date', toDate)
    if (search?.trim()) {
      const s = search.trim()
      q = q.or(`firstname.ilike.%${s}%,lastname.ilike.%${s}%,email.ilike.%${s}%`)
    }

    const { data, error } = await q
    if (error) throw error
    if (!data || data.length === 0) break
    allApplicants.push(...data)
    if (data.length < PAGE) break
    page++
  }

  if (!allApplicants.length) return []

  // Fetch all applications for these applicants
  const emails = allApplicants.map(a => a.email).filter(Boolean)
  const allApps = []
  for (let i = 0; i < emails.length; i += 500) {
    const { data, error } = await supabase
      .from('applications').select('*').in('email', emails.slice(i, i + 500))
    if (error) throw error
    if (data) allApps.push(...data)
  }

  const appMap = {}
  for (const a of allApps) {
    if (!appMap[a.email]) appMap[a.email] = []
    appMap[a.email].push(a)
  }
  return allApplicants.map(a => ({ ...a, applications: appMap[a.email] || [] }))
}

// ── Update GHL sync status for applicants ─────────────────────────────────
export async function updateGHLStatus(results) {
  if (!supabase || !results.length) return
  for (const r of results) {
    await supabase.from('applicants')
      .update({
        ghl_contact_id: r.contactId || null,
        ghl_status:     r.success ? 'synced' : 'error',
        ghl_synced_at:  new Date().toISOString(),
      })
      .eq('email', r.email)
  }
}

// ── Fetch applicants with full notes built from applications ──────────────
// Used before GHL push so notes is never empty
export async function buildNotesForApplicants(applicants) {
  if (!supabase || !applicants.length) return applicants

  const emails = applicants.map(a => a.email).filter(Boolean)

  // Fetch all applications for these emails
  const allApps = []
  for (let i = 0; i < emails.length; i += 200) {
    const chunk = emails.slice(i, i + 200)
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('applications')
        .select('email, job_title, application_date')
        .in('email', chunk)
        .order('application_date', { ascending: false })
        .range(from, from + 999)
      if (error) break
      if (!data || data.length === 0) break
      allApps.push(...data)
      if (data.length < 1000) break
      from += 1000
    }
  }

  // Group by email
  const appMap = {}
  for (const a of allApps) {
    if (!appMap[a.email]) appMap[a.email] = []
    appMap[a.email].push(a)
  }

  // Build notes string for each applicant
  return applicants.map(a => {
    const jobs = appMap[a.email] || []
    if (!jobs.length) return a
    const notes = jobs
      .map(j => {
        const dateStr = j.application_date
          ? new Date(j.application_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
          : ''
        return `${j.job_title} -- ${dateStr}`
      })
      .join(' | ')
    return { ...a, notes }
  })
}

// ── Appointments ──────────────────────────────────────────────────────────

export async function upsertAppointments(rows, onProgress) {
  if (!supabase) throw new Error('Supabase not configured')

  // Delete all existing for these emails first (clean upsert)
  const emails = [...new Set(rows.map(r => r.email).filter(Boolean))]
  for (let i = 0; i < emails.length; i += 200) {
    const { error } = await supabase
      .from('appointments')
      .delete()
      .in('email', emails.slice(i, i + 200))
    if (error) throw new Error('Appointment cleanup failed: ' + error.message)
  }

  // Insert in batches of 500
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500)
    const { error } = await supabase.from('appointments').insert(batch)
    if (error) throw new Error('Appointment insert failed: ' + error.message)
    onProgress?.({ done: Math.min(i + 500, rows.length), total: rows.length })
    if (i + 500 < rows.length) await new Promise(r => setTimeout(r, 50))
  }
}

export async function fetchAppointmentStats() {
  if (!supabase) return { totalAppointments: 0, uniqueEmails: 0 }
  const [r1, r2] = await Promise.all([
    supabase.from('appointments').select('*', { count: 'exact', head: true }),
    supabase.rpc('count_unique_appointment_emails').single(),
  ])
  return {
    totalAppointments: r1.count ?? 0,
    uniqueEmails: r2.data ?? 0,
  }
}

export async function fetchFreshToContact({ fromDate, toDate, page = 0, search = '' } = {}) {
  if (!supabase) throw new Error('Supabase not configured')
  const from = page * PAGE_SIZE
  const to   = from + PAGE_SIZE - 1

  // Step 1: get emails from cache (fast, indexed)
  const { data: cacheRows, error: cacheErr, count: totalCount } = await supabase
    .from('fresh_to_contact_cache')
    .select('email', { count: 'exact' })
    .range(from, to)

  if (cacheErr) throw cacheErr
  if (!cacheRows?.length) return { applicants: [], totalCount: totalCount ?? 0 }

  const emails = cacheRows.map(r => r.email)

  // Step 2: get full applicant data for this page's emails
  let q = supabase
    .from('applicants')
    .select('*')
    .in('email', emails)
    .order('applied_count', { ascending: false })
    .order('last_appointment_date', { ascending: false })

  if (fromDate) q = q.gte('start_date', fromDate)
  if (toDate)   q = q.lte('start_date', toDate)
  if (search?.trim()) {
    const s = search.trim()
    q = q.or(`firstname.ilike.%${s}%,lastname.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`)
  }

  const { data, error } = await q
  if (error) throw error
  return { applicants: data || [], totalCount: totalCount ?? 0 }
}

export async function fetchFreshStats() {
  if (!supabase) return { freshCount: 0 }
  const [r1, r2] = await Promise.all([
    supabase.from('fresh_to_contact_cache').select('*', { count: 'exact', head: true }),
    supabase.from('appointments').select('*', { count: 'exact', head: true }),
  ])
  return {
    freshCount:       r1.count ?? 0,
    appointmentCount: r2.count ?? 0,
  }
}


// ── Orphaned Appointments ─────────────────────────────────────────────────
export async function fetchOrphanedAppointments({ page = 0, search = '' } = {}) {
  if (!supabase) throw new Error('Supabase not configured')
  const from = page * PAGE_SIZE
  const to   = from + PAGE_SIZE - 1

  let q = supabase
    .from('orphaned_appointments_cache')
    .select('*', { count: 'exact' })
    .order('requested_time', { ascending: false })
    .range(from, to)

  if (search?.trim()) {
    const s = search.trim()
    q = q.or(`email.ilike.%${s}%,contact_name.ilike.%${s}%,phone.ilike.%${s}%`)
  }

  const { data, error, count } = await q
  if (error) throw error
  return { appointments: data || [], totalCount: count ?? 0 }
}

export async function fetchOrphanedStats() {
  if (!supabase) return { orphanedCount: 0 }
  const { count, error } = await supabase
    .from('orphaned_appointments_cache')
    .select('*', { count: 'exact', head: true })
  if (error) return { orphanedCount: 0 }
  return { orphanedCount: count ?? 0 }
}

export async function markAsContacted(appointment) {
  if (!supabase) throw new Error('Supabase not configured')
  const { error } = await supabase
    .from('contacted_overrides')
    .upsert({
      appointment_id: appointment.appointment_id,
      email:          appointment.email,
      contact_name:   appointment.contact_name,
    }, { onConflict: 'appointment_id' })
  if (error) throw new Error('Mark as contacted failed: ' + error.message)
}

export async function unmarkContacted(appointmentId) {
  if (!supabase) throw new Error('Supabase not configured')
  const { error } = await supabase
    .from('contacted_overrides')
    .delete()
    .eq('appointment_id', appointmentId)
  if (error) throw new Error('Unmark failed: ' + error.message)
}

// ── Refresh pre-computed cache tables ─────────────────────────────────────
export async function refreshComputedTables() {
  if (!supabase) return
  const { error } = await supabase.rpc('refresh_computed_tables')
  if (error) throw new Error('Cache refresh failed: ' + error.message)
}
