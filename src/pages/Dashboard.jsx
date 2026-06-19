import { useState, useEffect, useMemo } from 'react'
import { Upload, Download, RefreshCw, Search, SlidersHorizontal, Database, Users, Copy, Trash2 } from 'lucide-react'
import { fetchDuplicates, fetchAllApplicants, fetchStats, upsertAllData, clearAllData, hasSupabase } from '../lib/supabase'
import { enrichForDisplay, exportToCSV } from '../lib/dataUtils'
import StatsBar from '../components/StatsBar'
import ApplicantCard from '../components/ApplicantCard'
import UploadZone from '../components/UploadZone'
import styles from './Dashboard.module.css'

const JOB_FILTERS  = ['All', '1 job', '2 jobs', '3 jobs', '4+ jobs']
const TAG_FILTERS  = ['Any type', 'Armed', 'Unarmed', 'Admin', 'Supervisor']

export default function Dashboard() {
  const [applicants, setApplicants]     = useState([])
  const [dbStats, setDbStats]           = useState({})
  const [loading, setLoading]           = useState(false)
  const [saveProgress, setSaveProgress] = useState(null)
  const [showUpload, setShowUpload]     = useState(false)
  const [error, setError]               = useState('')
  const [search, setSearch]             = useState('')
  const [jobFilter, setJobFilter]       = useState('All')
  const [tagFilter, setTagFilter]       = useState('Any type')
  const [fromDate, setFromDate]         = useState('')
  const [toDate, setToDate]             = useState('')
  const [viewMode, setViewMode]         = useState('all')   // 'all' | 'duplicates'
  const [dbMode, setDbMode]             = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing]         = useState(false)

  async function loadFromDB(mode = viewMode) {
    setLoading(true)
    setError('')
    try {
      const fetchFn = mode === 'duplicates' ? fetchDuplicates : fetchAllApplicants
      const [data, stats] = await Promise.all([
        fetchFn({ fromDate: fromDate || undefined, toDate: toDate || undefined }),
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

  useEffect(() => { if (hasSupabase) loadFromDB(viewMode) }, [fromDate, toDate, viewMode])

  function handleViewChange(mode) {
    setViewMode(mode)
    setJobFilter('All')
    setTagFilter('Any type')
  }

  async function handleUploadData(parsed) {
    const { applicantRows, applicationRows } = parsed
    setShowUpload(false)
    setError('')

    if (hasSupabase) {
      setSaveProgress({ stage: 'applicants', done: 0, total: applicantRows.length })
      try {
        await upsertAllData(applicantRows, applicationRows, (prog) => {
          setSaveProgress({ stage: prog.stage, done: prog.done, total: prog.total })
        })
        setSaveProgress({ stage: 'done', done: 0, total: 0 })
        await loadFromDB(viewMode)
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
    const enriched = viewMode === 'duplicates'
      ? applicantRows.filter(a => a.applied_count > 1)
      : applicantRows
    setApplicants(enrichForDisplay(
      enriched.map(a => ({ ...a, applications: appMap[a.email] || [] }))
    ))
    setDbStats({
      totalApplicants:   applicantRows.length,
      totalApplications: applicationRows.length,
      duplicates:        applicantRows.filter(a => a.applied_count > 1).length,
    })
  }

  async function handleClear() {
    setClearing(true)
    setError('')
    try {
      await clearAllData()
      setApplicants([])
      setDbStats({})
      setDbMode(false)
      setConfirmClear(false)
    } catch (e) {
      setError('Clear failed: ' + e.message)
    }
    setClearing(false)
  }

  function buildSaveMsg(p) {
    if (!p) return ''
    if (p.stage === 'done') return 'Saved! Refreshing…'
    if (p.stage === 'clearing') return 'Clearing old data…'
    const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0
    const label = p.stage === 'applicants' ? 'Saving applicants' : 'Saving applications'
    // Rough ETA: applicants ~100/batch @ 150ms, applications ~50/batch @ 100ms
    const remaining = p.total - p.done
    const msPerRow = p.stage === 'applicants' ? 0.15 : 0.1
    const etaSec = Math.round((remaining * msPerRow))
    const etaStr = etaSec > 5 ? ` · ~${etaSec < 60 ? etaSec + 's' : Math.ceil(etaSec/60) + 'm'} left` : ''
    return `${label}… ${p.done.toLocaleString()} / ${p.total.toLocaleString()} (${pct}%)${etaStr}`
  }
  const saveMsg = buildSaveMsg(saveProgress)

  const displayed = useMemo(() => {
    let list = [...applicants]
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(a =>
        `${a.firstname} ${a.lastname}`.toLowerCase().includes(q) ||
        (a.email || '').toLowerCase().includes(q) ||
        (a.phone || '').includes(q) ||
        (a.jobs || []).some(j => (j.title || '').toLowerCase().includes(q))
      )
    }
    if (jobFilter === '1 job')       list = list.filter(a => a.applied_count === 1)
    else if (jobFilter === '2 jobs') list = list.filter(a => a.applied_count === 2)
    else if (jobFilter === '3 jobs') list = list.filter(a => a.applied_count === 3)
    else if (jobFilter === '4+ jobs')list = list.filter(a => a.applied_count >= 4)
    if (tagFilter !== 'Any type') {
      list = list.filter(a => (a.tags || '').includes(tagFilter))
    }
    return list
  }, [applicants, search, jobFilter, tagFilter])

  const exportFilename = viewMode === 'duplicates' ? 'duplicate_applicants' : 'all_applicants'

  return (
    <div className={styles.layout}>
      {/* ── Sidebar ── */}
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.logo}>UPS</div>
          <span className={styles.brandName}>Applicant Hub</span>
        </div>

        <nav className={styles.nav}>
          <button
            className={`${styles.navItem} ${viewMode === 'all' ? styles.active : ''}`}
            onClick={() => handleViewChange('all')}
          >
            <Users size={15} /> All applicants
            {dbStats.totalApplicants != null && (
              <span className={styles.navCount}>{dbStats.totalApplicants.toLocaleString()}</span>
            )}
          </button>
          <button
            className={`${styles.navItem} ${viewMode === 'duplicates' ? styles.active : ''}`}
            onClick={() => handleViewChange('duplicates')}
          >
            <Copy size={15} /> Duplicates only
            {dbStats.duplicates != null && (
              <span className={styles.navCountRed}>{dbStats.duplicates}</span>
            )}
          </button>
        </nav>

        {Object.keys(dbStats).length > 0 && (
          <div className={styles.sidebarStats}>
            <div className={styles.sidebarStat}>
              <span className={styles.sidebarStatVal}>{(dbStats.totalApplicants ?? 0).toLocaleString()}</span>
              <span className={styles.sidebarStatLabel}>Applicants</span>
            </div>
            <div className={styles.sidebarStat}>
              <span className={styles.sidebarStatVal}>{(dbStats.totalApplications ?? 0).toLocaleString()}</span>
              <span className={styles.sidebarStatLabel}>Applications</span>
            </div>
            <div className={styles.sidebarStat}>
              <span className={styles.sidebarStatVal}>{(dbStats.duplicates ?? 0).toLocaleString()}</span>
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
            <h1 className={styles.pageTitle}>
              {viewMode === 'all' ? 'All Applicants' : 'Duplicate Applicants'}
            </h1>
            <p className={styles.pageSubtitle}>
              {viewMode === 'all'
                ? 'Every applicant from the uploaded file'
                : 'People who applied for more than one position'}
            </p>
          </div>
          <div className={styles.actions}>
            <button className={styles.btnSecondary} onClick={() => setShowUpload(true)} disabled={!!saveProgress}>
              <Upload size={14} /> Upload file
            </button>
            {hasSupabase && (
              <button className={styles.btnSecondary} onClick={() => loadFromDB(viewMode)} disabled={loading || !!saveProgress}>
                <RefreshCw size={14} className={loading ? styles.spin : ''} /> Refresh
              </button>
            )}
            {hasSupabase && !confirmClear && (
              <button className={styles.btnDanger} onClick={() => setConfirmClear(true)} disabled={!!saveProgress || clearing}>
                <Trash2 size={14} /> Clear DB
              </button>
            )}
            {hasSupabase && confirmClear && (
              <div className={styles.confirmRow}>
                <span className={styles.confirmText}>Delete all data?</span>
                <button className={styles.btnDangerSolid} onClick={handleClear} disabled={clearing}>
                  {clearing ? 'Clearing…' : 'Yes, clear all'}
                </button>
                <button className={styles.btnSecondary} onClick={() => setConfirmClear(false)}>Cancel</button>
              </div>
            )}
            <button
              className={styles.btnPrimary}
              onClick={() => exportToCSV(displayed, exportFilename)}
              disabled={!displayed.length}
            >
              <Download size={14} /> Export CSV ({displayed.length.toLocaleString()})
            </button>
          </div>
        </div>

        {error && <div className={styles.bannerError}>{error}</div>}
        {saveProgress && (
          <div className={styles.bannerInfo}>
            <RefreshCw size={13} className={styles.spin} />
            <span style={{ flex: 1 }}>{saveMsg}</span>
            {saveProgress.total > 0 && (
              <div className={styles.savePBar}>
                <div
                  className={styles.savePFill}
                  style={{ width: `${Math.min(100, Math.round((saveProgress.done / saveProgress.total) * 100))}%` }}
                />
              </div>
            )}
          </div>
        )}

        <StatsBar applicants={displayed} dbStats={dbStats} viewMode={viewMode} />

        {/* Toolbar */}
        <div className={styles.toolbar}>
          <div className={styles.searchWrap}>
            <Search size={14} className={styles.searchIcon} />
            <input
              className={styles.search}
              placeholder="Search name, email, phone, job title…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className={styles.dateRange}>
            <label className={styles.dateLabel}>Start date from</label>
            <input type="date" className={styles.dateInput} value={fromDate} onChange={e => setFromDate(e.target.value)} />
            <label className={styles.dateLabel}>to</label>
            <input type="date" className={styles.dateInput} value={toDate} onChange={e => setToDate(e.target.value)} />
            {(fromDate || toDate) && (
              <button className={styles.clearDate} onClick={() => { setFromDate(''); setToDate('') }}>Clear</button>
            )}
          </div>
        </div>

        {/* Second toolbar row — type + job count filters */}
        <div className={styles.toolbar} style={{ marginTop: '-8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className={styles.filterRowLabel}>Type</span>
            <div className={styles.filterBtns}>
              {TAG_FILTERS.map(f => (
                <button key={f} className={`${styles.filterBtn} ${tagFilter === f ? styles.filterActive : ''}`} onClick={() => setTagFilter(f)}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className={styles.filterRowLabel}>Count</span>
            <div className={styles.filterBtns}>
              {JOB_FILTERS.map(f => (
                <button key={f} className={`${styles.filterBtn} ${jobFilter === f ? styles.filterActive : ''}`} onClick={() => setJobFilter(f)}>
                  {f}
                </button>
              ))}
            </div>
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
            <p className={styles.emptyHint}>
              Upload a CSV or Excel file to get started.<br />
              All rows are saved to Supabase and persist across sessions.
            </p>
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
