import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { parse, isValid, format } from 'date-fns'

export function classifyJob(title = '') {
  const t = title.toLowerCase()
  if (t.includes('supervisor') || t.includes('site supervisor')) return 'Supervisor'
  if (t.includes('admin') || t.includes('director') || t.includes('manager')) return 'Admin'
  if (t.includes('armed')) return 'Armed'
  return 'Unarmed'
}

function parseDate(str) {
  if (!str) return null
  const fmts = ['dd/MM/yy', 'dd/MM/yyyy', 'yyyy-MM-dd HH:mm:ss', 'yyyy-MM-dd', 'MM/dd/yyyy', 'M/d/yyyy']
  for (const f of fmts) {
    try {
      const d = parse(String(str).trim(), f, new Date())
      if (isValid(d)) return d
    } catch (_) {}
  }
  const d = new Date(str)
  return isValid(d) ? d : null
}

function fmtDisplay(d) { return d ? format(d, 'dd MMM yyyy') : '' }
function fmtISO(d)     { return d ? format(d, 'yyyy-MM-dd') : null }

// ── Core processor: turns raw CSV/Excel rows into {applicants[], applications[]} ──
export function processRawRows(rows) {
  // Group by applicant_id (preferred) or email
  const byApplicant = {}

  for (const r of rows) {
    const appId   = String(r['Applicant Id'] || r['applicant_id'] || '').trim()
    const email   = (r['Email Address'] || r['Email'] || r['email'] || '').trim().toLowerCase()
    const key     = appId || email
    if (!key) continue
    if (!byApplicant[key]) byApplicant[key] = []
    byApplicant[key].push(r)
  }

  const applicantRows   = []
  const applicationRows = []

  for (const [, apps] of Object.entries(byApplicant)) {
    const first = apps[0]
    const appId = String(first['Applicant Id'] || first['applicant_id'] || '').trim()
    const email = (first['Email Address'] || first['Email'] || first['email'] || '').trim().toLowerCase()

    // Parse all application dates
    const dates = apps
      .map(a => parseDate(a['Date'] || a['application_date'] || a['date'] || ''))
      .filter(Boolean)
    const lastDate = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null
    const startDate = parseDate(first['Start Date'] || first['start_date'] || '')

    // --- applicants row ---
    applicantRows.push({
      applicant_id:          appId || null,
      firstname:             (first['First Name']  || first['Firstname']  || first['firstname']  || '').trim(),
      lastname:              (first['Last Name']   || first['Lastname']   || first['lastname']   || '').trim(),
      email,
      phone:                 (first['Phone Number']|| first['Phone']      || first['phone']      || '').trim(),
      city:                  (first['City']        || first['city']       || '').trim(),
      state:                 (first['State']       || first['state']      || '').trim(),
      street_address_1:      (first['Street Address 1'] || '').trim(),
      street_address_2:      (first['Street Address 2'] || '').trim(),
      zip_code:              (first['Zip Code']    || first['zip_code']   || '').trim(),
      country:               (first['Country']     || first['country']    || '').trim(),
      start_date:            startDate ? startDate.toISOString() : null,
      applied_count:         apps.length,
      last_appointment_date: fmtISO(lastDate),
    })

    // --- one applications row per job ---
    for (const a of apps) {
      const appDate = parseDate(a['Date'] || a['application_date'] || a['date'] || '')
      const isActive = String(a['Is Job Active'] || a['is_job_active'] || '').toLowerCase()
      applicationRows.push({
        applicant_id:          appId || null,
        email,
        job_id:                String(a['Job Id'] || a['job_id'] || '').trim(),
        job_title:             (a['Job Title'] || a['job_title'] || '').trim(),
        job_code:              (a['Job Code']  || a['job_code']  || '').trim(),
        department:            (a['Department']|| a['department']|| '').trim(),
        interviewing_managers: (a['Interviewing Managers'] || a['interviewing_managers'] || '').trim(),
        is_job_active:         isActive === 'yes' ? true : isActive === 'no' ? false : null,
        application_date:      fmtISO(appDate),
        status_id:             parseInt(a['Status Id'] || a['status_id'] || '0') || null,
        status_name:           (a['Status Name'] || a['status_name'] || '').trim(),
        job_status:            (a['Status'] || a['job_status'] || '').trim(),
      })
    }
  }

  return { applicantRows, applicationRows }
}

// ── Enrich applicants with jobs array for display ────────────────────────
export function enrichForDisplay(applicants) {
  return applicants.map(a => ({
    ...a,
    jobs: (a.applications || []).map(j => ({
      title:    j.job_title,
      date:     j.application_date ? fmtDisplay(new Date(j.application_date + 'T00:00:00')) : '',
      category: classifyJob(j.job_title),
      status:   j.status_name,
      dept:     j.department,
    }))
  }))
}

// ── Notes string builder (for CSV export) ────────────────────────────────
function buildNotes(applicant) {
  const jobs = applicant.jobs || applicant.applications || []
  return jobs.map(j => {
    const title = j.job_title || j.title || ''
    const date  = j.application_date
      ? fmtDisplay(new Date(j.application_date + 'T00:00:00'))
      : (j.date || '')
    return `${title} -- ${date}`
  }).join(' | ')
}

// ── Parse file → raw rows ────────────────────────────────────────────────
export function parseCSV(text) {
  const { data } = Papa.parse(text, { header: true, skipEmptyLines: true })
  return processRawRows(data)
}

export function parseExcel(buffer) {
  const wb   = XLSX.read(buffer, { type: 'array' })
  const ws   = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json(ws, { defval: '' })
  return processRawRows(data)
}

// ── Export CSV (duplicates only, same format as before) ──────────────────
export function exportToCSV(applicants) {
  const headers = ['Firstname','Lastname','Email','Phone','Last Appointment Date','Applied Count','Notes']
  const rows = applicants
    .filter(a => a.applied_count > 1)
    .map(a => {
      const notes = buildNotes(a)
      const lastDate = a.last_appointment_date
        ? fmtDisplay(new Date(a.last_appointment_date + 'T00:00:00'))
        : ''
      return [
        a.firstname,
        a.lastname,
        a.email,
        a.phone,
        lastDate,
        a.applied_count,
        `"${notes.replace(/"/g, '""')}"`
      ]
    })

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const el   = document.createElement('a')
  el.href     = url
  el.download = `duplicate_applicants_${format(new Date(), 'yyyy-MM-dd')}.csv`
  el.click()
  URL.revokeObjectURL(url)
}
