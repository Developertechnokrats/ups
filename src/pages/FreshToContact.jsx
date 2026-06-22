import { useState, useEffect } from 'react'
import { Upload, Download, RefreshCw, Search, Zap, ChevronLeft, ChevronRight, Leaf } from 'lucide-react'
import { fetchFreshToContact, fetchFreshStats, buildNotesForApplicants, hasSupabase, PAGE_SIZE } from '../lib/supabase'
import { exportToCSV } from '../lib/dataUtils'
import ApplicantCard from '../components/ApplicantCard'
import ApplicantModal from '../components/ApplicantModal'
import GHLPushModal from '../components/GHLPushModal'
import AppointmentUpload from '../components/AppointmentUpload'
import styles from './Dashboard.module.css'

export default function FreshToContact() {
  const [applicants, setApplicants]   = useState([])
  const [totalCount, setTotalCount]   = useState(0)
  const [freshStats, setFreshStats]   = useState({})
  const [currentPage, setCurrentPage] = useState(0)
  const [loading, setLoading]         = useState(false)
  const [exporting, setExporting]     = useState(false)
  const [error, setError]             = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const [fromDate, setFromDate]       = useState('')
  const [toDate, setToDate]           = useState('')
  const [selectedApplicant, setSelectedApplicant] = useState(null)
  const [selectedIndex, setSelectedIndex]         = useState(0)
  const [ghlPushList, setGhlPushList] = useState(null)
  const [showApptUpload, setShowApptUpload] = useState(false)

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  async function loadPage(page) {
    setLoading(true); setError('')
    try {
      const [result, stats] = await Promise.all([
        fetchFreshToContact({ fromDate: fromDate||undefined, toDate: toDate||undefined, page, search: activeSearch }),
        fetchFreshStats(),
      ])
      setApplicants(result.applicants.map(a => ({ ...a, jobs: [], tags: a.tags || '' })))
      setTotalCount(result.totalCount)
      setCurrentPage(page)
      setFreshStats(stats)
    } catch(e) { setError('Error: ' + e.message) }
    setLoading(false)
  }

  useEffect(() => { if (hasSupabase) loadPage(0) }, [fromDate, toDate, activeSearch])

  async function handleExport() {
    setExporting(true)
    try {
      const all = []
      let p = 0
      while (true) {
        const r = await fetchFreshToContact({ fromDate: fromDate||undefined, toDate: toDate||undefined, page: p, search: activeSearch })
        all.push(...r.applicants)
        if (all.length >= r.totalCount || r.applicants.length < PAGE_SIZE) break
        p++
      }
      const withNotes = hasSupabase ? await buildNotesForApplicants(all) : all
      exportToCSV(withNotes, 'fresh_to_contact')
    } catch(e) { setError('Export failed: ' + e.message) }
    setExporting(false)
  }

  async function handlePushAll() {
    setExporting(true)
    try {
      const all = []
      let p = 0
      while (true) {
        const r = await fetchFreshToContact({ fromDate: fromDate||undefined, toDate: toDate||undefined, page: p, search: activeSearch })
        all.push(...r.applicants)
        if (all.length >= r.totalCount || r.applicants.length < PAGE_SIZE) break
        p++
      }
      const withNotes = hasSupabase ? await buildNotesForApplicants(all) : all
      setGhlPushList(withNotes)
    } catch(e) { setError('GHL prep failed: ' + e.message) }
    setExporting(false)
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:0 }}>

      {/* Topbar */}
      <div className={styles.topbar}>
        <div>
          <h1 className={styles.pageTitle} style={{ display:'flex', alignItems:'center', gap:8 }}>
            <Leaf size={20} color="var(--green)"/> Fresh to Contact
          </h1>
          <p className={styles.pageSubtitle}>
            No Hired · No Disqualified · No appointment ever scheduled
          </p>
        </div>
        <div className={styles.actions}>
          <button className={styles.btnSecondary} onClick={() => setShowApptUpload(true)}>
            <Upload size={14}/> Upload appointments
          </button>
          {hasSupabase && (
            <button className={styles.btnSecondary} onClick={() => loadPage(currentPage)} disabled={loading}>
              <RefreshCw size={14} className={loading ? styles.spin : ''}/> Refresh
            </button>
          )}
          {import.meta.env.VITE_GHL_TOKEN && (
            <button className={styles.btnGHL} onClick={handlePushAll} disabled={!totalCount||exporting}>
              <Zap size={14}/> Push to GHL ({totalCount.toLocaleString()})
            </button>
          )}
          <button className={styles.btnPrimary} onClick={handleExport} disabled={!totalCount||exporting}>
            {exporting
              ? <><RefreshCw size={14} className={styles.spin}/> Working…</>
              : <><Download size={14}/> Export CSV ({totalCount.toLocaleString()})</>
            }
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div style={{ display:'flex', gap:12, padding:'0 0 16px', flexWrap:'wrap' }}>
        <div style={{ background:'var(--green-bg)', borderRadius:'var(--radius-md)', padding:'8px 16px', fontSize:13, color:'var(--green-text)', display:'flex', gap:6, alignItems:'center' }}>
          <Leaf size={14}/> <strong>{(freshStats.freshCount||0).toLocaleString()}</strong> fresh contacts
        </div>
        {freshStats.appointmentCount != null && (
          <div style={{ background:'var(--blue-bg)', borderRadius:'var(--radius-md)', padding:'8px 16px', fontSize:13, color:'var(--blue-text)' }}>
            📅 <strong>{freshStats.appointmentCount.toLocaleString()}</strong> appointments on file
          </div>
        )}
      </div>

      {error && <div className={styles.bannerError}>{error}</div>}

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <Search size={14} className={styles.searchIcon}/>
          <input
            className={styles.search}
            placeholder="Search name, email, phone… then press Enter"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setActiveSearch(searchInput)}
          />
          {searchInput && <button className={styles.searchClear} onClick={() => { setSearchInput(''); setActiveSearch('') }}>✕</button>}
        </div>
        <button className={styles.btnSecondary} onClick={() => setActiveSearch(searchInput)} disabled={loading}>
          <Search size={14}/> Search
        </button>
        <div className={styles.dateRange}>
          <label className={styles.dateLabel}>Start date from</label>
          <input type="date" className={styles.dateInput} value={fromDate} onChange={e => setFromDate(e.target.value)}/>
          <label className={styles.dateLabel}>to</label>
          <input type="date" className={styles.dateInput} value={toDate} onChange={e => setToDate(e.target.value)}/>
          {(fromDate||toDate) && <button className={styles.clearDate} onClick={() => { setFromDate(''); setToDate('') }}>Clear</button>}
        </div>
      </div>

      {/* Content */}
      {loading && (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}><RefreshCw size={22} className={styles.spin}/></div>
          <p className={styles.emptyHint}>Loading fresh contacts…</p>
        </div>
      )}

      {!loading && !applicants.length && (
        <div className={styles.empty}>
          <div className={styles.emptyIcon} style={{ fontSize:28 }}>🌱</div>
          <p className={styles.emptyTitle}>No fresh contacts found</p>
          <p className={styles.emptyHint}>
            Make sure you have:<br/>
            1. Uploaded the applicant file<br/>
            2. Uploaded the appointment file from GHL<br/>
            3. Run the SQL view in Supabase
          </p>
          <button className={styles.btnSecondary} onClick={() => setShowApptUpload(true)}>
            <Upload size={14}/> Upload appointments file
          </button>
        </div>
      )}

      {!loading && applicants.length > 0 && (
        <div className={styles.cards}>
          <div className={styles.resultsRow}>
            <span className={styles.resultCount}>
              Page {currentPage+1} of {totalPages} · {totalCount.toLocaleString()} fresh contacts
              {activeSearch ? ` matching "${activeSearch}"` : ''}
            </span>
          </div>

          {applicants.map((a, i) => (
            <ApplicantCard
              key={a.email||i} applicant={a} index={i}
              onViewDetails={(ap, idx) => { setSelectedApplicant(ap); setSelectedIndex(idx) }}
              onPushGHL={import.meta.env.VITE_GHL_TOKEN ? async (ap) => {
                const withNotes = hasSupabase ? await buildNotesForApplicants([ap]) : [ap]
                setGhlPushList(withNotes)
              } : null}
            />
          ))}

          {totalPages > 1 && (
            <div className={styles.pagination}>
              <button className={styles.pageBtn} onClick={() => loadPage(0)} disabled={currentPage===0||loading}>««</button>
              <button className={styles.pageBtn} onClick={() => loadPage(currentPage-1)} disabled={currentPage===0||loading}><ChevronLeft size={14}/></button>
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                let p = totalPages<=7 ? i : currentPage<4 ? i : currentPage>totalPages-5 ? totalPages-7+i : currentPage-3+i
                return <button key={p} className={`${styles.pageBtn} ${p===currentPage?styles.pageBtnActive:''}`} onClick={() => loadPage(p)} disabled={loading}>{p+1}</button>
              })}
              <button className={styles.pageBtn} onClick={() => loadPage(currentPage+1)} disabled={currentPage>=totalPages-1||loading}><ChevronRight size={14}/></button>
              <button className={styles.pageBtn} onClick={() => loadPage(totalPages-1)} disabled={currentPage>=totalPages-1||loading}>»»</button>
              <span className={styles.pageInfo}>{currentPage*PAGE_SIZE+1}–{Math.min((currentPage+1)*PAGE_SIZE,totalCount)} of {totalCount.toLocaleString()}</span>
            </div>
          )}
        </div>
      )}

      {showApptUpload && (
        <AppointmentUpload
          onClose={() => setShowApptUpload(false)}
          onComplete={(count) => {
            setShowApptUpload(false)
            loadPage(0) // refresh fresh list after upload
          }}
        />
      )}
      {selectedApplicant && <ApplicantModal applicant={selectedApplicant} index={selectedIndex} onClose={() => setSelectedApplicant(null)}/>}
      {ghlPushList && <GHLPushModal applicants={ghlPushList} onClose={() => setGhlPushList(null)} onComplete={() => { setGhlPushList(null); loadPage(currentPage) }}/>}
    </div>
  )
}
