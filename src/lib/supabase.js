import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

export const APPLICANTS_TABLE = 'applicants'

export async function fetchApplicants({ fromDate, toDate } = {}) {
  let query = supabase.from(APPLICANTS_TABLE).select('*').order('last_appointment_date', { ascending: false })
  if (fromDate) query = query.gte('last_appointment_date', fromDate)
  if (toDate) query = query.lte('last_appointment_date', toDate)
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function upsertApplicants(rows) {
  const { error } = await supabase.from(APPLICANTS_TABLE).upsert(rows, { onConflict: 'email' })
  if (error) throw error
}

export async function deleteAllApplicants() {
  const { error } = await supabase.from(APPLICANTS_TABLE).delete().neq('id', 0)
  if (error) throw error
}
