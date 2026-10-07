// HandBase : envoi des notifications (web push) en attente dans hb_notifications (supabase/026_notifications.sql).
// Fonction Supabase « notify », appelée toutes les 2 minutes par pg_cron (en-tête x-hb-secret).
// Regroupe par personne et par sujet (« 3 avis à valider (Tournoi X) »). « Ne pas déranger » : chacun choisit
// son créneau (par défaut 21 h – 8 h, heure de Paris, supabase/027) ; ses notifications attendent la fin du
// créneau (sauf la notification de test). Les téléphones désabonnés sont oubliés.
// Joueurs suivis (supabase/033, kind « suivi ») : rien ne part tant que la saisie continue (dernière nouveauté
// il y a moins de 10 minutes, attente d'une heure au plus), puis un seul résumé par compte : « 5 nouvelles mesures »
// sur un joueur (lien vers sa fiche) ou « 24 nouveautés sur 8 joueurs suivis » (lien vers « Mes suivis »).
//
// Secrets à créer (Edge Functions > Secrets) : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…),
// HB_NOTIFY_SECRET (le même mot de passe que hb_notify_secret dans le coffre de la base).
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

type Row = {
  id: number
  user_id: string
  kind: string
  group_key: string
  title: string
  body: string | null
  plural: string | null
  url: string | null
  created_at: string
}
type Sub = { endpoint: string; user_id: string; p256dh: string; auth: string }

Deno.serve(async (req) => {
  const secret = Deno.env.get('HB_NOTIFY_SECRET')
  if (!secret || req.headers.get('x-hb-secret') !== secret) return new Response('Accès refusé', { status: 403 })

  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const hour = Number(new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hour12: false, timeZone: 'Europe/Paris' }).format(new Date())) % 24

  const cols = 'id, user_id, kind, group_key, title, body, plural, url, created_at'
  // Les suivis à part : ils peuvent attendre en nombre (séance de tests) sans retenir les autres.
  const { data: others, error } = await db.from('hb_notifications').select(cols).is('sent_at', null).neq('kind', 'suivi').order('id').limit(500)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  const { data: follows, error: error2 } = await db.from('hb_notifications').select(cols).is('sent_at', null).eq('kind', 'suivi').order('id').limit(5000)
  if (error2) return Response.json({ error: error2.message }, { status: 500 })
  const rows = [...(others ?? []), ...(follows ?? [])] as Row[]
  if (!rows.length) return Response.json({ sent: 0 })

  const users = [...new Set(rows.map((r) => r.user_id))]
  const { data: subs } = await db.from('hb_push_subs').select('endpoint, user_id, p256dh, auth').in('user_id', users)
  const { data: profiles } = await db.from('hb_profiles').select('user_id, notif').in('user_id', users)
  // Créneau « ne pas déranger » de chacun (de quietFrom à quietTo, qui peut passer minuit).
  const quiet = new Set(
    (profiles ?? [])
      .filter((p) => {
        const n = (p.notif ?? {}) as { quiet?: boolean; quietFrom?: number; quietTo?: number }
        if (n.quiet === false) return false
        const from = n.quietFrom ?? 21
        const to = n.quietTo ?? 8
        return from === to ? false : from < to ? hour >= from && hour < to : hour >= from || hour < to
      })
      .map((p) => p.user_id as string),
  )
  // Profil sans préférences enregistrées : créneau par défaut.
  for (const u of users) if (!(profiles ?? []).some((p) => p.user_id === u) && (hour >= 21 || hour < 8)) quiet.add(u)

  // Joueurs suivis : la saisie est-elle encore en cours pour ce compte ? (dernière il y a moins de 10 min, première il y a moins d'1 h)
  const now = Date.now()
  const span = new Map<string, { first: number; last: number }>()
  for (const r of rows) {
    if (r.kind !== 'suivi') continue
    const t = Date.parse(r.created_at)
    const s = span.get(r.user_id)
    span.set(r.user_id, s ? { first: Math.min(s.first, t), last: Math.max(s.last, t) } : { first: t, last: t })
  }
  const busy = new Set([...span].filter(([, s]) => now - s.last < 10 * 60_000 && now - s.first < 60 * 60_000).map(([u]) => u))

  // Regroupement : une notification par personne et par sujet.
  const groups = new Map<string, Row[]>()
  const done: number[] = []
  for (const r of rows) {
    // Pendant son créneau, rien ne part (sauf le test) : la notification attend.
    if (quiet.has(r.user_id) && r.kind !== 'test') continue
    if (r.kind === 'suivi' && busy.has(r.user_id)) continue
    done.push(r.id)
    const k = `${r.user_id}|${r.group_key}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }

  let sent = 0
  const gone: string[] = []
  for (const list of groups.values()) {
    const last = list[list.length - 1]
    const payload = JSON.stringify({
      ...(last.kind === 'suivi' && list.length > 1
        ? followSummary(list)
        : { title: last.title, body: list.length > 1 && last.plural ? `${list.length} ${last.plural}` : (last.body ?? ''), url: last.url ?? '/' }),
      tag: last.group_key,
    })
    for (const s of (subs ?? []) as Sub[]) {
      if (s.user_id !== last.user_id) continue
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600 })
        sent++
      } catch (e) {
        // Abonnement expiré ou retiré par le téléphone : on l'oublie.
        const status = (e as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) gone.push(s.endpoint)
      }
    }
  }

  // Par paquets : la liste des identifiants part dans l'adresse de la requête.
  const at = new Date().toISOString()
  for (let i = 0; i < done.length; i += 300) await db.from('hb_notifications').update({ sent_at: at }).in('id', done.slice(i, i + 300))
  if (gone.length) await db.from('hb_push_subs').delete().in('endpoint', gone)
  return Response.json({ sent, groups: groups.size, waiting: rows.length - done.length, removed: gone.length })
})

/**
 * Résumé des nouveautés sur les joueurs suivis (supabase/033). Une ligne par mesure ou avis : titre = nom du joueur,
 * lien = sa fiche, texte commençant par « Nouvelle mesure » ou « Nouvel avis ».
 */
function followSummary(list: Row[]) {
  const last = list[list.length - 1]
  const players = new Set(list.map((r) => r.url))
  const m = list.filter((r) => r.body?.startsWith('Nouvelle mesure')).length
  const a = list.length - m
  const what = m && a ? `${list.length} nouveautés` : m > 1 ? `${m} nouvelles mesures` : m ? '1 nouvelle mesure' : a > 1 ? `${a} nouveaux avis` : '1 nouvel avis'
  if (players.size === 1) return { title: last.title, body: what, url: last.url ?? '/suivis' }
  return { title: 'Joueurs suivis', body: `${what} sur ${players.size} joueurs suivis`, url: '/suivis' }
}
