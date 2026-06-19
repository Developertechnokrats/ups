// ── GoHighLevel API service — v2 ──────────────────────────────────────────
// Base URL: https://services.leadconnectorhq.com  (GHL v2)
// Required headers: Authorization, Version, Location-Id

const GHL_BASE    = 'https://services.leadconnectorhq.com'

function getConfig() {
  return {
    token:      import.meta.env.VITE_GHL_TOKEN,
    locationId: import.meta.env.VITE_GHL_LOCATION_ID,
    version:    import.meta.env.VITE_GHL_API_VERSION || '2021-07-28',
  }
}

function headers() {
  const { token, locationId, version } = getConfig()
  return {
    'Authorization': `Bearer ${token}`,
    'Version':       version,
    'Location-Id':   locationId,
    'Content-Type':  'application/json',
  }
}

export function isGHLConfigured() {
  const { token, locationId } = getConfig()
  return !!(token && locationId)
}

// ── Rate limiter ──────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function batchPushToGHL(applicants, onProgress) {
  const BATCH_SIZE = 10
  const PAUSE_MS   = 1500
  const results    = []

  for (let i = 0; i < applicants.length; i += BATCH_SIZE) {
    const batch = applicants.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(batch.map(a => pushSingleToGHL(a)))
    results.push(...batchResults)
    onProgress?.({
      done:    Math.min(i + BATCH_SIZE, applicants.length),
      total:   applicants.length,
      results: [...results],
    })
    if (i + BATCH_SIZE < applicants.length) await sleep(PAUSE_MS)
  }
  return results
}

// ── Push a single applicant ───────────────────────────────────────────────
export async function pushSingleToGHL(applicant) {
  try {
    const { locationId } = getConfig()

    // 1. Look up by email
    const existing = await lookupContactByEmail(applicant.email, locationId)

    // 2. Create or update
    const payload = buildPayload(applicant, locationId)
    let contactId

    if (existing?.id) {
      await updateContact(existing.id, payload)
      contactId = existing.id
    } else {
      const created = await createContact(payload)
      contactId = created?.contact?.id || created?.id
    }

    if (!contactId) throw new Error('No contact ID returned from GHL')

    // 3. Add note
    if (applicant.notes || applicant.applied_count) {
      await addNote(contactId, buildNoteBody(applicant))
    }

    // 4. Merge tags (never remove existing)
    if (applicant.tags) {
      await updateTags(contactId, existing?.tags || [], applicant.tags)
    }

    return { email: applicant.email, contactId, success: true }
  } catch(e) {
    return { email: applicant.email, success: false, error: e.message }
  }
}

// ── GHL v2 API calls ──────────────────────────────────────────────────────

async function lookupContactByEmail(email, locationId) {
  const res = await fetch(
    `${GHL_BASE}/contacts/?locationId=${locationId}&email=${encodeURIComponent(email)}`,
    { headers: headers() }
  )
  if (!res.ok) return null
  const data = await res.json()
  return data?.contacts?.[0] || null
}

async function createContact(payload) {
  const res = await fetch(`${GHL_BASE}/contacts/`, {
    method:  'POST',
    headers: headers(),
    body:    JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || `GHL create failed (${res.status})`)
  }
  return res.json()
}

async function updateContact(contactId, payload) {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method:  'PUT',
    headers: headers(),
    body:    JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || `GHL update failed (${res.status})`)
  }
  return res.json()
}

async function addNote(contactId, body) {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes/`, {
    method:  'POST',
    headers: headers(),
    body:    JSON.stringify({ body, userId: '' }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || `GHL note failed (${res.status})`)
  }
  return res.json()
}

async function updateTags(contactId, existingTags, newTagsStr) {
  const newTags = newTagsStr.split(' | ').map(t => t.trim()).filter(Boolean)
  const merged  = [...new Set([...(existingTags || []), ...newTags])]
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/tags/`, {
    method:  'POST',
    headers: headers(),
    body:    JSON.stringify({ tags: merged }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || `GHL tags failed (${res.status})`)
  }
  return res.json()
}

// ── Payload builder ───────────────────────────────────────────────────────

function buildPayload(applicant, locationId) {
  return {
    locationId,
    firstName: applicant.firstname || '',
    lastName:  applicant.lastname  || '',
    email:     applicant.email     || '',
    phone:     applicant.phone     || '',
    customFields: [
      {
        id:    'last_application_date',   // replace with your GHL custom field key/id
        value: applicant.last_appointment_date || '',
      },
      {
        id:    'total_application',        // replace with your GHL custom field key/id
        value: String(applicant.applied_count || 0),
      },
    ],
  }
}

function buildNoteBody(applicant) {
  const lines = [
    `Applied Count: ${applicant.applied_count}`,
    `Last Application Date: ${applicant.last_appointment_date || 'N/A'}`,
    `Tags: ${applicant.tags || 'N/A'}`,
    '',
    'Job Applications:',
    ...(applicant.notes || '').split(' | ').map((n, i) => `${i + 1}. ${n}`),
  ]
  return lines.join('\n')
}
