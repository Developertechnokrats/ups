import { useRef, useState } from 'react'
import { Upload, FileText, X, CheckCircle } from 'lucide-react'
import { parseCSVStream, parseExcelStream } from '../lib/dataUtils'
import styles from './UploadZone.module.css'

export default function UploadZone({ onData, onClose }) {
  const [dragging, setDragging]   = useState(false)
  const [progress, setProgress]   = useState(null)  // null | { stage, pct, msg }
  const [error, setError]         = useState('')
  const [done, setDone]           = useState(false)
  const inputRef = useRef()

  async function handleFile(file) {
    setError('')
    setDone(false)

    const ext = file.name.split('.').pop().toLowerCase()
    if (!['csv', 'xlsx', 'xls'].includes(ext)) {
      setError('Please upload a CSV or Excel (.xlsx / .xls) file.')
      return
    }

    const sizeMB = (file.size / 1024 / 1024).toFixed(1)
    setProgress({ stage: 'reading', pct: 0, msg: `Reading ${file.name} (${sizeMB} MB)…` })

    function onProgress({ stage, pct, done: doneRows }) {
      const msgs = {
        reading:    `Reading file… ${pct ?? 0}%`,
        parsing:    `Parsing rows${doneRows ? ` (${doneRows.toLocaleString()} so far)` : ''}…`,
        processing: 'Grouping applicants…',
      }
      setProgress({ stage, pct: pct ?? 0, msg: msgs[stage] || 'Processing…' })
    }

    try {
      let result
      if (ext === 'csv') {
        result = await parseCSVStream(file, onProgress)
      } else {
        result = await parseExcelStream(file, onProgress)
      }

      const { applicantRows, applicationRows } = result
      setProgress({ stage: 'done', pct: 100, msg: `Found ${applicantRows.length.toLocaleString()} applicants, ${applicationRows.length.toLocaleString()} applications` })
      setDone(true)

      // Short delay so user sees the 100% state
      setTimeout(() => onData(result, file.name), 600)
    } catch (e) {
      setProgress(null)
      setError(e.message)
    }
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const busy = progress && !done

  return (
    <div className={styles.overlay} onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>Upload applicant data</span>
          {!busy && <button className={styles.close} onClick={onClose}><X size={16} /></button>}
        </div>

        {/* Drop zone — hide when processing */}
        {!progress && (
          <div
            className={`${styles.zone} ${dragging ? styles.dragOver : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              style={{ display: 'none' }}
              onChange={e => e.target.files[0] && handleFile(e.target.files[0])}
            />
            <Upload size={28} strokeWidth={1.5} color="var(--text-muted)" />
            <p className={styles.dropText}>
              Drop your file here or <span className={styles.link}>browse</span>
            </p>
            <p className={styles.hint}>CSV and Excel — no file size limit</p>
          </div>
        )}

        {/* Progress */}
        {progress && (
          <div className={styles.progressWrap}>
            {done
              ? <CheckCircle size={28} color="var(--green)" />
              : <div className={styles.spinner} />
            }
            <p className={styles.progressMsg}>{progress.msg}</p>
            <div className={styles.progressBar}>
              <div
                className={`${styles.progressFill} ${done ? styles.progressDone : ''}`}
                style={{ width: `${progress.pct}%` }}
              />
            </div>
            <p className={styles.progressPct}>{progress.pct}%</p>
          </div>
        )}

        {error && (
          <div className={styles.error}>
            <X size={13} /> {error}
            <button className={styles.retryBtn} onClick={() => setError('')}>Try again</button>
          </div>
        )}

        {!progress && (
          <div className={styles.formats}>
            <div className={styles.fmt}><FileText size={13} /> CSV</div>
            <div className={styles.fmt}><FileText size={13} /> XLSX</div>
            <div className={styles.fmt}><FileText size={13} /> XLS</div>
            <span className={styles.fmtNote}>Handles large files (20MB+)</span>
          </div>
        )}
      </div>
    </div>
  )
}
