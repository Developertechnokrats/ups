import { useState, useEffect, useMemo } from 'react'
import { Upload, Download, RefreshCw, Search, SlidersHorizontal, Database } from 'lucide-react'
import { fetchApplicants, upsertApplicants } from '../lib/supabase'
import { exportToCSV } from '../lib/dataUtils'
import StatsBar from '../components/StatsBar'
import ApplicantCard from '../components/ApplicantCard'
import UploadZone from '../components/UploadZone'
import styles from './Dashboard.module.css'

const FILTER_OPTIONS = ['All', '2 jobs', '3 jobs', '4+ jobs']

export default function Dashboard() {
  const [applicants, setApplicants] = useState([])
  const [totalRows, setTotalRows] = useState(0)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [dbMode, setDbMode] = useState(false)
  const [localData, setLocalData] = useState([])

  const hasSupabase = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)

  async function loadFromDB() {
    if (!hasSupabase) return
    setLoading(true)
    setError('')
    try {
      const data = await fetchApplicants({ fromDate: fromDate || undefined, toDate: toDate || undefined })
      setApplicants(data || [])
      setDbMode(true)
    } catch (e) {
      setError('Could not connect to Supabase. Using local data only.')
    }
    setLoading(false)
  }

  useEffect(() => {
    if (hasSupabase) loadFromDB()
  }, [fromDate, toDate])

  async function handleUploadData(rows, filename) {
    setShowUpload(false)
    if (hasSupabase) {
      setUploading(true)
      setError('')
      try {
        const toSave = rows.map(r => ({
          firstname: r.firstname,
          lastname: r.lastname,
          email: r.email,
          phone: r.phone,
          last_appointment_date: r.last_appointment_date,
          applied_count: r.applied_count,
          notes: r.notes,
        }))
        await upsertApplicants(toSave)
        const merged = mergeWithJobs(rows, await fetchApplicants())
        setApplicants(merged)
        setDbMode(true)
      } catch (e) {
        setError('Supabase save failed. Showing data locally.')
        setApplicants(rows)
        setLocalData(rows)
      }
      setUploading(false)
    } else {
      setApplicants(rows)
      setLocalData(rows)
    }
    // Estimate total rows from file — we store it in state
    const estTotal = rows.reduce((s, r) => s + r.applied_count, 0) + (rows.length * 0)
    setTotalRows(estTotal + rows.reduce((s,r) => s + r.applied_count, 0))
  }

  function mergeWithJobs(parsed, saved) {
    return (saved || []).map(s => {
      const match = parsed.find(p => p.email === s.email)
      return match ? { ...s, jobs: match.jobs } : s
    })
  }

  const displayed = useMemo(() => {
    let list = [...applicants]
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(a =>
        `${a.firstname} ${a.lastname}`.toLowerCase().includes(q) ||
        a.email?.toLowerCase().includes(q) ||
        a.notes?.toLowerCase().includes(q)
      )
    }
    if (filter === '2 jobs') list = list.filter(a => a.applied_count === 2)
    else if (filter === '3 jobs') list = list.filter(a => a.applied_count === 3)
    else if (filter === '4+ jobs') list = list.filter(a => a.applied_count >= 4)
    return list
  }, [applicants, search, filter])

  const totalAppsCount = useMemo(() => applicants.reduce((s,a) => s + a.applied_count, 0), [applicants])

  return (
    <div className={styles.layout}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.logo}>UPS</div>
          <span className={styles.brandName}>Applicant Hub</span>
        </div>
        <nav className={styles.nav}>
          <a className={`${styles.navItem} ${styles.active}`}>
            <SlidersHorizontal size={16} />
            Dashboard
          </a>
        </nav>
        <div className={styles.sidebarFooter}>
          {dbMode && hasSupabase && (
            <div className={styles.dbBadge}><Database size={12} /> Supabase connected</div>
          )}
          {!hasSupabase && (
            <div className={styles.dbBadge} style={{ background: 'var(--amber-bg)', color: 'var(--amber-text)' }}>
              <Database size={12} /> Local mode
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className={styles.main}>
        {/* Topbar */}
        <div className={styles.topbar}>
          <div>
            <h1 className={styles.pageTitle}>Duplicate Applicants</h1>
            <p className={styles.pageSubtitle}>Applicants who applied for more than one position</p>
          </div>
          <div className={styles.actions}>
            <button className={styles.btnSecondary} onClick={() => setShowUpload(true)}>
              <Upload size={14} /> Upload
            </button>
            {hasSupabase && (
              <button className={styles.btnSecondary} onClick={loadFromDB} disabled={loading}>
                <RefreshCw size={14} className={loading ? styles.spin : ''} /> Refresh
              </button>
            )}
            <button
              className={styles.btnPrimary}
              onClick={() => exportToCSV(displayed)}
              disabled={!displayed.length}
            >
              <Download size={14} /> Export CSV
            </button>
          </div>
        </div>

        {error && <div className={styles.error}>{error}</div>}
        {uploading && <div className={styles.notice}>Saving to Supabase…</div>}

        <StatsBar applicants={displayed} totalRows={totalAppsCount} />

        {/* Filters */}
        <div className={styles.toolbar}>
          <div className={styles.searchWrap}>
            <Search size={14} className={styles.searchIcon} />
            <input
              className={styles.search}
              placeholder="Search by name, email or job…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className={styles.dateRange}>
            <label className={styles.dateLabel}>From</label>
            <input type="date" className={styles.dateInput} value={fromDate} onChange={e => setFromDate(e.target.value)} />
            <label className={styles.dateLabel}>To</label>
            <input type="date" className={styles.dateInput} value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>

          <div className={styles.filterBtns}>
            {FILTER_OPTIONS.map(f => (
              <button
                key={f}
                className={`${styles.filterBtn} ${filter === f ? styles.filterActive : ''}`}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Cards list */}
        {loading && (
          <div className={styles.empty}>
            <RefreshCw size={24} className={styles.spin} />
            <p>Loading…</p>
          </div>
        )}

        {!loading && !displayed.length && (
          <div className={styles.empty}>
            <Upload size={32} strokeWidth={1.2} color="var(--text-faint)" />
            <p className={styles.emptyTitle}>No data yet</p>
            <p className={styles.emptyHint}>Upload a CSV or Excel file to get started</p>
            <button className={styles.btnPrimary} onClick={() => setShowUpload(true)}>
              <Upload size={14} /> Upload file
            </button>
          </div>
        )}

        {!loading && displayed.length > 0 && (
          <div className={styles.cards}>
            <div className={styles.resultsRow}>
              <span className={styles.resultCount}>Showing {displayed.length} applicant{displayed.length !== 1 ? 's' : ''}</span>
            </div>
            {displayed.map((a, i) => (
              <ApplicantCard key={a.email || i} applicant={a} index={i} />
            ))}
          </div>
        )}
      </main>

      {showUpload && (
        <UploadZone onData={handleUploadData} onClose={() => setShowUpload(false)} />
      )}
    </div>
  )
}
