// ── GoHighLevel API service — v2 ──────────────────────────────────────────

const GHL_BASE = 'https://services.leadconnectorhq.com'

export function getConfig() {
  return {
    token:      import.meta.env.VITE_GHL_TOKEN      || '',
    locationId: import.meta.env.VITE_GHL_LOCATION_ID || '',
    version:    import.meta.env.VITE_GHL_API_VERSION || '2021-07-28',
  }
}

export function isGHLConfigured() {
  const { token, locationId } = getConfig()
  return !!(token && locationId)
}

function headers() {
  const { token, locationId, version } = getConfig()
  return {
    'Authorization': `Bearer ${token}`,
    'Version':       version,
    'Content-Type':  'application/json',
  }
}

// ── API call wrapper — captures full error details ────────────────────────
async function ghlFetch(method, path, body = null, label = '') {
  const url = `${GHL_BASE}${path}`
  const opts = {
    method,
    headers: headers(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  }

  let res
  try {
    res = await fetch(url, opts)
  } catch(networkErr) {
    throw new GHLError({
      label,
      url,
      status: 0,
      message: `Network error: ${networkErr.message}`,
      hint: 'Check your internet connection or if GHL API is reachable. This may also be a CORS issue — GHL API may block browser requests directly.',
    })
  }

  // Try to parse body regardless of status
  let data
  try { data = await res.json() } catch(_) { data = {} }

  if (!res.ok) {
    throw new GHLError({
      label,
      url,
      status:  res.status,
      message: data?.message || data?.error || `HTTP ${res.status}`,
      raw:     data,
      hint:    getHint(res.status, data),
    })
  }

  return data
}

function getHint(status, data) {
  if (status === 401) return 'Bearer token is invalid or expired. Check VITE_GHL_TOKEN.'
  if (status === 403) return 'Token does not have permission for this action, or Location ID is wrong.'
  if (status === 404) return 'Endpoint not found. Check API version in VITE_GHL_API_VERSION.'
  if (status === 422) return `Validation error: ${JSON.stringify(data?.errors || data)}`
  if (status === 429) return 'Rate limited by GHL. Reduce batch size or increase pause time.'
  if (status >= 500)  return 'GHL server error. Try again later.'
  return ''
}

class GHLError extends Error {
  constructor({ label, url, status, message, raw, hint }) {
    super(message)
    this.label   = label
    this.url     = url
    this.status  = status
    this.raw     = raw
    this.hint    = hint
    this.name    = 'GHLError'
  }
  toString() {
    const parts = [`[${this.status}] ${this.message}`]
    if (this.hint)  parts.push(`Hint: ${this.hint}`)
    if (this.label) parts.push(`Step: ${this.label}`)
    return parts.join(' — ')
  }
}

// ── Test connection ───────────────────────────────────────────────────────
export async function testGHLConnection() {
  const { locationId } = getConfig()
  const steps = []

  // Step 1: fetch location info
  try {
    const data = await ghlFetch('GET', `/locations/${locationId}`, null, 'Fetch location')
    steps.push({ step: 'Fetch location', ok: true, detail: `Location: ${data?.location?.name || data?.name || 'OK'}` })
  } catch(e) {
    steps.push({ step: 'Fetch location', ok: false, detail: e.toString() })
    return { ok: false, steps }
  }

  // Step 2: try contact lookup (harmless GET)
  try {
    await ghlFetch('GET', `/contacts/?locationId=${locationId}&limit=1`, null, 'List contacts')
    steps.push({ step: 'List contacts', ok: true, detail: 'Contact API accessible' })
  } catch(e) {
    steps.push({ step: 'List contacts', ok: false, detail: e.toString() })
    return { ok: false, steps }
  }

  return { ok: true, steps }
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

// ── Push single applicant ─────────────────────────────────────────────────
export async function pushSingleToGHL(applicant) {
  const { locationId } = getConfig()
  const log = []

  try {
    // 1. Lookup
    let existing = null
    try {
      const res = await ghlFetch('GET', `/contacts/?locationId=${locationId}&email=${encodeURIComponent(applicant.email)}`, null, 'Lookup contact')
      existing = res?.contacts?.[0] || null
      log.push(`Lookup: ${existing ? 'found existing ID ' + existing.id : 'not found'}`)
    } catch(e) {
      throw new Error(`Lookup failed — ${e.toString()}`)
    }

    // 2. Create or update
    const payload = buildPayload(applicant, locationId)
    let contactId

    if (existing?.id) {
      try {
        await ghlFetch('PUT', `/contacts/${existing.id}`, payload, 'Update contact')
        contactId = existing.id
        log.push(`Updated contact ${contactId}`)
      } catch(e) {
        throw new Error(`Update failed — ${e.toString()}`)
      }
    } else {
      try {
        const created = await ghlFetch('POST', `/contacts/`, payload, 'Create contact')
        contactId = created?.contact?.id || created?.id
        log.push(`Created contact ${contactId}`)
      } catch(e) {
        throw new Error(`Create failed — ${e.toString()}`)
      }
    }

    if (!contactId) throw new Error('GHL returned no contact ID after create/update')

    // 3. Note
    try {
      await ghlFetch('POST', `/contacts/${contactId}/notes/`, { body: buildNoteBody(applicant), userId: '' }, 'Add note')
      log.push('Note added')
    } catch(e) {
      log.push(`Note failed (non-fatal): ${e.message}`)
      // Don't throw — note failure is non-fatal
    }

    // 4. Tags
    if (applicant.tags) {
      try {
        const newTags = applicant.tags.split(' | ').map(t => t.trim()).filter(Boolean)
        const merged  = [...new Set([...(existing?.tags || []), ...newTags])]
        await ghlFetch('POST', `/contacts/${contactId}/tags/`, { tags: merged }, 'Update tags')
        log.push(`Tags updated: ${merged.join(', ')}`)
      } catch(e) {
        log.push(`Tags failed (non-fatal): ${e.message}`)
      }
    }

    return { email: applicant.email, contactId, success: true, log }

  } catch(e) {
    return { email: applicant.email, success: false, error: e.message, log }
  }
}

// ── Payload ───────────────────────────────────────────────────────────────
function buildPayload(applicant, locationId) {
  return {
    locationId,
    firstName: applicant.firstname || '',
    lastName:  applicant.lastname  || '',
    email:     applicant.email     || '',
    phone:     applicant.phone     || '',
    customFields: [
      { id: 'last_application_date', value: applicant.last_appointment_date || '' },
      { id: 'total_application',     value: String(applicant.applied_count || 0)  },
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
