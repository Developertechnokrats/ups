import { useState, useEffect } from 'react'
import { X, Mail, Phone, MapPin, Briefcase, Calendar, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
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

export default function ApplicantModal({ applicant, index, onClose }) {
  const [jobs, setJobs]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [page, setPage]           = useState(0)
  const [totalJobs, setTotalJobs] = useState(applicant.applied_count || 0)

  const [bg, fg] = AVATAR_COLORS[(index || 0) % AVATAR_COLORS.length]

  const totalPages = Math.ceil(totalJobs / JOBS_PER_PAGE)

  useEffect(() => {
    fetchJobs(0)
  }, [])

  async function fetchJobs(pageNum) {
    setLoading(true)
    setError('')
    try {
      const from = pageNum * JOBS_PER_PAGE
      const to   = from + JOBS_PER_PAGE - 1

      const { data, error: e, count } = await supabase
        .from('applications')
        .select('job_title, application_date, status_name, department, job_code, job_status', { count: 'exact' })
        .eq('email', applicant.email)
        .order('application_date', { ascending: false })
        .range(from, to)

      if (e) throw e
      if (count !== null) setTotalJobs(count)

      setJobs((data || []).map(j => ({
        title:            j.job_title       || '',
        date:             j.application_date|| '',   // keep ISO for sorting
        displayDate:      safeDisplayDate(j.application_date),
        category:         classifyJob(j.job_title || ''),
        status:           j.status_name     || '',
        dept:             j.department      || '',
        code:             j.job_code        || '',
        jobStatus:        j.job_status      || '',
      })))
      setPage(pageNum)
    } catch(e) {
      setError('Failed to load jobs: ' + e.message)
    }
    setLoading(false)
  }

  // Derive tags from all jobs fetched so far isn't reliable —
  // use pre-computed tags from the applicant object
  const tags = applicant.tags || ''

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>

        {/* ── Header ── */}
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

        {/* ── Stats strip ── */}
        <div className={styles.statsStrip}>
          <div className={styles.stat}>
            <Briefcase size={14}/>
            <span><strong>{totalJobs}</strong> applications</span>
          </div>
          <div className={styles.stat}>
            <Calendar size={14}/>
            <span>Last applied <strong>{safeDisplayDate(applicant.last_appointment_date) || '—'}</strong></span>
          </div>
          {tags && tags.split(' | ').map(tag => {
            const c = CAT_COLORS[tag] || CAT_COLORS.Unarmed
            return (
              <span key={tag} className={styles.tagBadge} style={{ background: c.bg, color: c.color }}>
                {tag}
              </span>
            )
          })}
        </div>

        {/* ── Jobs table ── */}
        <div className={styles.tableWrap}>
          {loading && (
            <div className={styles.loading}>
              <RefreshCw size={18} className={styles.spin}/> Loading jobs…
            </div>
          )}
          {error && <div className={styles.errorBox}>{error}</div>}
          {!loading && jobs.length > 0 && (
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
                    <tr key={i} className={i % 2 === 0 ? styles.rowEven : styles.rowOdd}>
                      <td>
                        <span className={styles.catBadge} style={{ background: c.bg, color: c.color }}>
                          {j.category.toUpperCase()}
                        </span>
                      </td>
                      <td className={styles.jobTitle}>{j.title}</td>
                      <td className={styles.dept}>{j.dept || '—'}</td>
                      <td>
                        <span className={`${styles.statusBadge} ${styles['status_' + j.status.replace(/[^a-z]/gi,'_').toLowerCase()]}`}>
                          {j.status || '—'}
                        </span>
                      </td>
                      <td className={styles.dateCell}>{j.displayDate || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {!loading && jobs.length === 0 && !error && (
            <div className={styles.loading}>No job applications found.</div>
          )}
        </div>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className={styles.pagination}>
            <button className={styles.pageBtn} onClick={() => fetchJobs(0)} disabled={page===0||loading}>««</button>
            <button className={styles.pageBtn} onClick={() => fetchJobs(page-1)} disabled={page===0||loading}>
              <ChevronLeft size={14}/>
            </button>

            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let p
              if (totalPages <= 7) p = i
              else if (page < 4) p = i
              else if (page > totalPages - 5) p = totalPages - 7 + i
              else p = page - 3 + i
              return (
                <button
                  key={p}
                  className={`${styles.pageBtn} ${p===page ? styles.pageBtnActive : ''}`}
                  onClick={() => fetchJobs(p)}
                  disabled={loading}
                >
                  {p + 1}
                </button>
              )
            })}

            <button className={styles.pageBtn} onClick={() => fetchJobs(page+1)} disabled={page>=totalPages-1||loading}>
              <ChevronRight size={14}/>
            </button>
            <button className={styles.pageBtn} onClick={() => fetchJobs(totalPages-1)} disabled={page>=totalPages-1||loading}>»»</button>

            <span className={styles.pageInfo}>
              {page*JOBS_PER_PAGE+1}–{Math.min((page+1)*JOBS_PER_PAGE, totalJobs)} of {totalJobs} jobs
            </span>
          </div>
        )}

      </div>
    </div>
  )
}
