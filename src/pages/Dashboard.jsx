import { useState, useEffect, useCallback } from 'react'
import { Upload, Download, RefreshCw, Search, Database, Users, Copy, Trash2, ShieldCheck, ChevronLeft, ChevronRight, Zap, Leaf, AlertCircle, RotateCcw } from 'lucide-react'
import { fetchPage, fetchStats, upsertAllData, clearAllData, fetchAllForExport, buildNotesForApplicants, fetchFreshStats, fetchOrphanedStats, refreshComputedTables, fetchStatusNames, hasSupabase, PAGE_SIZE } from '../lib/supabase'
export const hasGHL = !!import.meta.env.VITE_GHL_TOKEN
import { enrichForDisplay, exportToCSV } from '../lib/dataUtils'
import StatsBar from '../components/StatsBar'
import ApplicantCard from '../components/ApplicantCard'
import UploadZone from '../components/UploadZone'
import DbVerify from '../components/DbVerify'
import ApplicantModal from '../components/ApplicantModal'
import GHLPushModal from '../components/GHLPushModal'
import GHLDiag from '../components/GHLDiag'
import FreshToContact from './FreshToContact'
import OrphanedAppointments from './OrphanedAppointments'
import styles from './Dashboard.module.css'

const TAG_FILTERS = ['Any type', 'Armed', 'Unarmed', 'Admin', 'Supervisor']

export default function Dashboard() {
  const [applicants, setApplicants]     = useState([])
  const [totalCount, setTotalCount]     = useState(0)
  const [dbStats, setDbStats]           = useState({})
  const [currentPage, setCurrentPage]   = useState(0)
  const [loading, setLoading]           = useState(false)
  const [saveProgress, setSaveProgress] = useState(null)
  const [showUpload, setShowUpload]     = useState(false)
  const [showVerify, setShowVerify]     = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing]         = useState(false)
  const [error, setError]               = useState('')
  // Search is only triggered on button click or Enter — not on every keystroke
  const [searchInput, setSearchInput]   = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const [tagFilter, setTagFilter]       = useState('Any type')
  const [fromDate, setFromDate]         = useState('')
  const [toDate, setToDate]             = useState('')
  const [viewMode, setViewMode]         = useState('all')
  const [dbMode, setDbMode]             = useState(false)
  const [selectedApplicant, setSelectedApplicant] = useState(null)
  const [selectedIndex, setSelectedIndex]         = useState(0)
  const [ghlPushList, setGhlPushList]             = useState(null)
  const [showGHLDiag, setShowGHLDiag]           = useState(false)
  const [exporting, setExporting]       = useState(false)
  const [rebuilding, setRebuilding]     = useState(false)
  const [statusFilter, setStatusFilter]   = useState('')
  const [interviewFilter, setInterviewFilter] = useState('')
  const [statusOptions, setStatusOptions] = useState([])
  const [freshStats, setFreshStats]     = useState({})
  const [orphanedStats, setOrphanedStats] = useState({})

  async function handleRebuildCache() {
    setRebuilding(true)
    setError('')
    try {
      await refreshComputedTables()
      // Reload page and fresh stats after rebuild
      const fStats = await fetchFreshStats().catch(() => ({}))
      const oStats = await fetchOrphanedStats().catch(() => ({}))
      setFreshStats(fStats)
      setOrphanedStats(oStats)
    } catch(e) {
      setError('Cache rebuild failed: ' + e.message + ' — try running manually in Supabase SQL Editor.')
    }
    setRebuilding(false)
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  async function handleExport() {
    setExporting(true)
    setError('')
    try {
      let rows
      if (hasSupabase) {
        const raw = await fetchAllForExport({
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
          duplicatesOnly: viewMode === 'duplicates',
          search: activeSearch,
        })
        rows = enrichForDisplay(raw)
      } else {
        rows = displayed
      }
      // Apply tag filter client-side
      const toExport = tagFilter === 'Any type' ? rows : rows.filter(a => (a.tags||'').includes(tagFilter))
      exportToCSV(toExport, viewMode === 'duplicates' ? 'duplicate_applicants' : 'all_applicants')
    } catch(e) {
      setError('Export failed: ' + e.message)
    }
    setExporting(false)
  }

  // ── Fetch one page ────────────────────────────────────────────────────
  async function loadPage(page, opts = {}) {
    setLoading(true)
    setError('')
    try {
      const search  = opts.search  ?? activeSearch
      const from    = opts.from    ?? fromDate
      const to      = opts.to      ?? toDate
      const mode    = opts.mode    ?? viewMode

      const [result, stats, fStats] = await Promise.all([
        fetchPage({ fromDate: from || undefined, toDate: to || undefined, duplicatesOnly: mode === 'duplicates', page, search, statusFilter: opts.statusFilter ?? statusFilter, hasAppointmentFilter: opts.interviewFilter ?? interviewFilter }),
        fetchStats(),
        fetchFreshStats().catch(() => ({})),
      ])

      // Join applicants + applications, enrich safely — lowercase email for case-insensitive match
      const appMap = {}
      for (const a of result.applications) {
        const key = (a.email || '').toLowerCase()
        if (!appMap[key]) appMap[key] = []
        appMap[key].push(a)
      }
      const enriched = []
      for (const row of result.applicants) {
        try {
          const key = (row.email || '').toLowerCase()
          enriched.push(...enrichForDisplay([{ ...row, applications: appMap[key] || [] }]))
        } catch(_) {
          enriched.push({ ...row, jobs: [], tags: '' })
        }
      }

      setApplicants(enriched)
      setTotalCount(result.totalCount)
      setCurrentPage(page)
      setDbStats(stats)
      setFreshStats(fStats)
      setDbMode(true)
    } catch(e) {
      setError('Supabase fetch error: ' + e.message)
    }
    setLoading(false)
  }

  // Reload page 0 when filters change
  useEffect(() => {
    if (hasSupabase) loadPage(0)
  }, [fromDate, toDate, viewMode, activeSearch])

  function handleSearch() {
    setActiveSearch(searchInput)
    setCurrentPage(0)
  }

  function handleViewChange(mode) {
    setViewMode(mode)
    setTagFilter('Any type')
    setSearchInput('')
    setActiveSearch('')
    setCurrentPage(0)
  }

  function handleDateClear() {
    setFromDate('')
    setToDate('')
  }

  // ── Upload ───────────────────────────────────────────────────────────
  async function handleUploadData(parsed) {
    const { applicantRows, applicationRows } = parsed
    setShowUpload(false)
    setError('')

    if (hasSupabase) {
      setSaveProgress({ stage: 'applicants', done: 0, total: applicantRows.length })
      try {
        await upsertAllData(applicantRows, applicationRows, prog => setSaveProgress({ ...prog }))
        setSaveProgress({ stage: 'done', done: 0, total: 0 })
        await refreshComputedTables().catch(() => {})
        await loadPage(0)
        setSaveProgress(null)
      } catch(e) {
        setSaveProgress(null)
        setError('Save failed: ' + e.message + ' — showing locally.')
        // Show locally
        const appMap = {}
        for (const a of applicationRows) { const k=(a.email||'').toLowerCase(); if (!appMap[k]) appMap[k] = []; appMap[k].push(a) }
        const src = viewMode === 'duplicates' ? applicantRows.filter(a => a.applied_count > 1) : applicantRows
        const enriched = []
        for (const row of src.slice(0, PAGE_SIZE)) {
          try { enriched.push(...enrichForDisplay([{ ...row, applications: appMap[(row.email||'').toLowerCase()] || [] }])) }
          catch(_) { enriched.push({ ...row, jobs: [], tags: '' }) }
        }
        setApplicants(enriched)
        setTotalCount(src.length)
        setDbStats({ totalApplicants: applicantRows.length, totalApplications: applicationRows.length, duplicates: applicantRows.filter(a => a.applied_count > 1).length })
      }
    } else {
      const appMap = {}
      for (const a of applicationRows) { const k=(a.email||'').toLowerCase(); if (!appMap[k]) appMap[k] = []; appMap[k].push(a) }
      const src = viewMode === 'duplicates' ? applicantRows.filter(a => a.applied_count > 1) : applicantRows
      const enriched = []
      for (const row of src.slice(0, PAGE_SIZE)) {
        try { enriched.push(...enrichForDisplay([{ ...row, applications: appMap[(row.email||'').toLowerCase()] || [] }])) }
        catch(_) { enriched.push({ ...row, jobs: [], tags: '' }) }
      }
      setApplicants(enriched)
      setTotalCount(src.length)
      setDbStats({ totalApplicants: applicantRows.length, totalApplications: applicationRows.length, duplicates: applicantRows.filter(a => a.applied_count > 1).length })
    }
  }

  // ── Clear ─────────────────────────────────────────────────────────────
  async function handleClear() {
    setClearing(true)
    setError('')
    try {
      await clearAllData()
      setApplicants([]); setTotalCount(0); setDbStats({}); setDbMode(false); setConfirmClear(false)
    } catch(e) { setError('Clear failed: ' + e.message) }
    setClearing(false)
  }

  // ── Progress message ──────────────────────────────────────────────────
  function saveMsg(p) {
    if (!p) return ''
    if (p.stage === 'done') return 'Saved! Refreshing…'
    if (p.stage === 'clearing') return 'Clearing old data…'
    const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0
    const label = p.stage === 'applicants' ? 'Saving applicants' : 'Saving applications'
    const etaSec = Math.round(Math.ceil((p.total - p.done) / 500) * 0.35)
    const eta = etaSec > 3 ? ` · ~${etaSec < 60 ? etaSec + 's' : Math.ceil(etaSec/60) + 'm'} left` : ''
    return `${label}… ${p.done.toLocaleString()} / ${p.total.toLocaleString()} (${pct}%)${eta}`
  }

  // Client-side tag filter on loaded page
  const displayed = tagFilter === 'Any type' ? applicants : applicants.filter(a => (a.tags||'').includes(tagFilter))

  return (
    <div className={styles.layout}>

      {/* ── Sidebar ── */}
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.logo}>UPS</div>
          <span className={styles.brandName}>Applicant Hub</span>
        </div>

        <nav className={styles.nav}>
          <button className={`${styles.navItem} ${viewMode==='all' ? styles.active : ''}`} onClick={() => handleViewChange('all')}>
            <Users size={15}/> All applicants
            {dbStats.totalApplicants != null && <span className={styles.navCount}>{dbStats.totalApplicants.toLocaleString()}</span>}
          </button>
          <button className={`${styles.navItem} ${viewMode==='duplicates' ? styles.active : ''}`} onClick={() => handleViewChange('duplicates')}>
            <Copy size={15}/> Duplicates only
            {dbStats.duplicates != null && <span className={styles.navCountRed}>{dbStats.duplicates.toLocaleString()}</span>}
          </button>
          <button className={`${styles.navItem} ${viewMode==='fresh' ? styles.active : ''}`} onClick={() => handleViewChange('fresh')}>
            <Leaf size={15}/> Fresh to Contact
            {freshStats.freshCount != null && (
              <span className={styles.navCount} style={{background:'var(--green-bg)',color:'var(--green-text)'}}>{freshStats.freshCount.toLocaleString()}</span>
            )}
          </button>

        </nav>

        {Object.keys(dbStats).length > 0 && (
          <div className={styles.sidebarStats}>
            <div className={styles.sidebarStat}><span className={styles.sidebarStatVal}>{(dbStats.totalApplicants??0).toLocaleString()}</span><span className={styles.sidebarStatLabel}>Applicants</span></div>
            <div className={styles.sidebarStat}><span className={styles.sidebarStatVal}>{(dbStats.totalApplications??0).toLocaleString()}</span><span className={styles.sidebarStatLabel}>Applications</span></div>
            <div className={styles.sidebarStat}><span className={styles.sidebarStatVal}>{(dbStats.duplicates??0).toLocaleString()}</span><span className={styles.sidebarStatLabel}>Duplicates</span></div>
          </div>
        )}

        <div className={styles.sidebarFooter}>
          {hasSupabase && (
            <button
              className={styles.verifyBtn}
              style={rebuilding ? {} : { color:'var(--purple-text)', borderColor:'var(--purple)' }}
              onClick={handleRebuildCache}
              disabled={rebuilding}
              title="Rebuild Fresh to Contact and Orphaned caches after any upload"
            >
              <RotateCcw size={13} className={rebuilding ? styles.spin : ''}/>
              {rebuilding ? 'Rebuilding…' : 'Rebuild Cache'}
            </button>
          )}
          {hasSupabase && <button className={styles.verifyBtn} onClick={() => setShowVerify(true)}><ShieldCheck size={13}/> Verify DB</button>}
          {import.meta.env.VITE_GHL_TOKEN && (
            <button className={styles.verifyBtn} style={{color:'var(--amber-text)',borderColor:'var(--amber)'}} onClick={() => setShowGHLDiag(true)}><Zap size={13}/> GHL Diagnostics</button>
          )}
          {dbMode ? <div className={styles.dbBadge}><Database size={12}/> Supabase live</div>
                  : <div className={styles.dbBadgeLocal}><Database size={12}/> Local mode</div>}
        </div>
      </aside>

      {/* ── Main ── */}
      <main className={styles.main}>

        {/* Fresh to Contact — rendered as its own page */}
        {viewMode === 'fresh' && <FreshToContact />}
        {viewMode === 'orphaned' && <OrphanedAppointments />}

        {/* Main applicant views */}
        {viewMode !== 'fresh' && viewMode !== 'orphaned' && <>
        <div className={styles.topbar}>
          <div>
            <h1 className={styles.pageTitle}>{viewMode==='all' ? 'All Applicants' : 'Duplicate Applicants'}</h1>
            <p className={styles.pageSubtitle}>{viewMode==='all' ? 'Every applicant from the uploaded file' : 'People who applied for more than one position'}</p>
          </div>
          <div className={styles.actions}>
            <button className={styles.btnSecondary} onClick={() => setShowUpload(true)} disabled={!!saveProgress}><Upload size={14}/> Upload file</button>
            {hasSupabase && <button className={styles.btnSecondary} onClick={() => loadPage(currentPage)} disabled={loading||!!saveProgress}><RefreshCw size={14} className={loading?styles.spin:''}/> Refresh</button>}
            {hasSupabase && !confirmClear && <button className={styles.btnDanger} onClick={() => setConfirmClear(true)} disabled={!!saveProgress||clearing}><Trash2 size={14}/> Clear DB</button>}
            {hasSupabase && confirmClear && (
              <div className={styles.confirmRow}>
                <span className={styles.confirmText}>Delete all data?</span>
                <button className={styles.btnDangerSolid} onClick={handleClear} disabled={clearing}>{clearing?'Clearing…':'Yes, clear all'}</button>
                <button className={styles.btnSecondary} onClick={() => setConfirmClear(false)}>Cancel</button>
              </div>
            )}
            <button className={styles.btnPrimary} onClick={handleExport} disabled={!totalCount || exporting}>
              {exporting
                ? <><RefreshCw size={14} className={styles.spin}/> Exporting…</>
                : <><Download size={14}/> Export CSV ({totalCount.toLocaleString()})</>
              }
            </button>
            {import.meta.env.VITE_GHL_TOKEN && (
              <button className={styles.btnGHL} onClick={async () => {
                // Fetch all matching for GHL push
                setExporting(true)
                try {
                  const { fetchAllForExport: fetchAll } = await import('../lib/supabase')
                  const { enrichForDisplay: enrich } = await import('../lib/dataUtils')
                  const raw = hasSupabase ? await fetchAllForExport({
                    fromDate: fromDate || undefined,
                    toDate: toDate || undefined,
                    duplicatesOnly: viewMode === 'duplicates',
                    search: activeSearch,
                  }) : displayed
                  const rows = hasSupabase ? enrich(raw) : raw
                  const toSend = tagFilter === 'Any type' ? rows : rows.filter(a => (a.tags||'').includes(tagFilter))
                  // Build notes from DB applications before pushing
                  const withNotes = hasSupabase ? await buildNotesForApplicants(toSend) : toSend
                  setGhlPushList(withNotes)
                } catch(e) { setError('GHL prep failed: ' + e.message) }
                setExporting(false)
              }} disabled={!totalCount || exporting}>
                <Zap size={14}/> Push to GHL ({totalCount.toLocaleString()})
              </button>
            )}
          </div>
        </div>

        {error && <div className={styles.bannerError}>{error}</div>}
        {saveProgress && (
          <div className={styles.bannerInfo}>
            <RefreshCw size={13} className={styles.spin}/>
            <span style={{flex:1}}>{saveMsg(saveProgress)}</span>
            {saveProgress.total > 0 && (
              <div className={styles.savePBar}>
                <div className={styles.savePFill} style={{width:`${Math.min(100,Math.round(saveProgress.done/saveProgress.total*100))}%`}}/>
              </div>
            )}
          </div>
        )}

        <StatsBar applicants={displayed} dbStats={dbStats} viewMode={viewMode} totalCount={totalCount}/>

        {/* Search + date toolbar */}
        <div className={styles.toolbar}>
          <div className={styles.searchWrap}>
            <Search size={14} className={styles.searchIcon}/>
            <input
              className={styles.search}
              placeholder="Search name, email, phone…  then press Enter or click Search"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            {searchInput && (
              <button className={styles.searchClear} onClick={() => { setSearchInput(''); setActiveSearch('') }}>✕</button>
            )}
          </div>
          <button className={styles.btnSecondary} onClick={handleSearch} disabled={loading}>
            <Search size={14}/> Search
          </button>
          <div className={styles.dateRange}>
            <label className={styles.dateLabel}>Start date from</label>
            <input type="date" className={styles.dateInput} value={fromDate} onChange={e => setFromDate(e.target.value)}/>
            <label className={styles.dateLabel}>to</label>
            <input type="date" className={styles.dateInput} value={toDate} onChange={e => setToDate(e.target.value)}/>
            {(fromDate||toDate) && <button className={styles.clearDate} onClick={handleDateClear}>Clear</button>}
          </div>
        </div>

        {/* Type filter + Status + Interview filters */}
        <div className={styles.toolbar} style={{marginTop:'-8px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span className={styles.filterRowLabel}>Type</span>
            <div className={styles.filterBtns}>
              {TAG_FILTERS.map(f => (
                <button key={f} className={`${styles.filterBtn} ${tagFilter===f?styles.filterActive:''}`} onClick={() => setTagFilter(f)}>{f}</button>
              ))}
            </div>
          </div>

          {/* Status filter */}
          <div className={styles.dateRange}>
            <label className={styles.dateLabel}>Status</label>
            <select className={styles.dateInput} value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); loadPage(0, { statusFilter: e.target.value }) }}>
              <option value=''>Any status</option>
              {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {statusFilter && <button className={styles.clearDate} onClick={() => { setStatusFilter(''); loadPage(0, { statusFilter: '' }) }}>✕</button>}
          </div>

          {/* Interview filter */}
          <div className={styles.dateRange}>
            <label className={styles.dateLabel}>Interview</label>
            <select className={styles.dateInput} value={interviewFilter}
              onChange={e => { setInterviewFilter(e.target.value); loadPage(0, { interviewFilter: e.target.value }) }}>
              <option value=''>Any</option>
              <option value='yes'>Has appointment</option>
              <option value='no'>No appointment</option>
            </select>
            {interviewFilter && <button className={styles.clearDate} onClick={() => { setInterviewFilter(''); loadPage(0, { interviewFilter: '' }) }}>✕</button>}
          </div>

          {activeSearch && (
            <div className={styles.searchBadge}>
              Searching: <strong>"{activeSearch}"</strong>
              <button onClick={() => { setSearchInput(''); setActiveSearch('') }}>✕</button>
            </div>
          )}
        </div>

        {/* Content */}
        {loading && (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}><RefreshCw size={22} className={styles.spin}/></div>
            <p className={styles.emptyHint}>Loading page {currentPage+1}…</p>
          </div>
        )}

        {!loading && !applicants.length && !saveProgress && (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}><Upload size={24} strokeWidth={1.5}/></div>
            <p className={styles.emptyTitle}>No data yet</p>
            <p className={styles.emptyHint}>Upload a CSV or Excel file to get started.<br/>All rows are saved to Supabase and persist across sessions.</p>
            <button className={styles.btnPrimary} onClick={() => setShowUpload(true)}><Upload size={14}/> Upload file</button>
          </div>
        )}

        {!loading && displayed.length > 0 && (
          <div className={styles.cards}>
            <div className={styles.resultsRow}>
              <span className={styles.resultCount}>
                Page {currentPage+1} of {totalPages} · {totalCount.toLocaleString()} total applicant{totalCount!==1?'s':''}
              </span>
            </div>

            {displayed.map((a,i) => (
              <ApplicantCard
                key={a.email||i}
                applicant={a}
                index={i}
                onViewDetails={(applicant, idx) => { setSelectedApplicant(applicant); setSelectedIndex(idx) }}
                onPushGHL={import.meta.env.VITE_GHL_TOKEN ? async (a) => {
                  const withNotes = hasSupabase ? await buildNotesForApplicants([a]) : [a]
                  setGhlPushList(withNotes)
                } : null}
              />
            ))}

            {/* Pagination controls */}
            {totalPages > 1 && (
              <div className={styles.pagination}>
                <button className={styles.pageBtn} onClick={() => loadPage(0)} disabled={currentPage===0||loading}>««</button>
                <button className={styles.pageBtn} onClick={() => loadPage(currentPage-1)} disabled={currentPage===0||loading}>
                  <ChevronLeft size={14}/>
                </button>

                {/* Page number pills */}
                {Array.from({length: Math.min(7, totalPages)}, (_, i) => {
                  let p
                  if (totalPages <= 7) p = i
                  else if (currentPage < 4) p = i
                  else if (currentPage > totalPages - 5) p = totalPages - 7 + i
                  else p = currentPage - 3 + i
                  return (
                    <button
                      key={p}
                      className={`${styles.pageBtn} ${p===currentPage?styles.pageBtnActive:''}`}
                      onClick={() => loadPage(p)}
                      disabled={loading}
                    >
                      {p+1}
                    </button>
                  )
                })}

                <button className={styles.pageBtn} onClick={() => loadPage(currentPage+1)} disabled={currentPage>=totalPages-1||loading}>
                  <ChevronRight size={14}/>
                </button>
                <button className={styles.pageBtn} onClick={() => loadPage(totalPages-1)} disabled={currentPage>=totalPages-1||loading}>»»</button>

                <span className={styles.pageInfo}>
                  Showing {currentPage*PAGE_SIZE+1}–{Math.min((currentPage+1)*PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}
                </span>
              </div>
            )}
          </div>
        )}
        </> }
      </main>

      {showUpload && <UploadZone onData={handleUploadData} onClose={() => setShowUpload(false)}/>}
      {showVerify && <DbVerify onClose={() => setShowVerify(false)}/>}
      {showGHLDiag && <GHLDiag
        onClose={() => setShowGHLDiag(false)}
        sampleApplicant={applicants[0] || null}
        onPrepareSample={async (a) => {
          const withNotes = hasSupabase ? await buildNotesForApplicants([a]) : [a]
          return withNotes[0]
        }}
      />}
      {ghlPushList && (
        <GHLPushModal
          applicants={ghlPushList}
          onClose={() => setGhlPushList(null)}
          onComplete={(results) => {
            // Refresh to show updated ghl_status
            setGhlPushList(null)
            loadPage(currentPage)
          }}
        />
      )}
      {selectedApplicant && (
        <ApplicantModal
          applicant={selectedApplicant}
          index={selectedIndex}
          onClose={() => setSelectedApplicant(null)}
        />
      )}
    </div>
  )
}
