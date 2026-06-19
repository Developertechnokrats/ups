import { useState, useEffect, useMemo } from 'react'
import { Upload, Download, RefreshCw, Search, SlidersHorizontal, Database, Users } from 'lucide-react'
import { fetchDuplicates, fetchStats, upsertAllData } from '../lib/supabase'
import { parseCSV, parseExcel, enrichForDisplay, exportToCSV } from '../lib/dataUtils'
import StatsBar from '../components/StatsBar'
import ApplicantCard from '../components/ApplicantCard'
import UploadZone from '../components/UploadZone'
import styles from './Dashboard.module.css'

const FILTER_OPTIONS = ['All', '2 jobs', '3 jobs', '4+ jobs']

export default function Dashboard() {
  const [applicants, setApplicants]     = useState([])
  const [dbStats, setDbStats]           = useState({})
  const [loading, setLoading]           = useState(false)
  const [uploading, setUploading]       = useState(false)
  const [uploadMsg, setUploadMsg]       = useState('')
  const [showUpload, setShowUpload]     = useState(false)
  const [error, setError]               = useState('')
  const [search, setSearch]             = useState('')
  const [filter, setFilter]             = useState('All')
  const [fromDate, setFromDate]         = useState('')
  const [toDate, setToDate]             = useState('')
  const [view, setView]                 = useState('duplicates') // 'duplicates' | 'all'
  const [dbMode, setDbMode]             = useState(false)

  const hasSupabase = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
    && import.meta.env.VITE_SUPABASE_URL !== 'your_supabase_project_url')

  async function loadFromDB() {
    if (!hasSupabase) return
    setLoading(true)
    setError('')
    try {
      const [data, stats] = await Promise.all([
        fetchDuplicates({ fromDate: fromDate || undefined, toDate: toDate || undefined }),
        fetchStats()
      ])
      setApplicants(enrichForDisplay(data))
      setDbStats(stats)
      setDbMode(true)
    } catch (e) {
      setError('Could not connect to Supabase: ' + e.message)
    }
    setLoading(false)
  }

  useEffect(() => { if (hasSupabase) loadFromDB() }, [fromDate, toDate])

  async function handleUploadData(parsed, filename) {
    const { applicantRows, applicationRows } = parsed
    setShowUpload(false)

    if (hasSupabase) {
      setUploading(true)
      setUploadMsg(`Saving ${applicantRows.length} applicants and ${applicationRows.length} applications…`)
      setError('')
      try {
        await upsertAllData(applicantRows, applicationRows)
        setUploadMsg('Saved to Supabase. Refreshing…')
        await loadFromDB()
        setUploadMsg('')
      } catch (e) {
        setError('Supabase save failed: ' + e.message + '. Showing locally.')
        fallbackLocal(applicantRows)
      }
      setUploading(false)
    } else {
      fallbackLocal(applicantRows, applicationRows)
    }
  }

  function fallbackLocal(applicantRows, applicationRows) {
    // Map applications back onto applicants for display
    const appMap = {}
    for (const a of (applicationRows || [])) {
      const key = a.email
      if (!appMap[key]) appMap[key] = []
      appMap[key].push(a)
    }
    const enriched = applicantRows
      .filter(a => a.applied_count > 1)
      .map(a => ({ ...a, applications: appMap[a.email] || [] }))
    setApplicants(enrichForDisplay(enriched))
    setDbStats({
      totalApplicants: applicantRows.length,
      totalApplications: (applicationRows || []).length,
      duplicates: enriched.length,
    })
  }

  const displayed = useMemo(() => {
    let list = [...applicants]
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(a =>
        `${a.firstname} ${a.lastname}`.toLowerCase().includes(q) ||
        (a.email || '').toLowerCase().includes(q) ||
        (a.jobs || []).some(j => (j.title || '').toLowerCase().includes(q))
      )
    }
    if (filter === '2 jobs') list = list.filter(a => a.applied_count === 2)
    else if (filter === '3 jobs') list = list.filter(a => a.applied_count === 3)
    else if (filter === '4+ jobs') list = list.filter(a => a.applied_count >= 4)
    return list
  }, [applicants, search, filter])

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
            <SlidersHorizontal size={16} /> Dashboard
          </a>
        </nav>
        <div className={styles.sidebarStats}>
          {dbStats.totalApplicants != null && (
            <>
              <div className={styles.sidebarStat}>
                <span className={styles.sidebarStatVal}>{dbStats.totalApplicants}</span>
                <span className={styles.sidebarStatLabel}>Total applicants</span>
              </div>
              <div className={styles.sidebarStat}>
                <span className={styles.sidebarStatVal}>{dbStats.totalApplications}</span>
                <span className={styles.sidebarStatLabel}>Total applications</span>
              </div>
              <div className={styles.sidebarStat}>
                <span className={styles.sidebarStatVal}>{dbStats.duplicates}</span>
                <span className={styles.sidebarStatLabel}>Duplicates</span>
              </div>
            </>
          )}
        </div>
        <div className={styles.sidebarFooter}>
          {dbMode
            ? <div className={styles.dbBadge}><Database size={12} /> Supabase live</div>
            : <div className={styles.dbBadge} style={{ background: 'var(--amber-bg)', color: 'var(--amber-text)' }}>
                <Database size={12} /> Local mode
              </div>
          }
        </div>
      </aside>

      {/* Main */}
      <main className={styles.main}>
        {/* Topbar */}
        <div className={styles.topbar}>
          <div>
            <h1 className={styles.pageTitle}>Duplicate Applicants</h1>
            <p className={styles.pageSubtitle}>People who applied for more than one position</p>
          </div>
          <div className={styles.actions}>
            <button className={styles.btnSecondary} onClick={() => setShowUpload(true)}>
              <Upload size={14} /> Upload file
            </button>
            {hasSupabase && (
              <button className={styles.btnSecondary} onClick={loadFromDB} disabled={loading}>
                <RefreshCw size={14} className={loading ? styles.spin : ''} /> Refresh
              </button>
            )}
            <button className={styles.btnPrimary} onClick={() => exportToCSV(displayed)} disabled={!displayed.length}>
              <Download size={14} /> Export CSV
            </button>
          </div>
        </div>

        {error   && <div className={styles.bannerError}>{error}</div>}
        {uploadMsg && <div className={styles.bannerInfo}><RefreshCw size={13} className={styles.spin} /> {uploadMsg}</div>}

        <StatsBar applicants={displayed} dbStats={dbStats} />

        {/* Toolbar */}
        <div className={styles.toolbar}>
          <div className={styles.searchWrap}>
            <Search size={14} className={styles.searchIcon} />
            <input
              className={styles.search}
              placeholder="Search name, email, job title…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className={styles.dateRange}>
            <label className={styles.dateLabel}>From</label>
            <input type="date" className={styles.dateInput} value={fromDate} onChange={e => setFromDate(e.target.value)} />
            <label className={styles.dateLabel}>To</label>
            <input type="date" className={styles.dateInput} value={toDate} onChange={e => setToDate(e.target.value)} />
            {(fromDate || toDate) && (
              <button className={styles.clearDate} onClick={() => { setFromDate(''); setToDate('') }}>Clear</button>
            )}
          </div>

          <div className={styles.filterBtns}>
            {FILTER_OPTIONS.map(f => (
              <button key={f} className={`${styles.filterBtn} ${filter === f ? styles.filterActive : ''}`} onClick={() => setFilter(f)}>
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        {loading && (
          <div className={styles.empty}>
            <RefreshCw size={24} className={styles.spin} />
            <p>Loading from Supabase…</p>
          </div>
        )}

        {!loading && !displayed.length && !error && (
          <div className={styles.empty}>
            <Upload size={32} strokeWidth={1.2} color="var(--text-faint)" />
            <p className={styles.emptyTitle}>No data yet</p>
            <p className={styles.emptyHint}>Upload a CSV or Excel file — all rows will be saved to Supabase</p>
            <button className={styles.btnPrimary} onClick={() => setShowUpload(true)}>
              <Upload size={14} /> Upload file
            </button>
          </div>
        )}

        {!loading && displayed.length > 0 && (
          <div className={styles.cards}>
            <div className={styles.resultsRow}>
              <span className={styles.resultCount}>
                {displayed.length} applicant{displayed.length !== 1 ? 's' : ''}
                {search ? ` matching "${search}"` : ''}
              </span>
            </div>
            {displayed.map((a, i) => (
              <ApplicantCard key={a.email || i} applicant={a} index={i} />
            ))}
          </div>
        )}
      </main>

      {showUpload && <UploadZone onData={handleUploadData} onClose={() => setShowUpload(false)} />}
    </div>
  )
}
