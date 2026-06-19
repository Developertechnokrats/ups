import { useState } from 'react'
import { X, Send, CheckCircle, XCircle, RefreshCw, Zap } from 'lucide-react'
import { batchPushToGHL, pushSingleToGHL, isGHLConfigured } from '../lib/ghl'
import { updateGHLStatus } from '../lib/supabase'
import styles from './GHLPushModal.module.css'

export default function GHLPushModal({ applicants, onClose, onComplete }) {
  const [phase, setPhase]       = useState('confirm')  // confirm | pushing | done
  const [progress, setProgress] = useState({ done: 0, total: 0, results: [] })
  const [error, setError]       = useState('')

  const isSingle = applicants.length === 1

  async function startPush() {
    setPhase('pushing')
    setError('')
    try {
      const results = await batchPushToGHL(applicants, prog => setProgress({ ...prog }))
      // Save statuses to Supabase
      await updateGHLStatus(results)
      setProgress(p => ({ ...p, results }))
      setPhase('done')
      onComplete?.(results)
    } catch(e) {
      setError(e.message)
      setPhase('confirm')
    }
  }

  const succeeded = progress.results.filter(r => r.success).length
  const failed    = progress.results.filter(r => !r.success).length
  const pct       = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && phase !== 'pushing' && onClose()}>
      <div className={styles.modal}>

        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <Zap size={18} color="var(--amber)" />
            <span className={styles.title}>Push to GoHighLevel</span>
          </div>
          {phase !== 'pushing' && <button className={styles.closeBtn} onClick={onClose}><X size={16}/></button>}
        </div>

        {/* ── Confirm phase ── */}
        {phase === 'confirm' && (
          <div className={styles.body}>
            {!isGHLConfigured() && (
            <div className={styles.errorBox}>
              Missing GHL config. Make sure <code>VITE_GHL_TOKEN</code> and <code>VITE_GHL_LOCATION_ID</code> are set in Netlify environment variables.
            </div>
          )}
        <div className={styles.summary}>
              <div className={styles.summaryCount}>{applicants.length}</div>
              <div className={styles.summaryLabel}>
                applicant{applicants.length !== 1 ? 's' : ''} will be pushed to GHL
              </div>
            </div>

            <div className={styles.infoList}>
              <div className={styles.infoRow}><CheckCircle size={14} color="var(--green)"/> Update or create contact by email</div>
              <div className={styles.infoRow}><CheckCircle size={14} color="var(--green)"/> Set <code>last_application_date</code> and <code>total_application</code> fields</div>
              <div className={styles.infoRow}><CheckCircle size={14} color="var(--green)"/> Merge tags (existing tags preserved)</div>
              <div className={styles.infoRow}><CheckCircle size={14} color="var(--green)"/> Add job history as a note</div>
              {applicants.length > 10 && (
                <div className={styles.infoRow}><RefreshCw size={14} color="var(--blue)"/> Sending in batches of 10 with rate limiting</div>
              )}
            </div>

            {error && <div className={styles.errorBox}>{error}</div>}

            <div className={styles.actions}>
              <button className={styles.btnSecondary} onClick={onClose}>Cancel</button>
              <button className={styles.btnPrimary} onClick={startPush} disabled={!isGHLConfigured()}>
                <Send size={14}/> Push {applicants.length} contact{applicants.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        )}

        {/* ── Pushing phase ── */}
        {phase === 'pushing' && (
          <div className={styles.body}>
            <div className={styles.progressWrap}>
              <RefreshCw size={24} className={styles.spin} color="var(--blue)"/>
              <p className={styles.progressMsg}>
                Pushing to GHL… {progress.done.toLocaleString()} / {progress.total.toLocaleString()} ({pct}%)
              </p>
              <div className={styles.progressBar}>
                <div className={styles.progressFill} style={{ width: `${pct}%` }}/>
              </div>
              {progress.results.length > 0 && (
                <div className={styles.liveStats}>
                  <span className={styles.statSuccess}><CheckCircle size={12}/> {succeeded} synced</span>
                  {failed > 0 && <span className={styles.statError}><XCircle size={12}/> {failed} failed</span>}
                </div>
              )}
            </div>

            {/* Live result feed */}
            {progress.results.length > 0 && (
              <div className={styles.resultFeed}>
                {[...progress.results].reverse().slice(0, 8).map((r, i) => (
                  <div key={i} className={`${styles.resultRow} ${r.success ? styles.resultOk : styles.resultErr}`}>
                    {r.success ? <CheckCircle size={12}/> : <XCircle size={12}/>}
                    <span className={styles.resultEmail}>{r.email}</span>
                    <span className={styles.resultMsg}>{r.success ? `✓ ${r.contactId}` : `✗ ${r.error}`}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Done phase ── */}
        {phase === 'done' && (
          <div className={styles.body}>
            <div className={styles.doneHeader}>
              {failed === 0
                ? <><CheckCircle size={28} color="var(--green)"/> <span>All contacts synced!</span></>
                : <><XCircle size={28} color="var(--red)"/> <span>Done with {failed} error{failed !== 1 ? 's' : ''}</span></>
              }
            </div>

            <div className={styles.doneStats}>
              <div className={styles.doneStat} style={{ background: 'var(--green-bg)', color: 'var(--green-text)' }}>
                <CheckCircle size={16}/> <strong>{succeeded}</strong> synced to GHL
              </div>
              {failed > 0 && (
                <div className={styles.doneStat} style={{ background: 'var(--red-bg)', color: 'var(--red-text)' }}>
                  <XCircle size={16}/> <strong>{failed}</strong> failed
                </div>
              )}
            </div>

            {/* Error details */}
            {failed > 0 && (
              <div className={styles.errorList}>
                <p className={styles.errorListTitle}>Failed contacts:</p>
                {progress.results.filter(r => !r.success).map((r, i) => (
                  <div key={i} className={styles.errorListRow}>
                    <span className={styles.resultEmail}>{r.email}</span>
                    <span className={styles.errorMsg}>{r.error}{r.log?.length ? ` (steps: ${r.log.slice(-2).join(" → ")})` : ""}</span>
                  </div>
                ))}
              </div>
            )}

            <div className={styles.actions}>
              <button className={styles.btnPrimary} onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
