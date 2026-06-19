import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { parse, isValid, format } from 'date-fns'

export function classifyJob(title = '') {
  const t = title.toLowerCase()
  if (t.includes('supervisor')) return 'Supervisor'
  if (t.includes('admin') || t.includes('director') || t.includes('manager')) return 'Admin'
  if (t.includes('armed')) return 'Armed'
  return 'Unarmed'
}

// Convert Excel serial number (e.g. 45378) to Date
function excelSerialToDate(serial) {
  const n = Number(serial)
  if (isNaN(n) || n < 1 || n > 99999) return null
  const d = new Date((n - 25569) * 86400 * 1000)
  return isValid(d) ? d : null
}

function parseDate(str) {
  if (!str && str !== 0) return null
  const s = String(str).trim()
  if (!s || s === 'null' || s === 'undefined' || s === 'N/A') return null

  // Excel serial number (pure integer, reasonable range)
  if (/^\d{4,6}$/.test(s)) {
    const d = excelSerialToDate(Number(s))
    if (d) return d
  }

  const fmts = [
    'dd/MM/yy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'M/d/yyyy',
    'yyyy-MM-dd HH:mm:ss', 'yyyy-MM-dd HH:mm', 'yyyy-MM-dd',
    'd/M/yyyy', 'd/M/yy',
  ]
  for (const f of fmts) {
    try {
      const d = parse(s, f, new Date())
      if (isValid(d) && d.getFullYear() > 1990 && d.getFullYear() < 2100) return d
    } catch (_) {}
  }
  // Last resort
  const d = new Date(s)
  return isValid(d) && d.getFullYear() > 1990 && d.getFullYear() < 2100 ? d : null
}

export const fmtISO     = d => (d && isValid(d)) ? format(d, 'yyyy-MM-dd') : null
export const fmtDisplay = d => (d && isValid(d)) ? format(d, 'dd MMM yyyy') : ''

export function safeDisplayDate(str) {
  if (!str || str === 'null' || str === 'undefined') return ''
  // Already a display string like "01 Jan 2024"
  if (/^\d{2} [A-Za-z]{3} \d{4}$/.test(String(str).trim())) return str
  // ISO date from DB
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(str).trim())) {
    try {
      const d = new Date(str + 'T00:00:00')
      return isValid(d) ? fmtDisplay(d) : ''
    } catch { return '' }
  }
  const d = parseDate(str)
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

    const allStartDates = apps.map(a => parseDate(a['Start Date'] || a['start_date'] || '')).filter(Boolean)
    const startD = allStartDates.length ? new Date(Math.min(...allStartDates.map(d => d.getTime()))) : null

    const appDates = apps.map(a => parseDate(a['Date'] || a['application_date'] || '')).filter(Boolean)
    const lastDate = appDates.length ? new Date(Math.max(...appDates.map(d => d.getTime()))) : null

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
      zip_code:              (first['Zip Code']    || '').trim(),
      country:               (first['Country']     || '').trim(),
      start_date:            fmtISO(startD),
      applied_count:         apps.length,
      last_appointment_date: fmtISO(lastDate),
    })

    for (const a of apps) {
      const appDate  = parseDate(a['Date'] || a['application_date'] || '')
      const isActive = String(a['Is Job Active'] || a['is_job_active'] || '').toLowerCase()
      applicationRows.push({
        applicant_id:          appId,
        email,
        job_id:                String(a['Job Id']    || a['job_id']    || '').trim(),
        job_title:             (a['Job Title']        || a['job_title'] || '').trim(),
        job_code:              (a['Job Code']         || a['job_code']  || '').trim(),
        department:            (a['Department']       || '').trim(),
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

// ── Build tags ────────────────────────────────────────────────────────────
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
        onProgress?.({ stage: 'parsing', done: rowCount, pct: Math.min(90, Math.round(rowCount / 1000)) })
      },
      complete() {
        onProgress?.({ stage: 'processing', pct: 95 })
        setTimeout(() => {
          try { resolve(processRawRows(allRows)) }
          catch(e) { reject(e) }
        }, 0)
      },
      error(err) { reject(new Error('CSV parse error: ' + err.message)) }
    })
  })
}

// ── Excel parser ──────────────────────────────────────────────────────────
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
        // raw:true keeps numbers as numbers (needed for Excel serial dates)
        const wb   = XLSX.read(new Uint8Array(e.target.result), { type: 'array', dense: true })
        const ws   = wb.Sheets[wb.SheetNames[0]]
        // raw: true preserves serial numbers; we handle conversion in parseDate()
        const data = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true })
        onProgress?.({ stage: 'processing', pct: 80 })
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
      title: j.job_title || '', date: safeDisplayDate(j.application_date)
    }))
    const tags    = a.tags || buildTags(jobs)
    const notes   = jobs.map(j => `${j.title} -- ${j.date}`).join(' | ')
    const lastDate = safeDisplayDate(a.last_appointment_date)
    return [
      csvCell(a.firstname), csvCell(a.lastname), csvCell(a.email), csvCell(a.phone),
      csvCell(lastDate), a.applied_count, csvCell(tags), csvCell(notes),
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
    ? `"${s.replace(/"/g, '""')}"`
    : s
}
