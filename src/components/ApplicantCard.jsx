import { useState } from 'react'
import { ChevronDown, Briefcase, Calendar, Mail, Phone, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { classifyJob, safeDisplayDate } from '../lib/dataUtils'
import styles from './ApplicantCard.module.css'

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

function initials(first, last) {
  return `${(first||'')[0]||''}${(last||'')[0]||''}`.toUpperCase()
}

export default function ApplicantCard({ applicant, index }) {
  const [open, setOpen]         = useState(false)
  const [jobs, setJobs]         = useState(applicant.jobs || [])
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [jobError, setJobError] = useState('')

  const [bg, fg] = AVATAR_COLORS[index % AVATAR_COLORS.length]

  // Tags: use pre-computed or derive from loaded jobs
  const tags = applicant.tags || deriveTags(jobs)

  async function handleToggle() {
    const nowOpen = !open
    setOpen(nowOpen)

    // If opening and jobs not loaded yet but applicant has jobs — fetch them
    if (nowOpen && jobs.length === 0 && applicant.applied_count > 0 && supabase) {
      setLoadingJobs(true)
      setJobError('')
      try {
        const allJobs = []
        let from = 0
        const PAGE = 1000
        while (true) {
          const { data, error } = await supabase
            .from('applications')
            .select('job_title, application_date, status_name, department')
            .eq('email', applicant.email)
            .order('application_date', { ascending: false, nullsFirst: false })
            .range(from, from + PAGE - 1)
          if (error) throw error
          if (!data || data.length === 0) break
          allJobs.push(...data)
          if (data.length < PAGE) break
          from += PAGE
        }
        setJobs(allJobs.map(j => ({
          title:    j.job_title    || '',
          date:     safeDisplayDate(j.application_date),
          category: classifyJob(j.job_title || ''),
          status:   j.status_name  || '',
          dept:     j.department   || '',
        })))
      } catch(e) {
        setJobError('Could not load jobs: ' + e.message)
      }
      setLoadingJobs(false)
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.header} onClick={handleToggle}>
        <div className={styles.avatar} style={{ background: bg, color: fg }}>
          {initials(applicant.firstname, applicant.lastname)}
        </div>

        <div className={styles.info}>
          <div className={styles.name}>{applicant.firstname} {applicant.lastname}</div>
          <div className={styles.sub}>
            <span className={styles.meta}><Mail size={11} /> {applicant.email}</span>
            {applicant.phone && <span className={styles.meta}><Phone size={11} /> {applicant.phone}</span>}
          </div>
        </div>

        <div className={styles.badges}>
          {tags && tags.split(' | ').map(tag => {
            const c = CAT_COLORS[tag] || CAT_COLORS.Unarmed
            return (
              <span key={tag} className={styles.badge} style={{ background: c.bg, color: c.color }}>
                {tag}
              </span>
            )
          })}
          <span className={styles.badge} style={{ background: 'var(--blue-bg)', color: 'var(--blue-text)' }}>
            <Briefcase size={11} /> {applicant.applied_count} job{applicant.applied_count > 1 ? 's' : ''}
          </span>
          {applicant.last_appointment_date && (
            <span className={styles.badge} style={{ background: 'var(--surface2)', color: 'var(--text-muted)' }}>
              <Calendar size={11} /> {formatDisplayDate(applicant.last_appointment_date)}
            </span>
          )}
        </div>

        <ChevronDown size={16} className={`${styles.chevron} ${open ? styles.open : ''}`} />
      </div>

      {open && (
        <div className={styles.body}>
          {loadingJobs && (
            <div className={styles.loadingJobs}>
              <RefreshCw size={13} className={styles.spin} /> Loading {applicant.applied_count} jobs…
            </div>
          )}
          {jobError && <div className={styles.jobError}>{jobError}</div>}
          {!loadingJobs && jobs.map((j, i) => {
            const c = CAT_COLORS[j.category] || CAT_COLORS.Unarmed
            return (
              <div key={i} className={styles.jobRow}>
                <span className={styles.catBadge} style={{ background: c.bg, color: c.color }}>{j.category}</span>
                <span className={styles.jobTitle}>{j.title}</span>
                <span className={styles.jobDate}>{j.date}</span>
              </div>
            )
          })}
          {!loadingJobs && !jobError && jobs.length === 0 && (
            <div className={styles.loadingJobs}>No job details found.</div>
          )}
        </div>
      )}
    </div>
  )
}

function deriveTags(jobs) {
  if (!jobs.length) return ''
  const cats = new Set(jobs.map(j => j.category).filter(Boolean))
  return ['Armed','Unarmed','Admin','Supervisor'].filter(c => cats.has(c)).join(' | ')
}

function formatDisplayDate(dateStr) {
  if (!dateStr || dateStr === 'null' || dateStr === 'undefined') return ''
  try {
    const s = String(dateStr).length === 10 ? dateStr + 'T00:00:00' : dateStr
    const d = new Date(s)
    if (isNaN(d.getTime()) || d.getFullYear() > 2100) return ''
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return '' }
}
