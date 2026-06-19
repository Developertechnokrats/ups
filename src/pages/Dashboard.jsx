import { useState, useEffect, useMemo } from 'react'
import { Upload, Download, RefreshCw, Search, SlidersHorizontal, Database } from 'lucide-react'
import { fetchDuplicates, fetchStats, upsertAllData, hasSupabase } from '../lib/supabase'
import { enrichForDisplay, exportToCSV } from '../lib/dataUtils'
import StatsBar from '../components/StatsBar'
import ApplicantCard from '../components/ApplicantCard'
import UploadZone from '../components/UploadZone'
import styles from './Dashboard.module.css'

const FILTER_OPTIONS = ['All', '2 jobs', '3 jobs', '4+ jobs']

export default function Dashboard() {
  const [applicants, setApplicants] = useState([])
  const [dbStats, setDbStats]       = useState({})
  const [loading, setLoading]       = useState(false)
  const [saveProgress, setSaveProgress] = useState(null)  // null | { stage, done, total }
  const [showUpload, setShowUpload] = useState(false)
  const [error, setError]           = useState('')
  const [search, setSearch]         = useState('')
  const [filter, setFilter]         = useState('All')
  const [fromDate, setFromDate]     = useState('')
  const [toDate, setToDate]         = useState('')
  const [dbMode, setDbMode]         = useState(false)

  async function loadFromDB() {
    setLoading(true)
    setError('')
    try {
      const [data, stats] = await Promise.all([
        fetchDuplicates({ fromDate: fromDate || undefined, toDate: toDate || undefined }),
        fetchStats(),
      ])
      setApplicants(enrichForDisplay(data))
      setDbStats(stats)
      setDbMode(true)
    } catch (e) {
      setError('Supabase fetch error: ' + e.message)
    }
    setLoading(false)
  }

  useEffect(() => { if (hasSupabase) loadFromDB() }, [fromDate, toDate])

  async function handleUploadData(parsed) {
    const { applicantRows, applicationRows } = parsed
    setShowUpload(false)
    setError('')

    if (hasSupabase) {
      setSaveProgress({ stage: 'applicants', done: 0, total: applicantRows.length + applicationRows.length })
      try {
        await upsertAllData(applicantRows, applicationRows, (prog) => {
          setSaveProgress({
            stage: prog.stage,
            done:  prog.done,
            total: prog.stage === 'applicants' ? applicantRows.length : applicationRows.length,
          })
        })
        setSaveProgress({ stage: 'done', done: 0, total: 0 })
        await loadFromDB()
        setSaveProgress(null)
      } catch (e) {
        setSaveProgress(null)
        setError('Save failed: ' + e.message + ' — showing data locally.')
        showLocal(applicantRows, applicationRows)
      }
    } else {
      showLocal(applicantRows, applicationRows)
    }
  }

  function showLocal(applicantRows, applicationRows) {
    const appMap = {}
    for (const a of applicationRows) {
      if (!appMap[a.email]) appMap[a.email] = []
      appMap[a.email].push(a)
    }
    const enriched = applicantRows
      .filter(a => a.applied_count > 1)
      .map(a => ({ ...a, applications: appMap[a.email] || [] }))
    setApplicants(enrichForDisplay(enriched))
    setDbStats({
      totalApplicants:   applicantRows.length,
      totalApplications: applicationRows.length,
      duplicates:        enriched.length,
    })
  }

  // Save progress banner message
  const saveMsg = saveProgress
    ? saveProgress.stage === 'done'
      ? 'Saved! Refreshing dashboard…'
      : saveProgress.stage === 'applicants'
        ? `Saving applicants… ${saveProgress.done} / ${saveProgress.total}`
        : `Saving applications… ${saveProgress.done} / ${saveProgress.total}`
    : ''

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
    if (filter === '2 jobs')       list = list.filter(a => a.applied_count === 2)
    else if (filter === '3 jobs')  list = list.filter(a => a.applied_count === 3)
    else if (filter === '4+ jobs') list = list.filter(a => a.applied_count >= 4)
    return list
  }, [applicants, search, filter])

  return (
    <div className={styles.layout}>
      {/* ── Sidebar ── */}
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.logo}>UPS</div>
          <span className={styles.brandName}>Applicant Hub</span>
        </div>

        <nav className={styles.nav}>
          <span className={`${styles.navItem} ${styles.active}`}>
            <SlidersHorizontal size={16} /> Dashboard
          </span>
        </nav>

        {Object.keys(dbStats).length > 0 && (
          <div className={styles.sidebarStats}>
            <div className={styles.sidebarStat}>
              <span className={styles.sidebarStatVal}>{(dbStats.totalApplicants ?? '—').toLocaleString?.() ?? dbStats.totalApplicants}</span>
              <span className={styles.sidebarStatLabel}>Total applicants</span>
            </div>
            <div className={styles.sidebarStat}>
              <span className={styles.sidebarStatVal}>{(dbStats.totalApplications ?? '—').toLocaleString?.() ?? dbStats.totalApplications}</span>
              <span className={styles.sidebarStatLabel}>Applications</span>
            </div>
            <div className={styles.sidebarStat}>
              <span className={styles.sidebarStatVal}>{dbStats.duplicates ?? '—'}</span>
              <span className={styles.sidebarStatLabel}>Duplicates</span>
            </div>
          </div>
        )}

        <div className={styles.sidebarFooter}>
          {dbMode
            ? <div className={styles.dbBadge}><Database size={12} /> Supabase live</div>
            : <div className={styles.dbBadgeLocal}><Database size={12} /> Local mode</div>
          }
        </div>
      </aside>

      {/* ── Main ── */}
      <main className={styles.main}>
        <div className={styles.topbar}>
          <div>
            <h1 className={styles.pageTitle}>Duplicate Applicants</h1>
            <p className={styles.pageSubtitle}>People who applied for more than one position</p>
          </div>
          <div className={styles.actions}>
            <button className={styles.btnSecondary} onClick={() => setShowUpload(true)} disabled={!!saveProgress}>
              <Upload size={14} /> Upload file
            </button>
            {hasSupabase && (
              <button className={styles.btnSecondary} onClick={loadFromDB} disabled={loading || !!saveProgress}>
                <RefreshCw size={14} className={loading ? styles.spin : ''} /> Refresh
              </button>
            )}
            <button className={styles.btnPrimary} onClick={() => exportToCSV(displayed)} disabled={!displayed.length}>
              <Download size={14} /> Export CSV
            </button>
          </div>
        </div>

        {error && <div className={styles.bannerError}>{error}</div>}

        {saveProgress && (
          <div className={styles.bannerInfo}>
            <RefreshCw size={13} className={styles.spin} />
            <span>{saveMsg}</span>
            {saveProgress.total > 0 && (
              <div className={styles.savePBar}>
                <div
                  className={styles.savePFill}
                  style={{ width: `${Math.round((saveProgress.done / saveProgress.total) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

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
            <div className={styles.emptyIcon}><RefreshCw size={22} className={styles.spin} /></div>
            <p className={styles.emptyHint}>Loading from Supabase…</p>
          </div>
        )}

        {!loading && !displayed.length && !saveProgress && (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}><Upload size={24} strokeWidth={1.5} /></div>
            <p className={styles.emptyTitle}>No data yet</p>
            <p className={styles.emptyHint}>Upload a CSV or Excel file to get started.<br />All rows are saved to Supabase and persist across sessions.</p>
            <button className={styles.btnPrimary} onClick={() => setShowUpload(true)}>
              <Upload size={14} /> Upload file
            </button>
          </div>
        )}

        {!loading && displayed.length > 0 && (
          <div className={styles.cards}>
            <div className={styles.resultsRow}>
              <span className={styles.resultCount}>
                {displayed.length.toLocaleString()} applicant{displayed.length !== 1 ? 's' : ''}
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
