import { useRef, useState } from 'react'
import { Upload, FileText, X, CheckCircle, RefreshCw } from 'lucide-react'
import { parseAppointmentCSVStream, parseAppointmentExcelStream } from '../lib/dataUtils'
import { upsertAppointments } from '../lib/supabase'
import styles from './UploadZone.module.css'

export default function AppointmentUpload({ onClose, onComplete }) {
  const [dragging, setDragging]   = useState(false)
  const [progress, setProgress]   = useState(null)
  const [saving, setSaving]       = useState(false)
  const [saveProgress, setSaveP]  = useState(null)
  const [error, setError]         = useState('')
  const [done, setDone]           = useState(false)
  const inputRef = useRef()

  async function handleFile(file) {
    setError('')
    setDone(false)
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['csv', 'xlsx', 'xls'].includes(ext)) {
      setError('Please upload a CSV or Excel (.xlsx/.xls) file.')
      return
    }

    const sizeMB = (file.size / 1024 / 1024).toFixed(1)
    setProgress({ pct: 0, msg: `Reading ${file.name} (${sizeMB} MB)…` })

    try {
      let rows
      if (ext === 'csv') {
        rows = await parseAppointmentCSVStream(file, ({ stage, pct, done: d }) => {
          setProgress({ pct: pct ?? 0, msg: stage === 'parsing' ? `Parsing rows… (${(d||0).toLocaleString()})` : 'Processing…' })
        })
      } else {
        rows = await parseAppointmentExcelStream(file, ({ stage, pct }) => {
          setProgress({ pct: pct ?? 0, msg: stage === 'reading' ? `Reading file… ${pct}%` : 'Parsing…' })
        })
      }

      setProgress({ pct: 100, msg: `Parsed ${rows.length.toLocaleString()} appointments. Saving to Supabase…` })
      setSaving(true)

      await upsertAppointments(rows, ({ done: d, total }) => {
        setSaveP({ done: d, total })
      })

      setDone(true)
      setProgress({ pct: 100, msg: `✅ ${rows.length.toLocaleString()} appointments saved successfully.` })
      onComplete?.(rows.length)
    } catch(e) {
      setProgress(null)
      setError(e.message)
    }
    setSaving(false)
  }

  function onDrop(e) {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const busy = !!progress && !done

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && !busy && onClose()}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>Upload appointment file</span>
          {!busy && <button className={styles.close} onClick={onClose}><X size={16}/></button>}
        </div>

        {/* Info */}
        {!progress && (
          <div style={{ background: 'var(--blue-bg)', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--blue-text)' }}>
            Expected columns: <strong>Email, Appointment id, Requested time, Calendar, Outcome</strong>
          </div>
        )}

        {!progress && (
          <div
            className={`${styles.zone} ${dragging ? styles.dragOver : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current.click()}
          >
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display:'none' }}
              onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
            <Upload size={28} strokeWidth={1.5} color="var(--text-muted)" />
            <p className={styles.dropText}>Drop your appointment file or <span className={styles.link}>browse</span></p>
            <p className={styles.hint}>CSV or Excel — large files supported</p>
          </div>
        )}

        {progress && (
          <div className={styles.progressWrap}>
            {done ? <CheckCircle size={28} color="var(--green)"/> : <div className={styles.spinner}/>}
            <p className={styles.progressMsg}>{progress.msg}</p>
            <div className={styles.progressBar}>
              <div className={`${styles.progressFill} ${done ? styles.progressDone : ''}`} style={{ width: `${progress.pct}%` }}/>
            </div>
            {saveProgress && !done && (
              <p className={styles.progressMsg} style={{ fontSize: 12 }}>
                Saving… {saveProgress.done.toLocaleString()} / {saveProgress.total.toLocaleString()}
              </p>
            )}
          </div>
        )}

        {done && (
          <div style={{ display:'flex', justifyContent:'flex-end', marginTop:16 }}>
            <button
              style={{ background:'var(--text)',color:'var(--surface)',border:'none',borderRadius:'var(--radius-md)',padding:'8px 18px',fontSize:13,fontWeight:500,cursor:'pointer' }}
              onClick={onClose}
            >
              Done
            </button>
          </div>
        )}

        {error && (
          <div className={styles.error}><X size={13}/> {error}
            <button className={styles.retryBtn} onClick={() => setError('')}>Try again</button>
          </div>
        )}

        {!progress && (
          <div className={styles.formats}>
            <div className={styles.fmt}><FileText size={13}/> CSV</div>
            <div className={styles.fmt}><FileText size={13}/> XLSX</div>
            <div className={styles.fmt}><FileText size={13}/> XLS</div>
          </div>
        )}
      </div>
    </div>
  )
}
