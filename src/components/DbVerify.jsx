import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Database, CheckCircle, XCircle, RefreshCw } from 'lucide-react'
import styles from './DbVerify.module.css'

export default function DbVerify({ onClose }) {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  async function verify() {
    setLoading(true)
    setResult(null)
    try {
      // Count rows in both tables
      const [r1, r2, r3, r4] = await Promise.all([
        supabase.from('applicants').select('*', { count: 'exact', head: true }),
        supabase.from('applications').select('*', { count: 'exact', head: true }),
        supabase.from('applicants').select('email, firstname, lastname, applied_count, start_date').order('created_at', { ascending: false }).limit(5),
        supabase.from('applications').select('email, job_title, application_date').order('created_at', { ascending: false }).limit(5),
      ])

      setResult({
        applicantCount:   r1.count ?? 0,
        applicationCount: r2.count ?? 0,
        recentApplicants: r3.data || [],
        recentApps:       r4.data || [],
        errors: [r1.error, r2.error, r3.error, r4.error].filter(Boolean).map(e => e.message),
      })
    } catch(e) {
      setResult({ error: e.message })
    }
    setLoading(false)
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <Database size={16} />
          <span className={styles.title}>Supabase DB verification</span>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <button className={styles.verifyBtn} onClick={verify} disabled={loading}>
          {loading ? <><RefreshCw size={14} className={styles.spin} /> Checking…</> : 'Run verification'}
        </button>

        {result && !result.error && (
          <div className={styles.results}>
            <div className={styles.counts}>
              <div className={`${styles.countCard} ${result.applicantCount > 0 ? styles.ok : styles.warn}`}>
                {result.applicantCount > 0 ? <CheckCircle size={16}/> : <XCircle size={16}/>}
                <div>
                  <div className={styles.countVal}>{result.applicantCount.toLocaleString()}</div>
                  <div className={styles.countLabel}>Applicants in DB</div>
                </div>
              </div>
              <div className={`${styles.countCard} ${result.applicationCount > 0 ? styles.ok : styles.warn}`}>
                {result.applicationCount > 0 ? <CheckCircle size={16}/> : <XCircle size={16}/>}
                <div>
                  <div className={styles.countVal}>{result.applicationCount.toLocaleString()}</div>
                  <div className={styles.countLabel}>Applications in DB</div>
                </div>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className={styles.errBox}>
                {result.errors.map((e,i) => <div key={i}>⚠ {e}</div>)}
              </div>
            )}

            {result.recentApplicants.length > 0 && (
              <>
                <p className={styles.sectionLabel}>5 most recently added applicants</p>
                <table className={styles.table}>
                  <thead><tr><th>Name</th><th>Email</th><th>Jobs</th><th>Start date</th></tr></thead>
                  <tbody>
                    {result.recentApplicants.map((a,i) => (
                      <tr key={i}>
                        <td>{a.firstname} {a.lastname}</td>
                        <td className={styles.email}>{a.email}</td>
                        <td>{a.applied_count}</td>
                        <td>{a.start_date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {result.recentApps.length > 0 && (
              <>
                <p className={styles.sectionLabel}>5 most recently added applications</p>
                <table className={styles.table}>
                  <thead><tr><th>Email</th><th>Job title</th><th>Date</th></tr></thead>
                  <tbody>
                    {result.recentApps.map((a,i) => (
                      <tr key={i}>
                        <td className={styles.email}>{a.email}</td>
                        <td>{a.job_title}</td>
                        <td>{a.application_date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        {result?.error && (
          <div className={styles.errBox}>{result.error}</div>
        )}
      </div>
    </div>
  )
}
