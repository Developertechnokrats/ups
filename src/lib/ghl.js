// ── GoHighLevel API — v3 ──────────────────────────────────────────────────
// Base: https://services.leadconnectorhq.com
// Auth: Bearer token + Version header

const GHL_BASE = 'https://services.leadconnectorhq.com'

export function getConfig() {
  return {
    token:          import.meta.env.VITE_GHL_TOKEN               || '',
    locationId:     import.meta.env.VITE_GHL_LOCATION_ID         || '',
    version:        import.meta.env.VITE_GHL_API_VERSION         || 'v3',
    fieldLastDate:  import.meta.env.VITE_GHL_FIELD_LAST_DATE     || 'contact.last_application_date',
    fieldTotalApps: import.meta.env.VITE_GHL_FIELD_TOTAL_APPS    || 'contact.total_application',
  }
}

export function isGHLConfigured() {
  const { token, locationId } = getConfig()
  return !!(token && locationId)
}

function headers() {
  const { token, version } = getConfig()
  return {
    'Authorization': `Bearer ${token}`,
    'Version':       version,
    'Content-Type':  'application/json',
  }
}

// ── Core fetch with full error detail ─────────────────────────────────────
async function ghlFetch(method, path, body = null, label = '') {
  const url = `${GHL_BASE}${path}`
  let res
  try {
    res = await fetch(url, {
      method,
      headers: headers(),
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch(e) {
    throw new Error(`[Network] ${label}: ${e.message}`)
  }

  let data
  try { data = await res.json() } catch(_) { data = {} }

  if (!res.ok) {
    const msg  = data?.message || data?.error || data?.msg || JSON.stringify(data)
    const hint = getHint(res.status, data)
    throw new Error(`[${res.status}] ${label}: ${msg}${hint ? ` — ${hint}` : ''}`)
  }
  return data
}

function getHint(status, data) {
  if (status === 401) return 'Token invalid/expired — regenerate in GHL Agency → Settings → API Keys'
  if (status === 403) return 'No permission or wrong Location ID'
  if (status === 404) return 'Endpoint not found — check API version'
  if (status === 422) return `Validation: ${JSON.stringify(data?.errors || data?.details || data)}`
  if (status === 429) return 'Rate limited'
  if (status >= 500)  return 'GHL server error'
  return ''
}

// ── Test connection ────────────────────────────────────────────────────────
export async function testGHLConnection() {
  const { locationId } = getConfig()
  const steps = []

  try {
    const data = await ghlFetch('GET', `/locations/${locationId}`, null, 'Fetch location')
    steps.push({ step: 'Fetch location', ok: true, detail: `OK — ${data?.location?.name || data?.name || 'connected'}` })
  } catch(e) {
    steps.push({ step: 'Fetch location', ok: false, detail: e.message })
    return { ok: false, steps }
  }

  // Search API test — POST /contacts/search with empty query
  try {
    const data = await ghlFetch('POST', `/contacts/search`, {
      locationId,
      page: 1,
      pageLimit: 1,
      filters: [],
    }, 'Search contacts')
    steps.push({ step: 'Search contacts', ok: true, detail: `OK — ${data?.total ?? '?'} total contacts in location` })
  } catch(e) {
    steps.push({ step: 'Search contacts', ok: false, detail: e.message })
    return { ok: false, steps }
  }

  return { ok: true, steps }
}

// ── STEP 1: Search contact by email → returns contactId or null ───────────
async function searchContactByEmail(email) {
  const { locationId } = getConfig()
  const data = await ghlFetch('POST', `/contacts/search`, {
    locationId,
    page: 1,
    pageLimit: 1,
    filters: [{ field: 'email', operator: 'eq', value: email }],
  }, 'Search by email')
  return data?.contacts?.[0] || null
}

// ── STEP 2: Upsert contact (create or update by email) ────────────────────
async function upsertContact(applicant) {
  const { locationId, fieldLastDate, fieldTotalApps } = getConfig()
  const payload = {
    locationId,
    firstName: applicant.firstname || '',
    lastName:  applicant.lastname  || '',
    email:     applicant.email     || '',
    phone:     applicant.phone     || '',
    customFields: [
      { id: fieldLastDate,  value: applicant.last_appointment_date || '' },
      { id: fieldTotalApps, value: String(applicant.applied_count || 0)  },
    ],
  }
  const data = await ghlFetch('POST', `/contacts/upsert`, payload, 'Upsert contact')
  // v3 upsert returns { contact: { id, ... }, traceId, ... }
  return data?.contact?.id || data?.id || null
}

// ── STEP 3: Add note — format: "Job Title -- DD Mon YYYY" per line ────────
async function addNote(contactId, applicant) {
  const body = buildNoteBody(applicant)
  await ghlFetch('POST', `/contacts/${contactId}/notes/`, { body, userId: '' }, 'Add note')
}

// ── STEP 4: Add tags — POST /contacts/:id/tags (no trailing slash on id) ──
async function updateTags(contactId, existingTags, newTagsStr) {
  const newTags = newTagsStr.split(' | ').map(t => t.trim()).filter(Boolean)
  const merged  = [...new Set([...(existingTags || []), ...newTags])]
  // v3: POST /contacts/:contactId/tags  (NOT PUT, NOT with trailing slash)
  await ghlFetch('POST', `/contacts/${contactId}/tags`, { tags: merged }, 'Add tags')
}

// ── Test push — single contact, full step log ─────────────────────────────
export async function testPushSingle(applicant) {
  const { fieldLastDate, fieldTotalApps } = getConfig()
  const log = []

  // Step 1: Search
  let existing = null
  try {
    existing = await searchContactByEmail(applicant.email)
    log.push({ step: 'Search by email', ok: true, detail: existing ? `Found — ID: ${existing.id}` : 'Not found — will create via upsert' })
  } catch(e) {
    log.push({ step: 'Search by email', ok: false, detail: e.message })
    return { ok: false, log }
  }

  // Show payload
  const { locationId } = getConfig()
  log.push({
    step: 'Upsert payload',
    ok: true,
    detail: JSON.stringify({
      locationId,
      firstName: applicant.firstname,
      lastName:  applicant.lastname,
      email:     applicant.email,
      phone:     applicant.phone,
      customFields: [
        { id: fieldLastDate,  value: applicant.last_appointment_date || '' },
        { id: fieldTotalApps, value: String(applicant.applied_count || 0)  },
      ],
    }, null, 2)
  })

  // Step 2: Upsert
  let contactId
  try {
    contactId = await upsertContact(applicant)
    if (!contactId) throw new Error('No contactId in response')
    log.push({ step: 'Upsert contact', ok: true, detail: `Contact ID: ${contactId}` })
  } catch(e) {
    log.push({ step: 'Upsert contact', ok: false, detail: e.message })
    return { ok: false, log }
  }

  // Step 3: Note
  try {
    await addNote(contactId, applicant)
    log.push({ step: 'Add note', ok: true, detail: 'Note added' })
  } catch(e) {
    log.push({ step: 'Add note', ok: false, detail: e.message + ' (non-fatal)' })
  }

  // Step 4: Tags
  if (applicant.tags) {
    try {
      await updateTags(contactId, existing?.tags || [], applicant.tags)
      log.push({ step: 'Update tags', ok: true, detail: `Tags: ${applicant.tags}` })
    } catch(e) {
      log.push({ step: 'Update tags', ok: false, detail: e.message + ' (non-fatal)' })
    }
  }

  return { ok: true, contactId, log }
}

// ── Batch push ─────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function batchPushToGHL(applicants, onProgress) {
  const BATCH_SIZE = 10
  const PAUSE_MS   = 1500
  const results    = []

  for (let i = 0; i < applicants.length; i += BATCH_SIZE) {
    const batch = applicants.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(batch.map(a => pushSingleToGHL(a)))
    results.push(...batchResults)
    onProgress?.({ done: Math.min(i + BATCH_SIZE, applicants.length), total: applicants.length, results: [...results] })
    if (i + BATCH_SIZE < applicants.length) await sleep(PAUSE_MS)
  }
  return results
}

export async function pushSingleToGHL(applicant) {
  const log = []
  try {
    // 1. Search
    let existing = null
    try {
      existing = await searchContactByEmail(applicant.email)
      log.push(`Search: ${existing ? 'found ' + existing.id : 'not found'}`)
    } catch(e) { throw new Error(`Search failed: ${e.message}`) }

    // 2. Upsert
    let contactId
    try {
      contactId = await upsertContact(applicant)
      if (!contactId) throw new Error('No contactId returned')
      log.push(`Upsert: ${contactId}`)
    } catch(e) { throw new Error(`Upsert failed: ${e.message}`) }

    // 3. Note (non-fatal)
    try {
      await addNote(contactId, applicant)
      log.push('Note: added')
    } catch(e) { log.push(`Note: skipped — ${e.message}`) }

    // 4. Tags (non-fatal)
    if (applicant.tags) {
      try {
        await updateTags(contactId, existing?.tags || [], applicant.tags)
        log.push(`Tags: ${applicant.tags}`)
      } catch(e) { log.push(`Tags: skipped — ${e.message}`) }
    }

    return { email: applicant.email, contactId, success: true, log }
  } catch(e) {
    return { email: applicant.email, success: false, error: e.message, log }
  }
}

function buildNoteBody(applicant) {
  // notes is stored as "Title -- Date | Title -- Date"
  // jobs array may also be available (from on-demand fetch)
  let lines = []

  if (applicant.notes && applicant.notes.trim()) {
    lines = applicant.notes.split(' | ').map(l => l.trim()).filter(Boolean)
  } else if (applicant.jobs && applicant.jobs.length) {
    lines = applicant.jobs.map(j => `${j.title} -- ${j.date || j.application_date || ''}`)
  }

  if (!lines.length) {
    // Fallback so body is never empty
    lines = [`Applied for ${applicant.applied_count || 0} position(s). Last date: ${applicant.last_appointment_date || 'N/A'}`]
  }

  return lines.join('\n')
}
