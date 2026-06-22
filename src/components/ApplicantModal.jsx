import { useState, useEffect } from 'react'
import { X, Mail, Phone, MapPin, Briefcase, Calendar, ChevronLeft, ChevronRight, RefreshCw, CalendarCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { classifyJob, safeDisplayDate } from '../lib/dataUtils'
import styles from './ApplicantModal.module.css'

const CAT_COLORS = {
  Unarmed:    { bg: 'var(--green-bg)',  color: 'var(--green-text)'  },
  Armed:      { bg: 'var(--red-bg)',    color: 'var(--red-text)'    },
  Admin:      { bg: 'var(--amber-bg)',  color: 'var(--amber-text)'  },
  Supervisor: { bg: 'var(--purple-bg)', color: 'var(--purple-text)' },
}

const AVATAR_COLORS = [
  ['#E6F1FB','#0C447C'], ['#EAF3DE','#27500A'], ['#FAEEDA','#633806'],
  ['#EEEDFE','#3C3489'], ['#FCEBEB','#791F1F'], ['#E1F5EE','#085041'],
]

const JOBS_PER_PAGE = 20

function initials(first, last) {
  return `${(first||'')[0]||''}${(last||'')[0]||''}`.toUpperCase()
}

function formatDateTime(str) {
  if (!str) return '—'
  try {
    return new Date(str).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
  } catch { return str }
}

export default function ApplicantModal({ applicant, index, onClose }) {
  const [activeTab, setActiveTab]     = useState('jobs')
  const [jobs, setJobs]               = useState([])
  const [loadingJobs, setLoadingJobs] = useState(true)
  const [errorJobs, setErrorJobs]     = useState('')
  const [page, setPage]               = useState(0)
  const [totalJobs, setTotalJobs]     = useState(applicant.applied_count || 0)

  // Appointments — may already be on the applicant object from fetchPage
  const [appointments, setAppointments]         = useState(applicant.appointments || [])
  const [loadingAppts, setLoadingAppts]         = useState(false)
  const [apptsFetched, setApptsFetched]         = useState(!!(applicant.appointments))

  const [bg, fg] = AVATAR_COLORS[(index || 0) % AVATAR_COLORS.length]
  const totalPages = Math.ceil(totalJobs / JOBS_PER_PAGE)

  useEffect(() => { fetchJobs(0) }, [])

  async function fetchJobs(pageNum) {
    setLoadingJobs(true); setErrorJobs('')
    try {
      const from = pageNum * JOBS_PER_PAGE
      const to   = from + JOBS_PER_PAGE - 1
      const { data, error, count } = await supabase
        .from('applications')
        .select('job_title, application_date, status_name, department, job_code, job_status', { count: 'exact' })
        .eq('email', applicant.email)
        .order('application_date', { ascending: false })
        .range(from, to)
      if (error) throw error
      if (count !== null) setTotalJobs(count)
      setJobs((data || []).map(j => ({
        title:       j.job_title || '',
        displayDate: safeDisplayDate(j.application_date),
        category:    classifyJob(j.job_title || ''),
        status:      j.status_name || '',
        dept:        j.department || '',
      })))
      setPage(pageNum)
    } catch(e) { setErrorJobs('Failed: ' + e.message) }
    setLoadingJobs(false)
  }

  async function fetchAppointments() {
    if (apptsFetched) return
    setLoadingAppts(true)
    try {
      // Fetch by email
      const { data: byEmail } = await supabase
        .from('appointments')
        .select('*')
        .ilike('email', applicant.email)
        .order('requested_time', { ascending: false })

      // Fetch by phone_normalized if available
      let byPhone = []
      if (applicant.phone_normalized) {
        const { data: pd } = await supabase
          .from('appointments')
          .select('*')
          .eq('phone_normalized', applicant.phone_normalized)
          .order('requested_time', { ascending: false })
        byPhone = pd || []
      }

      // Merge and dedupe
      const seen = new Set()
      const merged = [...(byEmail||[]), ...byPhone].filter(a => {
        if (seen.has(a.appointment_id)) return false
        seen.add(a.appointment_id); return true
      })
      setAppointments(merged)
      setApptsFetched(true)
    } catch(e) { console.error(e) }
    setLoadingAppts(false)
  }

  function handleTabChange(tab) {
    setActiveTab(tab)
    if (tab === 'appointments') fetchAppointments()
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>

        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.avatar} style={{ background: bg, color: fg }}>
              {initials(applicant.firstname, applicant.lastname)}
            </div>
            <div>
              <h2 className={styles.name}>{applicant.firstname} {applicant.lastname}</h2>
              <div className={styles.contactRow}>
                <span className={styles.contact}><Mail size={12}/> {applicant.email}</span>
                {applicant.phone && <span className={styles.contact}><Phone size={12}/> {applicant.phone}</span>}
                {applicant.city && <span className={styles.contact}><MapPin size={12}/> {applicant.city}{applicant.state ? `, ${applicant.state}` : ''}</span>}
              </div>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}><X size={18}/></button>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeTab==='jobs' ? styles.tabActive : ''}`}
            onClick={() => handleTabChange('jobs')}
          >
            <Briefcase size={13}/> Applications ({totalJobs})
          </button>
          <button
            className={`${styles.tab} ${activeTab==='appointments' ? styles.tabActive : ''}`}
            onClick={() => handleTabChange('appointments')}
          >
            <CalendarCheck size={13}/>
            Appointments {appointments.length > 0 ? `(${appointments.length})` : applicant.has_appointment ? '' : '(0)'}
            {applicant.has_appointment && <span className={styles.interviewDot}/>}
          </button>
        </div>

        {/* ── Jobs Tab ── */}
        {activeTab === 'jobs' && (
          <div className={styles.tableWrap}>
            {loadingJobs && <div className={styles.loading}><RefreshCw size={18} className={styles.spin}/> Loading…</div>}
            {errorJobs  && <div className={styles.errorBox}>{errorJobs}</div>}
            {!loadingJobs && jobs.length > 0 && (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.thType}>Type</th>
                    <th>Job Title</th>
                    <th className={styles.thDept}>Department</th>
                    <th className={styles.thStatus}>Status</th>
                    <th className={styles.thDate}>Date Applied</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j, i) => {
                    const c = CAT_COLORS[j.category] || CAT_COLORS.Unarmed
                    return (
                      <tr key={i} className={i%2===0 ? styles.rowEven : styles.rowOdd}>
                        <td><span className={styles.catBadge} style={{ background: c.bg, color: c.color }}>{j.category.toUpperCase()}</span></td>
                        <td className={styles.jobTitle}>{j.title}</td>
                        <td className={styles.dept}>{j.dept||'—'}</td>
                        <td><span className={`${styles.statusBadge} ${styles['status_'+j.status.replace(/[^a-z]/gi,'_').toLowerCase()]}`}>{j.status||'—'}</span></td>
                        <td className={styles.dateCell}>{j.displayDate||'—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            {!loadingJobs && jobs.length === 0 && !errorJobs && <div className={styles.loading}>No applications found.</div>}

            {totalPages > 1 && (
              <div className={styles.pagination}>
                <button className={styles.pageBtn} onClick={() => fetchJobs(0)} disabled={page===0||loadingJobs}>««</button>
                <button className={styles.pageBtn} onClick={() => fetchJobs(page-1)} disabled={page===0||loadingJobs}><ChevronLeft size={14}/></button>
                {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                  let p = totalPages<=7 ? i : page<4 ? i : page>totalPages-5 ? totalPages-7+i : page-3+i
                  return <button key={p} className={`${styles.pageBtn} ${p===page?styles.pageBtnActive:''}`} onClick={() => fetchJobs(p)} disabled={loadingJobs}>{p+1}</button>
                })}
                <button className={styles.pageBtn} onClick={() => fetchJobs(page+1)} disabled={page>=totalPages-1||loadingJobs}><ChevronRight size={14}/></button>
                <button className={styles.pageBtn} onClick={() => fetchJobs(totalPages-1)} disabled={page>=totalPages-1||loadingJobs}>»»</button>
                <span className={styles.pageInfo}>{page*JOBS_PER_PAGE+1}–{Math.min((page+1)*JOBS_PER_PAGE,totalJobs)} of {totalJobs}</span>
              </div>
            )}
          </div>
        )}

        {/* ── Appointments Tab ── */}
        {activeTab === 'appointments' && (
          <div className={styles.tableWrap}>
            {loadingAppts && <div className={styles.loading}><RefreshCw size={18} className={styles.spin}/> Loading appointments…</div>}
            {!loadingAppts && appointments.length === 0 && (
              <div className={styles.loading}>No appointments found for this contact.</div>
            )}
            {!loadingAppts && appointments.length > 0 && (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Appointment Date</th>
                    <th>Calendar</th>
                    <th>Outcome</th>
                    <th>Source</th>
                    <th>Mode</th>
                    <th>Owner</th>
                    <th>Rescheduled</th>
                    <th>Date Added</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((apt, i) => (
                    <tr key={apt.appointment_id||i} className={i%2===0?styles.rowEven:styles.rowOdd}>
                      <td className={styles.dateCell}>{formatDateTime(apt.requested_time)}</td>
                      <td className={styles.jobTitle}>{apt.calendar||'—'}</td>
                      <td>
                        <span className={`${styles.statusBadge} ${apt.outcome==='confirmed'?styles.status_hired:apt.outcome==='cancelled'?styles.status_filed__no_thanks_:styles.status_new}`}>
                          {apt.outcome||'—'}
                        </span>
                      </td>
                      <td className={styles.dept}>{apt.source||'—'}</td>
                      <td className={styles.dept}>{apt.mode||'—'}</td>
                      <td className={styles.dept}>{apt.appointment_owner||'—'}</td>
                      <td className={styles.dept}>{apt.rescheduled||'—'}</td>
                      <td className={styles.dateCell}>{formatDateTime(apt.date_added)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
