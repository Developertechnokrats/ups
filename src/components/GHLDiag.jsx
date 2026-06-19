import { useState } from 'react'
import { Zap, CheckCircle, XCircle, RefreshCw, X } from 'lucide-react'
import { testGHLConnection, getConfig, isGHLConfigured } from '../lib/ghl'
import styles from './GHLDiag.module.css'

export default function GHLDiag({ onClose }) {
  const [testing, setTesting] = useState(false)
  const [result, setResult]   = useState(null)

  const cfg = getConfig()
  const configured = isGHLConfigured()

  async function runTest() {
    setTesting(true)
    setResult(null)
    const res = await testGHLConnection()
    setResult(res)
    setTesting(false)
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <Zap size={16} color="var(--amber)" />
          <span className={styles.title}>GHL Connection Diagnostics</span>
          <button className={styles.closeBtn} onClick={onClose}><X size={16}/></button>
        </div>

        {/* Config status */}
        <div className={styles.section}>
          <p className={styles.sectionTitle}>Environment variables</p>
          <div className={styles.configRows}>
            <div className={styles.configRow}>
              {cfg.token ? <CheckCircle size={14} color="var(--green)"/> : <XCircle size={14} color="var(--red)"/>}
              <span className={styles.configKey}>VITE_GHL_TOKEN</span>
              <span className={styles.configVal}>
                {cfg.token ? `${cfg.token.slice(0,12)}…` : '❌ Not set'}
              </span>
            </div>
            <div className={styles.configRow}>
              {cfg.locationId ? <CheckCircle size={14} color="var(--green)"/> : <XCircle size={14} color="var(--red)"/>}
              <span className={styles.configKey}>VITE_GHL_LOCATION_ID</span>
              <span className={styles.configVal}>{cfg.locationId || '❌ Not set'}</span>
            </div>
            <div className={styles.configRow}>
              <CheckCircle size={14} color="var(--green)"/>
              <span className={styles.configKey}>VITE_GHL_API_VERSION</span>
              <span className={styles.configVal}>{cfg.version}</span>
            </div>
          </div>
        </div>

        {/* Test button */}
        <div className={styles.section}>
          <button className={styles.testBtn} onClick={runTest} disabled={testing || !configured}>
            {testing ? <><RefreshCw size={14} className={styles.spin}/> Testing…</> : <><Zap size={14}/> Test connection</>}
          </button>
          {!configured && <p className={styles.hint}>Set both env vars above before testing.</p>}
        </div>

        {/* Results */}
        {result && (
          <div className={styles.section}>
            <p className={styles.sectionTitle}>Test results</p>
            <div className={styles.steps}>
              {result.steps.map((s, i) => (
                <div key={i} className={`${styles.step} ${s.ok ? styles.stepOk : styles.stepFail}`}>
                  <div className={styles.stepHeader}>
                    {s.ok ? <CheckCircle size={14}/> : <XCircle size={14}/>}
                    <span className={styles.stepName}>{s.step}</span>
                  </div>
                  <p className={styles.stepDetail}>{s.detail}</p>
                </div>
              ))}
            </div>

            {result.ok
              ? <div className={styles.successBox}>✅ GHL is connected and working correctly.</div>
              : <div className={styles.failBox}>
                  ❌ Connection failed. Fix the error above, redeploy on Netlify, then test again.
                  <br/><br/>
                  <strong>Common fixes:</strong>
                  <ul>
                    <li>Token expired → regenerate in GHL → Agency → Settings → API Keys</li>
                    <li>Wrong Location ID → GHL → Settings → Business Profile → Location ID</li>
                    <li>CORS error → GHL API v2 may block direct browser calls — you may need a Netlify serverless function as a proxy</li>
                  </ul>
                </div>
            }
          </div>
        )}
      </div>
    </div>
  )
}
