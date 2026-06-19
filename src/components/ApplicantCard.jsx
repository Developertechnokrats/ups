import { ExternalLink, Briefcase, Calendar, Mail, Phone } from 'lucide-react'
import { safeDisplayDate } from '../lib/dataUtils'
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

function formatDisplayDate(dateStr) {
  if (!dateStr || dateStr === 'null') return ''
  try {
    const s = String(dateStr).length === 10 ? dateStr + 'T00:00:00' : dateStr
    const d = new Date(s)
    if (isNaN(d.getTime()) || d.getFullYear() > 2100) return ''
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return '' }
}

export default function ApplicantCard({ applicant, index, onViewDetails }) {
  const [bg, fg] = AVATAR_COLORS[index % AVATAR_COLORS.length]
  const tags = applicant.tags || ''

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        {/* Avatar */}
        <div className={styles.avatar} style={{ background: bg, color: fg }}>
          {initials(applicant.firstname, applicant.lastname)}
        </div>

        {/* Info */}
        <div className={styles.info}>
          <div className={styles.name}>{applicant.firstname} {applicant.lastname}</div>
          <div className={styles.sub}>
            <span className={styles.meta}><Mail size={11}/> {applicant.email}</span>
            {applicant.phone && <span className={styles.meta}><Phone size={11}/> {applicant.phone}</span>}
          </div>
        </div>

        {/* Badges */}
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
            <Briefcase size={11}/> {applicant.applied_count} job{applicant.applied_count !== 1 ? 's' : ''}
          </span>
          {applicant.last_appointment_date && (
            <span className={styles.badge} style={{ background: 'var(--surface2)', color: 'var(--text-muted)' }}>
              <Calendar size={11}/> {formatDisplayDate(applicant.last_appointment_date)}
            </span>
          )}
        </div>

        {/* View button */}
        <button className={styles.viewBtn} onClick={() => onViewDetails(applicant, index)}>
          <ExternalLink size={13}/> View
        </button>
      </div>
    </div>
  )
}
