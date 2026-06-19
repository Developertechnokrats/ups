// ── GoHighLevel API service — supports v2 and v3 ──────────────────────────

export function getConfig() {
  return {
    token:      import.meta.env.VITE_GHL_TOKEN        || '',
    locationId: import.meta.env.VITE_GHL_LOCATION_ID  || '',
    version:    import.meta.env.VITE_GHL_API_VERSION  || '2021-07-28',
    fieldLastDate:  import.meta.env.VITE_GHL_FIELD_LAST_DATE  || 'last_application_date',
    fieldTotalApps: import.meta.env.VITE_GHL_FIELD_TOTAL_APPS || 'total_application',
  }
}

export function isGHLConfigured() {
  const { token, locationId } = getConfig()
  return !!(token && locationId)
}

// v3 uses a different base URL
function getBase(version) {
  return version === 'v3' || version === '2021-07-28'
    ? 'https://services.leadconnectorhq.com'
    : 'https://services.leadconnectorhq.com'
}

function headers() {
  const { token, version } = getConfig()
  return {
    'Authorization': `Bearer ${token}`,
    'Version':       version,
    'Content-Type':  'application/json',
  }
}

// ── Core fetch wrapper with full error capture ────────────────────────────
async function ghlFetch(method, path, body = null, label = '') {
  const { version } = getConfig()
  const base = getBase(version)
  const url  = `${base}${path}`

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
    const msg = data?.message || data?.error || data?.msg || JSON.stringify(data)
    const hint = getHint(res.status, data)
    throw new Error(`[${res.status}] ${label}: ${msg}${hint ? ` — ${hint}` : ''}`)
  }

  return data
}

function getHint(status, data) {
  if (status === 401) return 'Token invalid or expired — regenerate in GHL Agency → Settings → API Keys'
  if (status === 403) return 'No permission or wrong Location ID'
  if (status === 404) return 'Endpoint not found — check API version'
  if (status === 422) return `Validation: ${JSON.stringify(data?.errors || data?.details || data)}`
  if (status === 429) return 'Rate limited — slow down requests'
  if (status >= 500)  return 'GHL server error'
  return ''
}

// ── Test connection ───────────────────────────────────────────────────────
export async function testGHLConnection() {
  const { locationId } = getConfig()
  const steps = []

  // Step 1: Fetch location
  try {
    const data = await ghlFetch('GET', `/locations/${locationId}`, null, 'Fetch location')
    const name = data?.location?.name || data?.name || 'OK'
    steps.push({ step: 'Fetch location', ok: true, detail: `Location: ${name}` })
  } catch(e) {
    steps.push({ step: 'Fetch location', ok: false, detail: e.message })
    return { ok: false, steps }
  }

  // Step 2: List contacts
  try {
    await ghlFetch('GET', `/contacts/?locationId=${locationId}&limit=1`, null, 'List contacts')
    steps.push({ step: 'List contacts', ok: true, detail: 'Contact API accessible' })
  } catch(e) {
    steps.push({ step: 'List contacts', ok: false, detail: e.message })
    return { ok: false, steps }
  }

  return { ok: true, steps }
}

// ── Test push — single contact with full logging ──────────────────────────
export async function testPushSingle(applicant) {
  const { locationId, fieldLastDate, fieldTotalApps } = getConfig()
  const log = []

  // Step 1: Lookup
  let existing = null
  try {
    const res = await ghlFetch('GET', `/contacts/?locationId=${locationId}&email=${encodeURIComponent(applicant.email)}`, null, 'Lookup')
    existing = res?.contacts?.[0] || null
    log.push({ step: 'Lookup', ok: true, detail: existing ? `Found: ID ${existing.id}` : 'Not found — will create' })
  } catch(e) {
    log.push({ step: 'Lookup', ok: false, detail: e.message })
    return { ok: false, log }
  }

  // Step 2: Build payload and log it
  const payload = buildPayload(applicant, locationId, fieldLastDate, fieldTotalApps)
  log.push({ step: 'Payload', ok: true, detail: JSON.stringify(payload, null, 2) })

  // Step 3: Create or Update
  let contactId
  if (existing?.id) {
    try {
      const res = await ghlFetch('PUT', `/contacts/${existing.id}`, payload, 'Update contact')
      contactId = existing.id
      log.push({ step: 'Update contact', ok: true, detail: `Updated ID: ${contactId}` })
    } catch(e) {
      log.push({ step: 'Update contact', ok: false, detail: e.message })
      return { ok: false, log }
    }
  } else {
    try {
      const res = await ghlFetch('POST', `/contacts/`, payload, 'Create contact')
      contactId = res?.contact?.id || res?.id
      log.push({ step: 'Create contact', ok: true, detail: `Created ID: ${contactId}` })
    } catch(e) {
      log.push({ step: 'Create contact', ok: false, detail: e.message })
      return { ok: false, log }
    }
  }

  // Step 4: Note
  try {
    await ghlFetch('POST', `/contacts/${contactId}/notes/`, { body: buildNoteBody(applicant), userId: '' }, 'Add note')
    log.push({ step: 'Add note', ok: true, detail: 'Note added' })
  } catch(e) {
    log.push({ step: 'Add note', ok: false, detail: e.message + ' (non-fatal)' })
  }

  // Step 5: Tags
  if (applicant.tags) {
    try {
      const newTags = applicant.tags.split(' | ').map(t => t.trim()).filter(Boolean)
      const merged  = [...new Set([...(existing?.tags || []), ...newTags])]
      await ghlFetch('POST', `/contacts/${contactId}/tags/`, { tags: merged }, 'Update tags')
      log.push({ step: 'Tags', ok: true, detail: `Tags: ${merged.join(', ')}` })
    } catch(e) {
      log.push({ step: 'Tags', ok: false, detail: e.message + ' (non-fatal)' })
    }
  }

  return { ok: true, contactId, log }
}

// ── Batch push ────────────────────────────────────────────────────────────
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
  const { locationId, fieldLastDate, fieldTotalApps } = getConfig()
  const log = []
  try {
    // Lookup
    let existing = null
    try {
      const res = await ghlFetch('GET', `/contacts/?locationId=${locationId}&email=${encodeURIComponent(applicant.email)}`, null, 'Lookup')
      existing = res?.contacts?.[0] || null
      log.push(`Lookup: ${existing ? 'found ' + existing.id : 'not found'}`)
    } catch(e) { throw new Error(`Lookup failed: ${e.message}`) }

    // Create or update
    const payload = buildPayload(applicant, locationId, fieldLastDate, fieldTotalApps)
    let contactId
    if (existing?.id) {
      try {
        await ghlFetch('PUT', `/contacts/${existing.id}`, payload, 'Update')
        contactId = existing.id
        log.push(`Updated: ${contactId}`)
      } catch(e) { throw new Error(`Update failed: ${e.message}`) }
    } else {
      try {
        const res = await ghlFetch('POST', `/contacts/`, payload, 'Create')
        contactId = res?.contact?.id || res?.id
        log.push(`Created: ${contactId}`)
      } catch(e) { throw new Error(`Create failed: ${e.message}`) }
    }

    if (!contactId) throw new Error('No contact ID returned')

    // Note (non-fatal)
    try {
      await ghlFetch('POST', `/contacts/${contactId}/notes/`, { body: buildNoteBody(applicant), userId: '' }, 'Note')
      log.push('Note added')
    } catch(e) { log.push(`Note skipped: ${e.message}`) }

    // Tags (non-fatal)
    if (applicant.tags) {
      try {
        const newTags = applicant.tags.split(' | ').map(t => t.trim()).filter(Boolean)
        const merged  = [...new Set([...(existing?.tags || []), ...newTags])]
        await ghlFetch('POST', `/contacts/${contactId}/tags/`, { tags: merged }, 'Tags')
        log.push(`Tags: ${merged.join(', ')}`)
      } catch(e) { log.push(`Tags skipped: ${e.message}`) }
    }

    return { email: applicant.email, contactId, success: true, log }
  } catch(e) {
    return { email: applicant.email, success: false, error: e.message, log }
  }
}

// ── Payload ───────────────────────────────────────────────────────────────
function buildPayload(applicant, locationId, fieldLastDate, fieldTotalApps) {
  return {
    locationId,
    firstName: applicant.firstname || '',
    lastName:  applicant.lastname  || '',
    email:     applicant.email     || '',
    phone:     applicant.phone     || '',
    customFields: [
      { id: fieldLastDate,  value: applicant.last_appointment_date || '' },
      { id: fieldTotalApps, value: String(applicant.applied_count || 0) },
    ],
  }
}

function buildNoteBody(applicant) {
  return [
    `Applied Count: ${applicant.applied_count}`,
    `Last Application Date: ${applicant.last_appointment_date || 'N/A'}`,
    `Tags: ${applicant.tags || 'N/A'}`,
    '',
    'Job Applications:',
    ...(applicant.notes || '').split(' | ').map((n, i) => `${i + 1}. ${n}`),
  ].join('\n')
}
