import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { parse, isValid, format } from 'date-fns'

// ── Job classification ────────────────────────────────────────────────────
export function classifyJob(title = '') {
  const t = title.toLowerCase()
  if (t.includes('supervisor')) return 'Supervisor'
  if (t.includes('admin') || t.includes('director') || t.includes('manager')) return 'Admin'
  if (t.includes('unarmed')) return 'Unarmed'
  if (t.includes('armed')) return 'Armed'
  return 'Unarmed'
}

// ── Date parsing — handles all formats including Excel serials ────────────
function parseDate(val) {
  if (val === null || val === undefined || val === '') return null

  // JS Date object (from XLSX cellDates:true)
  if (val instanceof Date) {
    return isValid(val) && val.getFullYear() > 1900 && val.getFullYear() < 2100 ? val : null
  }

  const s = String(val).trim()
  if (!s || s === 'null' || s === 'undefined' || s === 'N/A') return null

  // Excel serial number: 4–5 digit integer (20000–99999 covers 1954–2173)
  if (/^\d{5}$/.test(s)) {
    const n = Number(s)
    // Excel epoch: Jan 0 1900 = Dec 30 1899
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000)
    if (isValid(d) && d.getFullYear() > 1990 && d.getFullYear() < 2100) return d
  }

  const fmts = [
    'dd/MM/yy', 'dd/MM/yyyy',
    'MM/dd/yyyy', 'M/d/yyyy', 'M/d/yy',
    'd/M/yyyy',  'd/M/yy',
    'yyyy-MM-dd HH:mm:ss', 'yyyy-MM-dd H:mm:ss',
    'yyyy-MM-dd HH:mm',    'yyyy-MM-dd',
  ]
  for (const f of fmts) {
    try {
      const d = parse(s, f, new Date())
      if (isValid(d) && d.getFullYear() > 1900 && d.getFullYear() < 2100) return d
    } catch (_) {}
  }

  // Last resort
  const d = new Date(s)
  return isValid(d) && d.getFullYear() > 1900 && d.getFullYear() < 2100 ? d : null
}

const fmtISO     = d => (d && isValid(d)) ? format(d, 'yyyy-MM-dd') : null
const fmtDisplay = d => (d && isValid(d)) ? format(d, 'dd MMM yyyy') : ''

// Safe display from DB string (yyyy-MM-dd) or any date value
export function safeDisplayDate(val) {
  if (!val || val === 'null' || val === 'undefined') return ''
  const s = String(val).trim()
  // ISO date from DB
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number)
    if (y > 2100 || y < 1900) return '' // reject corrupt years
    return fmtDisplay(new Date(y, m - 1, d))
  }
  const d = parseDate(val)
  return d ? fmtDisplay(d) : ''
}

// ── Core row processor ────────────────────────────────────────────────────
export function processRawRows(rows) {
  const byEmail = {}
  for (const r of rows) {
    const email = (r['Email Address'] || r['Email'] || r['email'] || '').trim().toLowerCase()
    if (!email) continue
    if (!byEmail[email]) byEmail[email] = []
    byEmail[email].push(r)
  }

  const applicantRows   = []
  const applicationRows = []
  const seenEmails      = new Set()

  for (const [email, apps] of Object.entries(byEmail)) {
    if (seenEmails.has(email)) continue
    seenEmails.add(email)

    const first = apps[0]
    const appId = String(first['Applicant Id'] || first['applicant_id'] || '').trim() || null

    const allStartDates = apps
      .map(a => parseDate(a['Start Date'] || a['start_date'] || null))
      .filter(Boolean)
    const startD = allStartDates.length
      ? new Date(Math.min(...allStartDates.map(d => d.getTime()))) : null

    const appDates = apps
      .map(a => parseDate(a['Date'] || a['application_date'] || null))
      .filter(Boolean)
    const lastDate = appDates.length
      ? new Date(Math.max(...appDates.map(d => d.getTime()))) : null

    applicantRows.push({
      applicant_id:          appId,
      firstname:             (first['First Name']  || first['Firstname']  || '').trim(),
      lastname:              (first['Last Name']   || first['Lastname']   || '').trim(),
      email,
      phone:                 (first['Phone Number']|| first['Phone']      || '').trim(),
      city:                  (first['City']        || '').trim(),
      state:                 (first['State']       || '').trim(),
      street_address_1:      (first['Street Address 1'] || '').trim(),
      street_address_2:      (first['Street Address 2'] || '').trim(),
      zip_code:              String(first['Zip Code'] || '').trim(),
      country:               (first['Country']     || '').trim(),
      start_date:            fmtISO(startD),
      applied_count:         apps.length,
      last_appointment_date: fmtISO(lastDate),
    })

    for (const a of apps) {
      const appDate  = parseDate(a['Date'] || a['application_date'] || null)
      const isActive = String(a['Is Job Active'] || a['is_job_active'] || '').toLowerCase()
      applicationRows.push({
        applicant_id:          appId,
        email,
        job_id:                String(a['Job Id']    || a['job_id']    || '').trim(),
        job_title:             (a['Job Title']       || a['job_title'] || '').trim(),
        job_code:              (a['Job Code']        || a['job_code']  || '').trim(),
        department:            (a['Department']      || '').trim(),
        interviewing_managers: (a['Interviewing Managers'] || '').trim(),
        is_job_active:         isActive === 'yes' ? true : isActive === 'no' ? false : null,
        application_date:      fmtISO(appDate),
        status_id:             parseInt(a['Status Id'] || a['status_id'] || '0') || null,
        status_name:           (a['Status Name'] || a['status_name'] || '').trim(),
        job_status:            (a['Status']      || a['job_status']  || '').trim(),
      })
    }
  }

  return { applicantRows, applicationRows }
}

// ── Tags ──────────────────────────────────────────────────────────────────
export function buildTags(jobs = []) {
  const cats = new Set(jobs.map(j => classifyJob(j.job_title || j.title || '')))
  return ['Armed','Unarmed','Admin','Supervisor'].filter(c => cats.has(c)).join(' | ')
}

// ── Enrich for display ────────────────────────────────────────────────────
export function enrichForDisplay(applicants) {
  return applicants.map(a => {
    const jobs = (a.applications || []).map(j => ({
      title:    j.job_title    || '',
      date:     safeDisplayDate(j.application_date),
      category: classifyJob(j.job_title || ''),
      status:   j.status_name || '',
      dept:     j.department  || '',
    }))
    return { ...a, jobs, tags: buildTags(jobs) }
  })
}

// ── CSV streaming parser ──────────────────────────────────────────────────
export function parseCSVStream(file, onProgress) {
  return new Promise((resolve, reject) => {
    const allRows = []
    let rowCount = 0
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      chunkSize: 1024 * 512,
      chunk(results) {
        allRows.push(...results.data)
        rowCount += results.data.length
        onProgress?.({ stage: 'parsing', done: rowCount, pct: Math.min(85, Math.round(rowCount / 500)) })
      },
      complete() {
        onProgress?.({ stage: 'processing', pct: 90 })
        setTimeout(() => {
          try { resolve(processRawRows(allRows)) }
          catch(e) { reject(e) }
        }, 0)
      },
      error(err) { reject(new Error('CSV parse error: ' + err.message)) }
    })
  })
}

// ── Excel parser — cellDates:true converts date cells to JS Date objects ─
export function parseExcelStream(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onprogress = e => {
      if (e.lengthComputable)
        onProgress?.({ stage: 'reading', pct: Math.round(e.loaded / e.total * 50) })
    }
    reader.onload = e => {
      try {
        onProgress?.({ stage: 'parsing', pct: 60 })
        const wb = XLSX.read(new Uint8Array(e.target.result), {
          type: 'array',
          cellDates: true,  // converts date-formatted cells to JS Date objects
          dense:     true,  // memory efficient
        })
        const ws = wb.Sheets[wb.SheetNames[0]]
        // raw:false + cellDates:true = dates come as JS Date objects, text as strings
        const data = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })
        onProgress?.({ stage: 'processing', pct: 85 })
        setTimeout(() => {
          try { resolve(processRawRows(data)) }
          catch(e) { reject(e) }
        }, 0)
      } catch(e) { reject(new Error('Excel parse error: ' + e.message)) }
    }
    reader.onerror = () => reject(new Error('File read failed'))
    reader.readAsArrayBuffer(file)
  })
}

// ── Export CSV ────────────────────────────────────────────────────────────
export function exportToCSV(applicants, filename = 'applicants') {
  const headers = ['Firstname','Lastname','Email','Phone','Last Appointment Date','Applied Count','Tags','Notes']
  const rows = applicants.map(a => {
    const jobs = a.jobs || (a.applications || []).map(j => ({
      title: j.job_title || '',
      date:  safeDisplayDate(j.application_date)
    }))
    const tags    = a.tags || buildTags(jobs)
    const notes   = jobs.map(j => `${j.title} -- ${j.date}`).join(' | ')
    const lastDate = safeDisplayDate(a.last_appointment_date)
    return [
      csvCell(a.firstname), csvCell(a.lastname),
      csvCell(a.email),     csvCell(a.phone),
      csvCell(lastDate),    a.applied_count,
      csvCell(tags),        csvCell(notes),
    ]
  })
  const csv  = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const el   = document.createElement('a')
  el.href = url
  el.download = `${filename}_${format(new Date(), 'yyyy-MM-dd')}.csv`
  el.click()
  URL.revokeObjectURL(url)
}

function csvCell(val) {
  if (val == null) return ''
  const s = String(val)
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"` : s
}
