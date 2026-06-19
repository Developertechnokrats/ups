import { useState } from 'react'
import { Zap, CheckCircle, XCircle, RefreshCw, X, Send } from 'lucide-react'
import { testGHLConnection, testPushSingle, getConfig, isGHLConfigured } from '../lib/ghl'
import styles from './GHLDiag.module.css'

export default function GHLDiag({ onClose, sampleApplicant }) {
  const [testing, setTesting]       = useState(false)
  const [pushTesting, setPushTesting] = useState(false)
  const [connResult, setConnResult] = useState(null)
  const [pushResult, setPushResult] = useState(null)

  const cfg        = getConfig()
  const configured = isGHLConfigured()

  async function runConnTest() {
    setTesting(true)
    setConnResult(null)
    setConnResult(await testGHLConnection())
    setTesting(false)
  }

  async function runPushTest() {
    if (!sampleApplicant) return
    setPushTesting(true)
    setPushResult(null)
    const res = await testPushSingle(sampleApplicant)
    setPushResult(res)
    setPushTesting(false)
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <Zap size={16} color="var(--amber)" />
          <span className={styles.title}>GHL Connection Diagnostics</span>
          <button className={styles.closeBtn} onClick={onClose}><X size={16}/></button>
        </div>

        {/* Config */}
        <div className={styles.section}>
          <p className={styles.sectionTitle}>Environment variables</p>
          <div className={styles.configRows}>
            {[
              { key: 'VITE_GHL_TOKEN',        val: cfg.token      ? cfg.token.slice(0,16)+'…' : null },
              { key: 'VITE_GHL_LOCATION_ID',  val: cfg.locationId || null },
              { key: 'VITE_GHL_API_VERSION',  val: cfg.version },
              { key: 'VITE_GHL_FIELD_LAST_DATE',  val: cfg.fieldLastDate },
              { key: 'VITE_GHL_FIELD_TOTAL_APPS', val: cfg.fieldTotalApps },
            ].map(({ key, val }) => (
              <div key={key} className={styles.configRow}>
                {val ? <CheckCircle size={13} color="var(--green)"/> : <XCircle size={13} color="var(--red)"/>}
                <span className={styles.configKey}>{key}</span>
                <span className={styles.configVal}>{val || '❌ Not set'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Connection test */}
        <div className={styles.section}>
          <p className={styles.sectionTitle}>Step 1 — Test connection</p>
          <button className={styles.testBtn} onClick={runConnTest} disabled={testing || !configured}>
            {testing ? <><RefreshCw size={13} className={styles.spin}/> Testing…</> : <><Zap size={13}/> Test connection</>}
          </button>
          {connResult && <StepList steps={connResult.steps} ok={connResult.ok} />}
        </div>

        {/* Test push */}
        <div className={styles.section}>
          <p className={styles.sectionTitle}>Step 2 — Test push (single contact)</p>
          {sampleApplicant
            ? <p className={styles.hint}>Will test push: <strong>{sampleApplicant.firstname} {sampleApplicant.lastname}</strong> ({sampleApplicant.email})</p>
            : <p className={styles.hint}>Load the dashboard first — a sample contact is needed for test push.</p>
          }
          <button className={styles.testBtn} onClick={runPushTest} disabled={pushTesting || !configured || !sampleApplicant} style={{marginTop:8}}>
            {pushTesting ? <><RefreshCw size={13} className={styles.spin}/> Testing push…</> : <><Send size={13}/> Test push</>}
          </button>

          {pushResult && (
            <div className={styles.pushResult}>
              <StepList steps={pushResult.log?.map(l => ({
                step: l.step || l.split(':')[0],
                ok:   l.ok !== undefined ? l.ok : !l.detail?.includes('failed') && !l.detail?.includes('skipped'),
                detail: l.detail || l,
              })) || []} ok={pushResult.ok} />
              {pushResult.ok && (
                <div className={styles.successBox}>✅ Push succeeded — GHL Contact ID: <code>{pushResult.contactId}</code></div>
              )}
              {!pushResult.ok && (
                <div className={styles.failBox}>
                  ❌ Push failed.<br/>
                  <strong>Common causes:</strong>
                  <ul>
                    <li>Custom field IDs are wrong — set <code>VITE_GHL_FIELD_LAST_DATE</code> and <code>VITE_GHL_FIELD_TOTAL_APPS</code> to the exact Field Key from GHL Settings → Custom Fields</li>
                    <li>API version mismatch — currently set to <code>{cfg.version}</code></li>
                    <li>Location ID mismatch between token and location</li>
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StepList({ steps, ok }) {
  return (
    <div className={styles.steps}>
      {steps.map((s, i) => (
        <div key={i} className={`${styles.step} ${s.ok ? styles.stepOk : styles.stepFail}`}>
          <div className={styles.stepHeader}>
            {s.ok ? <CheckCircle size={13}/> : <XCircle size={13}/>}
            <span className={styles.stepName}>{s.step}</span>
          </div>
          <pre className={styles.stepDetail}>{s.detail}</pre>
        </div>
      ))}
      {!steps.length && <p className={styles.hint}>No steps recorded.</p>}
    </div>
  )
}
