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
      const d = parse(str.trim(), f, new Date())
      if (isValid(d)) return d
    } catch (_) {}
  }
  const d = new Date(str)
  return isValid(d) ? d : null
}

function formatDate(d) {
  if (!d) return ''
  return format(d, 'dd MMM yyyy')
}

export function processRawRows(rows) {
  // Group by email
  const byEmail = {}
  for (const r of rows) {
    const email = (r['Email Address'] || r['Email'] || r['email'] || '').trim().toLowerCase()
    if (!email) continue
    if (!byEmail[email]) byEmail[email] = []
    byEmail[email].push(r)
  }

  const result = []
  for (const [email, apps] of Object.entries(byEmail)) {
    if (apps.length < 2) continue // only duplicates
    const first = apps[0]
    const dates = apps.map(a => parseDate(a['Date'] || a['date'] || '')).filter(Boolean)
    const lastDate = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null

    const notesParts = apps.map(a => {
      const d = parseDate(a['Date'] || a['date'] || '')
      const dateStr = d ? formatDate(d) : (a['Date'] || '')
      const title = a['Job Title'] || a['JobTitle'] || a['job_title'] || ''
      return `${title} -- ${dateStr}`
    })

    result.push({
      firstname: (first['First Name'] || first['Firstname'] || first['firstname'] || '').trim(),
      lastname: (first['Last Name'] || first['Lastname'] || first['lastname'] || '').trim(),
      email,
      phone: (first['Phone Number'] || first['Phone'] || first['phone'] || '').trim(),
      last_appointment_date: lastDate ? format(lastDate, 'yyyy-MM-dd') : null,
      applied_count: apps.length,
      notes: notesParts.join(' | '),
      // extra for display
      jobs: apps.map(a => {
        const d = parseDate(a['Date'] || a['date'] || '')
        return {
          title: a['Job Title'] || a['JobTitle'] || a['job_title'] || '',
          date: d ? formatDate(d) : (a['Date'] || ''),
          category: classifyJob(a['Job Title'] || a['JobTitle'] || a['job_title'] || '')
        }
      })
    })
  }

  result.sort((a, b) => b.applied_count - a.applied_count)
  return result
}

export function parseCSV(text) {
  const { data } = Papa.parse(text, { header: true, skipEmptyLines: true })
  return processRawRows(data)
}

export function parseExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json(ws, { defval: '' })
  return processRawRows(data)
}

export function exportToCSV(applicants) {
  const headers = ['Firstname', 'Lastname', 'Email', 'Phone', 'Last Appointment Date', 'Applied Count', 'Notes']
  const rows = applicants.map(a => [
    a.firstname,
    a.lastname,
    a.email,
    a.phone,
    a.last_appointment_date ? format(new Date(a.last_appointment_date), 'dd MMM yyyy') : '',
    a.applied_count,
    `"${(a.notes || '').replace(/"/g, '""')}"`
  ])
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `duplicate_applicants_${format(new Date(), 'yyyy-MM-dd')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
