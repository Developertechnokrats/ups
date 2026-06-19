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

function parseDate(str) {
  if (!str) return null
  const s = String(str).trim()
  const fmts = ['dd/MM/yy', 'dd/MM/yyyy', 'yyyy-MM-dd HH:mm:ss', 'yyyy-MM-dd', 'MM/dd/yyyy', 'M/d/yyyy']
  for (const f of fmts) {
    try {
      const d = parse(s, f, new Date())
      if (isValid(d)) return d
    } catch (_) {}
  }
  const d = new Date(s)
  return isValid(d) ? d : null
}

const fmtISO     = d => d ? format(d, 'yyyy-MM-dd') : null
const fmtDisplay = d => d ? format(d, 'dd MMM yyyy') : ''

// ── Core row processor ───────────────────────────────────────────────────
export function processRawRows(rows) {
  const byKey = {}
  for (const r of rows) {
    const appId = String(r['Applicant Id'] || r['applicant_id'] || '').trim()
    const email = (r['Email Address'] || r['Email'] || r['email'] || '').trim().toLowerCase()
    const key   = appId || email
    if (!key) continue
    if (!byKey[key]) byKey[key] = []
    byKey[key].push(r)
  }

  const applicantRows   = []
  const applicationRows = []

  for (const apps of Object.values(byKey)) {
    const first   = apps[0]
    const appId   = String(first['Applicant Id'] || first['applicant_id'] || '').trim() || null
    const email   = (first['Email Address'] || first['Email'] || first['email'] || '').trim().toLowerCase()
    const dates   = apps.map(a => parseDate(a['Date'] || a['application_date'] || '')).filter(Boolean)
    const lastDate= dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null
    const startD  = parseDate(first['Start Date'] || first['start_date'] || '')

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
      start_date:            startD ? startD.toISOString() : null,
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

// ── CSV streaming parser (handles 100MB+) ───────────────────────────────
// Uses Papa streaming so only one chunk lives in memory at a time
export function parseCSVStream(file, onProgress) {
  return new Promise((resolve, reject) => {
    const allRows = []
    let rowCount  = 0
    const fileSizeMB = file.size / 1024 / 1024

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      chunkSize: 1024 * 512, // 512KB chunks
      chunk(results, parser) {
        allRows.push(...results.data)
        rowCount += results.data.length
        onProgress?.({
          stage: 'parsing',
          done:  Math.min(rowCount, 999999),
          pct:   Math.min(99, Math.round((parser.streamer?._input?.position || 0) / file.size * 100))
        })
      },
      complete() {
        onProgress?.({ stage: 'processing', done: allRows.length, pct: 99 })
        // yield to UI thread before heavy processing
        setTimeout(() => {
          try {
            const result = processRawRows(allRows)
            resolve(result)
          } catch(e) { reject(e) }
        }, 0)
      },
      error(err) { reject(new Error('CSV parse error: ' + err.message)) }
    })
  })
}

// ── Excel parser — uses streaming sheet reader for large files ───────────
export function parseExcelStream(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onprogress = e => {
      if (e.lengthComputable)
        onProgress?.({ stage: 'reading', done: e.loaded, pct: Math.round(e.loaded / e.total * 50) })
    }
    reader.onload = e => {
      try {
        onProgress?.({ stage: 'parsing', pct: 60 })
        const wb   = XLSX.read(new Uint8Array(e.target.result), {
          type: 'array',
          cellDates: true,   // parse dates natively
          dense: true,       // memory-efficient dense mode
        })
        const ws   = wb.Sheets[wb.SheetNames[0]]
        onProgress?.({ stage: 'processing', pct: 80 })
        // Use sheet_to_json with raw:false so dates come as strings
        const data = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })
        onProgress?.({ stage: 'processing', pct: 90 })
        setTimeout(() => {
          try {
            const result = processRawRows(data)
            resolve(result)
          } catch(e) { reject(e) }
        }, 0)
      } catch(e) { reject(new Error('Excel parse error: ' + e.message)) }
    }
    reader.onerror = () => reject(new Error('File read failed'))
    reader.readAsArrayBuffer(file)
  })
}

// ── Enrich for display ───────────────────────────────────────────────────
export function enrichForDisplay(applicants) {
  return applicants.map(a => ({
    ...a,
    jobs: (a.applications || []).map(j => ({
      title:    j.job_title    || '',
      date:     j.application_date ? fmtDisplay(new Date(j.application_date + 'T00:00:00')) : '',
      category: classifyJob(j.job_title || ''),
      status:   j.status_name || '',
      dept:     j.department  || '',
    }))
  }))
}

// ── Export CSV ────────────────────────────────────────────────────────────
export function exportToCSV(applicants) {
  const headers = ['Firstname','Lastname','Email','Phone','Last Appointment Date','Applied Count','Notes']
  const rows = applicants
    .filter(a => a.applied_count > 1)
    .map(a => {
      const jobs = a.jobs || (a.applications || []).map(j => ({
        title: j.job_title, date: j.application_date
          ? fmtDisplay(new Date(j.application_date + 'T00:00:00')) : ''
      }))
      const notes = jobs.map(j => `${j.title} -- ${j.date}`).join(' | ')
      const lastDate = a.last_appointment_date
        ? fmtDisplay(new Date(a.last_appointment_date + 'T00:00:00')) : ''
      return [
        a.firstname, a.lastname, a.email, a.phone, lastDate, a.applied_count,
        `"${notes.replace(/"/g, '""')}"`
      ]
    })

  const csv  = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const el   = document.createElement('a')
  el.href     = url
  el.download = `duplicate_applicants_${format(new Date(), 'yyyy-MM-dd')}.csv`
  el.click()
  URL.revokeObjectURL(url)
}
