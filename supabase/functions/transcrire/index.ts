// HandBase : fonction Supabase « transcrire » : dictée par Voxtral (Mistral AI), pour la page d'essai
// public/essai-dictee/ (moteur « Voxtral (Mistral, en ligne) »). La clé Mistral reste ici, jamais dans la page.
//
// - Réservée aux administrateurs connectés (jeton de session vérifié, hb_profiles.role = 'admin').
// - GET : vérifie l'accès et renvoie { admin, modele, restant_mois, restant_jour, max_secondes, max_octets }.
// - POST (multipart) : file (son webm / ogg / wav / mp4, 2 Mo au plus), duree (secondes, 60 au plus),
//   context_bias (facultatif, répété : mots du hand, 100 au plus) → { text, model, ms, biais, restant_mois, restant_jour }.
// - Plafonds : TRANSCRIRE_QUOTA_MOIS appels par mois civil (heure de Paris, 2000 par défaut) pour tous,
//   TRANSCRIRE_QUOTA_JOUR appels par jour et par compte (200 par défaut) ; au-delà : erreur « quota_atteint »
//   ou « quota_jour_atteint ». Compteurs : supabase/042_quota_transcription.sql (des nombres seulement).
// - Rien n'est journalisé du son ni du texte : seulement des codes d'erreur.
//
// Secrets (Edge Functions > Secrets) : MISTRAL_API_KEY ; facultatifs : TRANSCRIRE_QUOTA_MOIS, TRANSCRIRE_QUOTA_JOUR,
// MISTRAL_MODELE (voxtral-mini-latest par défaut). SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase.
// Déploiement : voir README.md à côté.
import { createClient } from 'npm:@supabase/supabase-js@2'

const MAX_OCTETS = 2 * 1024 * 1024
const MAX_SECONDES = 60
const MAX_MOTS = 100
const TOUS = '00000000-0000-0000-0000-000000000000'
const ORIGINES = ['https://handbase-demo.github.io', 'https://handbase-app.github.io']
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  const ok = ORIGINES.includes(origin) || LOCAL.test(origin)
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function nombre(nom: string, defaut: number): number {
  const v = Number(Deno.env.get(nom))
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : defaut
}

function periodes() {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', ...o }).format(new Date())
  const jour = f({ year: 'numeric', month: '2-digit', day: '2-digit' }) // AAAA-MM-JJ
  return { mois: jour.slice(0, 7), jour }
}

Deno.serve(async (req) => {
  const h = cors(req)
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: h })
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h })
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'methode' }, 405)

  // Compte connecté et administrateur.
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'non_connecte' }, 401)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: auth, error: authError } = await db.auth.getUser(jwt)
  if (authError || !auth?.user) return json({ error: 'non_connecte' }, 401)
  const userId = auth.user.id
  const { data: profil } = await db.from('hb_profiles').select('role').eq('user_id', userId).maybeSingle()
  if (profil?.role !== 'admin') return json({ error: 'pas_admin' }, 403)

  const maxMois = nombre('TRANSCRIRE_QUOTA_MOIS', 2000)
  const maxJour = nombre('TRANSCRIRE_QUOTA_JOUR', 200)
  const modele = Deno.env.get('MISTRAL_MODELE') || 'voxtral-mini-latest'
  const cle = Deno.env.get('MISTRAL_API_KEY')

  if (req.method === 'GET') {
    const p = periodes()
    const { data: rows, error } = await db
      .from('hb_transcription_quota')
      .select('periode, user_id, n')
      .or(`and(periode.eq.${p.mois},user_id.eq.${TOUS}),and(periode.eq.${p.jour},user_id.eq.${userId})`)
    if (error) return json({ error: 'quota_indisponible' }, 500)
    const n = (per: string, u: string) => rows?.find((r) => r.periode === per && r.user_id === u)?.n ?? 0
    return json({
      admin: true,
      pret: !!cle,
      modele,
      restant_mois: Math.max(maxMois - n(p.mois, TOUS), 0),
      restant_jour: Math.max(maxJour - n(p.jour, userId), 0),
      max_secondes: MAX_SECONDES,
      max_octets: MAX_OCTETS,
    })
  }

  if (!cle) return json({ error: 'cle_absente' }, 503)
  const taille = Number(req.headers.get('content-length') ?? 0)
  if (taille > MAX_OCTETS + 64 * 1024) return json({ error: 'trop_gros' }, 413)

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json({ error: 'requete_illisible' }, 400)
  }
  const file = form.get('file')
  if (!(file instanceof File) || !file.size) return json({ error: 'son_absent' }, 400)
  if (file.size > MAX_OCTETS) return json({ error: 'trop_gros' }, 413)
  const duree = Number(form.get('duree'))
  if (!Number.isFinite(duree) || duree <= 0 || duree > MAX_SECONDES) return json({ error: 'trop_long' }, 413)
  const mots = form
    .getAll('context_bias')
    .map((m) => String(m).trim())
    .filter((m) => m && m.length <= 40 && /^[\p{L}\p{N} '’+\-_]+$/u.test(m))
    .slice(0, MAX_MOTS)
    // Mistral attend des mots ou des expressions reliées par « _ » (« repli_défensif »).
    .map((m) => m.replace(/\s+/g, '_'))

  // Plafonds : compte l'appel avant de le faire (un appel qui échoue chez Mistral compte quand même).
  const { data: quota, error: quotaError } = await db.rpc('hb_transcription_compter', { p_user: userId, p_max_mois: maxMois, p_max_jour: maxJour })
  if (quotaError) return json({ error: 'quota_indisponible' }, 500)
  if (!quota?.ok) return json({ error: quota?.raison ?? 'quota_atteint', restant_mois: quota?.restant_mois ?? 0, restant_jour: quota?.restant_jour ?? 0 }, 429)

  const appel = async (avecBiais: boolean) => {
    const body = new FormData()
    body.append('model', modele)
    body.append('language', 'fr')
    body.append('file', file, file.name || 'son.webm')
    if (avecBiais) for (const m of mots) body.append('context_bias', m)
    return await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cle}` },
      body,
    })
  }

  const t0 = performance.now()
  let biais = mots.length > 0
  let res = await appel(biais)
  // Si Mistral refuse les mots de contexte (format ou langue), nouvel essai sans eux.
  if (biais && (res.status === 400 || res.status === 422)) {
    await res.body?.cancel()
    biais = false
    res = await appel(false)
  }
  const ms = Math.round(performance.now() - t0)
  if (!res.ok) {
    console.error('transcrire : Mistral a répondu', res.status)
    await res.body?.cancel()
    const error = res.status === 429 ? 'mistral_limite' : res.status === 401 ? 'mistral_cle' : 'mistral_erreur'
    return json({ error, status: res.status, restant_mois: quota.restant_mois, restant_jour: quota.restant_jour }, 502)
  }
  const out = (await res.json()) as { text?: string; model?: string }
  return json({
    text: (out.text ?? '').trim(),
    model: out.model ?? modele,
    ms,
    biais,
    restant_mois: quota.restant_mois,
    restant_jour: quota.restant_jour,
  })
})
