import styles from './StatsBar.module.css'
import { Users, AlertCircle, Briefcase, TrendingUp, Tag } from 'lucide-react'

export default function StatsBar({ applicants, dbStats = {}, viewMode = 'all' }) {
  const maxJobs    = applicants.length ? Math.max(...applicants.map(a => a.applied_count)) : 0
  const topPerson  = applicants.find(a => a.applied_count === maxJobs)
  const totalShown = applicants.reduce((s, a) => s + (a.applied_count || 0), 0)

  // Tag breakdown from visible applicants
  const tagCounts = { Armed: 0, Unarmed: 0, Admin: 0, Supervisor: 0 }
  for (const a of applicants) {
    for (const tag of (a.tags || '').split(' | ').filter(Boolean)) {
      if (tagCounts[tag] != null) tagCounts[tag]++
    }
  }
  const topTag = Object.entries(tagCounts).sort((a,b) => b[1]-a[1])[0]

  const stats = [
    {
      icon: <Users size={18} strokeWidth={1.5} />,
      label: viewMode === 'all' ? 'Total applicants' : 'Duplicate applicants',
      value: (viewMode === 'all' ? dbStats.totalApplicants : dbStats.duplicates) ?? applicants.length,
      color: 'blue'
    },
    {
      icon: <Briefcase size={18} strokeWidth={1.5} />,
      label: 'Total applications',
      value: dbStats.totalApplications ?? totalShown,
      color: 'amber'
    },
    {
      icon: <AlertCircle size={18} strokeWidth={1.5} />,
      label: 'Showing now',
      value: applicants.length,
      sub: applicants.length !== (dbStats.totalApplicants ?? applicants.length) ? 'filtered' : '',
      color: 'red'
    },
    {
      icon: <Tag size={18} strokeWidth={1.5} />,
      label: 'Top job type',
      value: topTag?.[1] ? `${topTag[0]}` : '—',
      sub: topTag?.[1] ? `${topTag[1]} applicant${topTag[1] !== 1 ? 's' : ''}` : '',
      color: 'purple'
    }
  ]

  return (
    <div className={styles.grid}>
      {stats.map((s, i) => (
        <div key={i} className={`${styles.card} ${styles[s.color]}`}>
          <div className={styles.icon}>{s.icon}</div>
          <div className={styles.body}>
            <div className={styles.label}>{s.label}</div>
            <div className={styles.value}>{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</div>
            {s.sub && <div className={styles.sub}>{s.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}
