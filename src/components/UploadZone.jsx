import { useRef, useState } from 'react'
import { Upload, FileText, X } from 'lucide-react'
import { parseCSV, parseExcel } from '../lib/dataUtils'
import styles from './UploadZone.module.css'

export default function UploadZone({ onData, onClose }) {
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef()

  async function handleFile(file) {
    setError('')
    setLoading(true)
    try {
      const ext = file.name.split('.').pop().toLowerCase()
      let result
      if (ext === 'csv') {
        const text = await file.text()
        result = parseCSV(text)
      } else if (['xlsx', 'xls'].includes(ext)) {
        const buf = await file.arrayBuffer()
        result = parseExcel(new Uint8Array(buf))
      } else {
        throw new Error('Please upload a CSV or Excel (.xlsx / .xls) file.')
      }
      onData(result, file.name)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>Upload applicant data</span>
          <button className={styles.close} onClick={onClose}><X size={16} /></button>
        </div>

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
          <p className={styles.dropText}>Drop your file here or <span className={styles.link}>browse</span></p>
          <p className={styles.hint}>Supports CSV and Excel (.xlsx, .xls)</p>
        </div>

        {loading && <p className={styles.status}>Processing file…</p>}
        {error && <p className={styles.error}><X size={13} /> {error}</p>}

        <div className={styles.formats}>
          <div className={styles.fmt}><FileText size={14} /> CSV</div>
          <div className={styles.fmt}><FileText size={14} /> XLSX</div>
          <div className={styles.fmt}><FileText size={14} /> XLS</div>
        </div>
      </div>
    </div>
  )
}
