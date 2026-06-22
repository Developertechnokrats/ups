import { useState, useEffect } from 'react'
import { RefreshCw, Search, CheckCircle, AlertCircle, ChevronLeft, ChevronRight, X, Eye, ArrowUpDown } from 'lucide-react'
import { fetchOrphanedGrouped, fetchOrphanedStats, fetchAppointmentsForEmail, markAllAsContacted, refreshComputedTables, hasSupabase, PAGE_SIZE } from '../lib/supabase'
import styles from './Dashboard.module.css'
import oStyles from './OrphanedAppointments.module.css'

function formatDate(str) {
  if (!str) return '—'
  try { return new Date(str).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) }
  catch { return str }
}

function AppointmentsModal({ contact, onClose }) {
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetchAppointmentsForEmail(contact.email).then(setAppointments).catch(console.error).finally(() => setLoading(false))
  }, [contact.email])
  return (
    <div className={oStyles.modalOverlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={oStyles.modal}>
        <div className={oStyles.modalHeader}>
          <div>
            <div className={oStyles.modalName}>{contact.contact_name || '—'}</div>
            <div className={oStyles.modalEmail}>{contact.email} · {contact.phone || 'no phone'}</div>
          </div>
          <button className={oStyles.modalClose} onClick={onClose}><X size={16}/></button>
        </div>
        {loading && <div className={oStyles.modalLoading}><RefreshCw size={16} className={styles.spin}/> Loading…</div>}
        {!loading && (
          <table className={oStyles.table}>
            <thead><tr><th>Appointment Date</th><th>Calendar</th><th>Outcome</th><th>Source</th><th>Rescheduled</th></tr></thead>
            <tbody>
              {appointments.map((apt, i) => (
                <tr key={apt.appointment_id||i} className={i%2===0?oStyles.rowEven:oStyles.rowOdd}>
                  <td className={oStyles.date}>{formatDate(apt.requested_time)}</td>
                  <td className={oStyles.calendar}>{apt.calendar||'—'}</td>
                  <td><span className={`${oStyles.outcome} ${apt.outcome==='confirmed'?oStyles.confirmed:apt.outcome==='cancelled'?oStyles.cancelled:oStyles.other}`}>{apt.outcome||'—'}</span></td>
                  <td className={oStyles.calendar}>{apt.source||'—'}</td>
                  <td className={oStyles.calendar}>{apt.rescheduled||'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default function OrphanedAppointments() {
  const [contacts, setContacts]         = useState([])
  const [totalCount, setTotalCount]     = useState(0)
  const [stats, setStats]               = useState({})
  const [currentPage, setCurrentPage]   = useState(0)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')
  const [searchInput, setSearchInput]   = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const [sortBy, setSortBy]             = useState('count_desc')
  const [marking, setMarking]           = useState({})
  const [viewContact, setViewContact]   = useState(null)

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  async function loadPage(page, sort = sortBy) {
    setLoading(true); setError('')
    try {
      const [result, s] = await Promise.all([
        fetchOrphanedGrouped({ page, search: activeSearch, sortBy: sort }),
        fetchOrphanedStats(),
      ])
      setContacts(result.contacts)
      setTotalCount(result.totalCount)
      setCurrentPage(page)
      setStats(s)
    } catch(e) { setError('Error: ' + e.message) }
    setLoading(false)
  }

  useEffect(() => { if (hasSupabase) loadPage(0, sortBy) }, [activeSearch, sortBy])

  function handleSortChange(newSort) {
    setSortBy(newSort)
    setCurrentPage(0)
  }

  async function handleMarkContacted(contact) {
    setMarking(m => ({ ...m, [contact.email]: true }))
    try {
      await markAllAsContacted(contact.email, contact.contact_name)
      await refreshComputedTables()
      setContacts(prev => prev.filter(c => c.email !== contact.email))
      setTotalCount(c => c - 1)
      setStats(s => ({ ...s, orphanedCount: Math.max(0, (s.orphanedCount||1) - 1) }))
    } catch(e) { setError('Failed: ' + e.message) }
    setMarking(m => ({ ...m, [contact.email]: false }))
  }

  const SORT_OPTIONS = [
    { value: 'count_desc', label: '↓ Most appointments' },
    { value: 'count_asc',  label: '↑ Fewest appointments' },
    { value: 'date_desc',  label: '↓ Latest date' },
    { value: 'date_asc',   label: '↑ Oldest date' },
  ]

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:0 }}>
      <div className={styles.topbar}>
        <div>
          <h1 className={styles.pageTitle} style={{ display:'flex', alignItems:'center', gap:8 }}>
            <AlertCircle size={20} color="var(--amber)"/> Orphaned Appointments
          </h1>
          <p className={styles.pageSubtitle}>Appointments with no matching applicant by email or phone</p>
        </div>
        <div className={styles.actions}>
          <button className={styles.btnSecondary} onClick={() => loadPage(currentPage)} disabled={loading}>
            <RefreshCw size={14} className={loading?styles.spin:''}/> Refresh
          </button>
        </div>
      </div>

      <div style={{ display:'flex', gap:12, padding:'0 0 16px', flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ background:'var(--amber-bg)', borderRadius:'var(--radius-md)', padding:'8px 16px', fontSize:13, color:'var(--amber-text)', display:'flex', gap:6, alignItems:'center' }}>
          <AlertCircle size={14}/> <strong>{(stats.orphanedCount||0).toLocaleString()}</strong> unmatched appointments · <strong>{totalCount.toLocaleString()}</strong> unique contacts
        </div>
      </div>

      {error && <div className={styles.bannerError}>{error}</div>}

      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <Search size={14} className={styles.searchIcon}/>
          <input className={styles.search} placeholder="Search name, email, phone…"
            value={searchInput} onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key==='Enter' && setActiveSearch(searchInput)}/>
          {searchInput && <button className={styles.searchClear} onClick={() => { setSearchInput(''); setActiveSearch('') }}>✕</button>}
        </div>
        <button className={styles.btnSecondary} onClick={() => setActiveSearch(searchInput)} disabled={loading}>
          <Search size={14}/> Search
        </button>

        {/* Sort control */}
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <ArrowUpDown size={13} color="var(--text-muted)"/>
          <select
            value={sortBy}
            onChange={e => handleSortChange(e.target.value)}
            className={styles.dateInput}
            style={{ paddingRight:24, cursor:'pointer' }}
          >
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {loading && (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}><RefreshCw size={22} className={styles.spin}/></div>
          <p className={styles.emptyHint}>Loading…</p>
        </div>
      )}

      {!loading && !contacts.length && (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}><CheckCircle size={28} color="var(--green)"/></div>
          <p className={styles.emptyTitle}>No orphaned appointments</p>
          <p className={styles.emptyHint}>All appointments matched or marked as contacted.</p>
        </div>
      )}

      {!loading && contacts.length > 0 && (
        <div className={oStyles.tableWrap}>
          <div className={styles.resultsRow} style={{ padding:'0 0 8px' }}>
            <span className={styles.resultCount}>
              Page {currentPage+1} of {totalPages} · {totalCount.toLocaleString()} unique contacts
              {activeSearch ? ` matching "${activeSearch}"` : ''}
            </span>
          </div>

          <table className={oStyles.table}>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Email</th>
                <th>Phone</th>
                <th
                  style={{ cursor:'pointer', userSelect:'none', whiteSpace:'nowrap' }}
                  onClick={() => handleSortChange(sortBy==='count_desc'?'count_asc':'count_desc')}
                >
                  Appointments {sortBy==='count_desc'?'↓':sortBy==='count_asc'?'↑':''}
                </th>
                <th
                  style={{ cursor:'pointer', userSelect:'none', whiteSpace:'nowrap' }}
                  onClick={() => handleSortChange(sortBy==='date_desc'?'date_asc':'date_desc')}
                >
                  Last Date {sortBy==='date_desc'?'↓':sortBy==='date_asc'?'↑':''}
                </th>
                <th style={{ width:220 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c, i) => (
                <tr key={c.email} className={i%2===0?oStyles.rowEven:oStyles.rowOdd}>
                  <td className={oStyles.name}>{c.contact_name||'—'}</td>
                  <td className={oStyles.email}>{c.email}</td>
                  <td className={oStyles.phone}>{c.phone||'—'}</td>
                  <td><span className={oStyles.countBadge}>{c.count} appt{c.count!==1?'s':''}</span></td>
                  <td className={oStyles.date}>{formatDate(c.latest_time)}</td>
                  <td>
                    <div style={{ display:'flex', gap:6 }}>
                      <button className={oStyles.viewBtn} onClick={() => setViewContact(c)}>
                        <Eye size={12}/> View
                      </button>
                      <button className={oStyles.markBtn} onClick={() => handleMarkContacted(c)} disabled={marking[c.email]}>
                        {marking[c.email]
                          ? <><RefreshCw size={12} className={styles.spin}/> Saving…</>
                          : <><CheckCircle size={12}/> Mark contacted</>
                        }
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className={styles.pagination}>
              <button className={styles.pageBtn} onClick={() => loadPage(0)} disabled={currentPage===0||loading}>««</button>
              <button className={styles.pageBtn} onClick={() => loadPage(currentPage-1)} disabled={currentPage===0||loading}><ChevronLeft size={14}/></button>
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                let p = totalPages<=7?i:currentPage<4?i:currentPage>totalPages-5?totalPages-7+i:currentPage-3+i
                return <button key={p} className={`${styles.pageBtn} ${p===currentPage?styles.pageBtnActive:''}`} onClick={() => loadPage(p)} disabled={loading}>{p+1}</button>
              })}
              <button className={styles.pageBtn} onClick={() => loadPage(currentPage+1)} disabled={currentPage>=totalPages-1||loading}><ChevronRight size={14}/></button>
              <button className={styles.pageBtn} onClick={() => loadPage(totalPages-1)} disabled={currentPage>=totalPages-1||loading}>»»</button>
              <span className={styles.pageInfo}>{currentPage*PAGE_SIZE+1}–{Math.min((currentPage+1)*PAGE_SIZE,totalCount)} of {totalCount.toLocaleString()}</span>
            </div>
          )}
        </div>
      )}

      {viewContact && <AppointmentsModal contact={viewContact} onClose={() => setViewContact(null)}/>}
    </div>
  )
}
