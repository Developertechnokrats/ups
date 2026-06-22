import { useState, useEffect } from 'react'
import { RefreshCw, Search, CheckCircle, AlertCircle, ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { fetchOrphanedAppointments, fetchOrphanedStats, markAsContacted, hasSupabase, PAGE_SIZE } from '../lib/supabase'
import styles from './Dashboard.module.css'
import oStyles from './OrphanedAppointments.module.css'

export default function OrphanedAppointments() {
  const [appointments, setAppointments] = useState([])
  const [totalCount, setTotalCount]     = useState(0)
  const [stats, setStats]               = useState({})
  const [currentPage, setCurrentPage]   = useState(0)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')
  const [searchInput, setSearchInput]   = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const [marking, setMarking]           = useState({}) // { appointmentId: true }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  async function loadPage(page) {
    setLoading(true); setError('')
    try {
      const [result, s] = await Promise.all([
        fetchOrphanedAppointments({ page, search: activeSearch }),
        fetchOrphanedStats(),
      ])
      setAppointments(result.appointments)
      setTotalCount(result.totalCount)
      setCurrentPage(page)
      setStats(s)
    } catch(e) { setError('Error: ' + e.message) }
    setLoading(false)
  }

  useEffect(() => { if (hasSupabase) loadPage(0) }, [activeSearch])

  async function handleMarkContacted(apt) {
    setMarking(m => ({ ...m, [apt.appointment_id]: true }))
    try {
      await markAsContacted(apt)
      // Remove from list immediately
      setAppointments(prev => prev.filter(a => a.appointment_id !== apt.appointment_id))
      setTotalCount(c => c - 1)
      setStats(s => ({ ...s, orphanedCount: (s.orphanedCount || 1) - 1 }))
    } catch(e) { setError('Failed: ' + e.message) }
    setMarking(m => ({ ...m, [apt.appointment_id]: false }))
  }

  function formatDate(str) {
    if (!str) return '—'
    try {
      return new Date(str).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch { return str }
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:0 }}>

      {/* Topbar */}
      <div className={styles.topbar}>
        <div>
          <h1 className={styles.pageTitle} style={{ display:'flex', alignItems:'center', gap:8 }}>
            <AlertCircle size={20} color="var(--amber)"/> Orphaned Appointments
          </h1>
          <p className={styles.pageSubtitle}>
            Appointments with no matching applicant by email or phone
          </p>
        </div>
        <div className={styles.actions}>
          <button className={styles.btnSecondary} onClick={() => loadPage(currentPage)} disabled={loading}>
            <RefreshCw size={14} className={loading ? styles.spin : ''}/> Refresh
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div style={{ display:'flex', gap:12, padding:'0 0 16px', flexWrap:'wrap' }}>
        <div style={{ background:'var(--amber-bg)', borderRadius:'var(--radius-md)', padding:'8px 16px', fontSize:13, color:'var(--amber-text)', display:'flex', gap:6, alignItems:'center' }}>
          <AlertCircle size={14}/> <strong>{(stats.orphanedCount||0).toLocaleString()}</strong> unmatched appointments
        </div>
      </div>

      {error && <div className={styles.bannerError}>{error}</div>}

      {/* Search */}
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <Search size={14} className={styles.searchIcon}/>
          <input
            className={styles.search}
            placeholder="Search name, email, phone…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setActiveSearch(searchInput)}
          />
          {searchInput && <button className={styles.searchClear} onClick={() => { setSearchInput(''); setActiveSearch('') }}>✕</button>}
        </div>
        <button className={styles.btnSecondary} onClick={() => setActiveSearch(searchInput)} disabled={loading}>
          <Search size={14}/> Search
        </button>
      </div>

      {/* Content */}
      {loading && (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}><RefreshCw size={22} className={styles.spin}/></div>
          <p className={styles.emptyHint}>Loading orphaned appointments…</p>
        </div>
      )}

      {!loading && !appointments.length && (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}><CheckCircle size={28} color="var(--green)"/></div>
          <p className={styles.emptyTitle}>No orphaned appointments</p>
          <p className={styles.emptyHint}>
            All appointments have been matched to applicants<br/>or marked as contacted.
          </p>
        </div>
      )}

      {!loading && appointments.length > 0 && (
        <div className={oStyles.tableWrap}>
          <div className={styles.resultsRow} style={{ padding:'0 0 8px' }}>
            <span className={styles.resultCount}>
              Page {currentPage+1} of {totalPages} · {totalCount.toLocaleString()} orphaned
              {activeSearch ? ` matching "${activeSearch}"` : ''}
            </span>
          </div>

          <table className={oStyles.table}>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Calendar</th>
                <th>Appointment Date</th>
                <th>Outcome</th>
                <th style={{ width: 140 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((apt, i) => (
                <tr key={apt.appointment_id || i} className={i % 2 === 0 ? oStyles.rowEven : oStyles.rowOdd}>
                  <td className={oStyles.name}>{apt.contact_name || '—'}</td>
                  <td className={oStyles.email}>{apt.email}</td>
                  <td className={oStyles.phone}>{apt.phone || '—'}</td>
                  <td className={oStyles.calendar}>{apt.calendar || '—'}</td>
                  <td className={oStyles.date}>
                    <span style={{ display:'flex', alignItems:'center', gap:4 }}>
                      <Calendar size={11} color="var(--text-faint)"/>
                      {formatDate(apt.requested_time)}
                    </span>
                  </td>
                  <td>
                    <span className={`${oStyles.outcome} ${apt.outcome === 'confirmed' ? oStyles.confirmed : apt.outcome === 'cancelled' ? oStyles.cancelled : oStyles.other}`}>
                      {apt.outcome || '—'}
                    </span>
                  </td>
                  <td>
                    <button
                      className={oStyles.markBtn}
                      onClick={() => handleMarkContacted(apt)}
                      disabled={marking[apt.appointment_id]}
                    >
                      {marking[apt.appointment_id]
                        ? <><RefreshCw size={12} className={styles.spin}/> Saving…</>
                        : <><CheckCircle size={12}/> Mark contacted</>
                      }
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
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
    </div>
  )
}
