import styles from './StatsBar.module.css'
import { Users, AlertCircle, Briefcase, TrendingUp } from 'lucide-react'

export default function StatsBar({ applicants, totalRows }) {
  const totalApps = applicants.reduce((s, a) => s + (a.applied_count || 0), 0)
  const maxJobs = applicants.length ? Math.max(...applicants.map(a => a.applied_count)) : 0
  const topPerson = applicants.find(a => a.applied_count === maxJobs)

  const stats = [
    {
      icon: <Users size={18} strokeWidth={1.5} />,
      label: 'Total applications',
      value: totalRows || '—',
      color: 'blue'
    },
    {
      icon: <AlertCircle size={18} strokeWidth={1.5} />,
      label: 'Duplicate applicants',
      value: applicants.length,
      color: 'red'
    },
    {
      icon: <Briefcase size={18} strokeWidth={1.5} />,
      label: 'Duplicate applications',
      value: totalApps,
      color: 'amber'
    },
    {
      icon: <TrendingUp size={18} strokeWidth={1.5} />,
      label: 'Top applicant',
      value: topPerson ? `${maxJobs} jobs` : '—',
      sub: topPerson ? `${topPerson.firstname} ${topPerson.lastname}` : '',
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
            <div className={styles.value}>{s.value}</div>
            {s.sub && <div className={styles.sub}>{s.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}
