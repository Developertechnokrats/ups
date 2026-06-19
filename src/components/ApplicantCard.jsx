import { useState } from 'react'
import { ChevronDown, Briefcase, Calendar, Mail, Phone } from 'lucide-react'
import styles from './ApplicantCard.module.css'

const CAT_COLORS = {
  Unarmed: { bg: 'var(--green-bg)', color: 'var(--green-text)' },
  Armed:   { bg: 'var(--red-bg)',   color: 'var(--red-text)' },
  Admin:   { bg: 'var(--amber-bg)', color: 'var(--amber-text)' },
  Supervisor: { bg: 'var(--purple-bg)', color: 'var(--purple-text)' },
}

const AVATAR_COLORS = [
  ['#E6F1FB','#0C447C'], ['#EAF3DE','#27500A'], ['#FAEEDA','#633806'],
  ['#EEEDFE','#3C3489'], ['#FCEBEB','#791F1F'], ['#E1F5EE','#085041'],
]

function initials(first, last) {
  return `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase()
}

export default function ApplicantCard({ applicant, index }) {
  const [open, setOpen] = useState(false)
  const [bg, fg] = AVATAR_COLORS[index % AVATAR_COLORS.length]
  const jobs = applicant.jobs || parseJobsFromNotes(applicant.notes)

  return (
    <div className={styles.card}>
      <div className={styles.header} onClick={() => setOpen(!open)}>
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
          {applicant.tags && applicant.tags.split(' | ').map(tag => {
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
          {jobs.map((j, i) => {
            const c = CAT_COLORS[j.category] || CAT_COLORS.Unarmed
            return (
              <div key={i} className={styles.jobRow}>
                <span className={styles.catBadge} style={{ background: c.bg, color: c.color }}>{j.category}</span>
                <span className={styles.jobTitle}>{j.title}</span>
                <span className={styles.jobDate}>{j.date}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return dateStr }
}

function parseJobsFromNotes(notes = '') {
  if (!notes) return []
  return notes.split(' | ').map(part => {
    const idx = part.lastIndexOf(' -- ')
    return {
      title: idx > -1 ? part.slice(0, idx) : part,
      date: idx > -1 ? part.slice(idx + 4) : '',
      category: 'Unarmed'
    }
  })
}
