// HandBase : envoi des notifications (web push) en attente dans hb_notifications (supabase/026_notifications.sql).
// Fonction Supabase « notify », appelée toutes les 2 minutes par pg_cron (en-tête x-hb-secret).
// Regroupe par personne et par sujet (« 3 avis à valider (Tournoi X) »). « Ne pas déranger » : chacun choisit
// son créneau (par défaut 21 h – 8 h, heure de Paris, supabase/027) ; ses notifications attendent la fin du
// créneau (sauf la notification de test). Les téléphones désabonnés sont oubliés.
//
// Secrets à créer (Edge Functions > Secrets) : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…),
// HB_NOTIFY_SECRET (le même mot de passe que hb_notify_secret dans le coffre de la base).
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

type Row = { id: number; user_id: string; kind: string; group_key: string; title: string; body: string | null; plural: string | null; url: string | null }
type Sub = { endpoint: string; user_id: string; p256dh: string; auth: string }

Deno.serve(async (req) => {
  const secret = Deno.env.get('HB_NOTIFY_SECRET')
  if (!secret || req.headers.get('x-hb-secret') !== secret) return new Response('Accès refusé', { status: 403 })

  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const hour = Number(new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hour12: false, timeZone: 'Europe/Paris' }).format(new Date())) % 24

  const { data: rows, error } = await db
    .from('hb_notifications')
    .select('id, user_id, kind, group_key, title, body, plural, url')
    .is('sent_at', null)
    .order('id')
    .limit(500)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!rows?.length) return Response.json({ sent: 0 })

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

  // Regroupement : une notification par personne et par sujet.
  const groups = new Map<string, Row[]>()
  const done: number[] = []
  for (const r of rows as Row[]) {
    // Pendant son créneau, rien ne part (sauf le test) : la notification attend.
    if (quiet.has(r.user_id) && r.kind !== 'test') continue
    done.push(r.id)
    const k = `${r.user_id}|${r.group_key}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }

  let sent = 0
  const gone: string[] = []
  for (const list of groups.values()) {
    const last = list[list.length - 1]
    const payload = JSON.stringify({
      title: last.title,
      body: list.length > 1 && last.plural ? `${list.length} ${last.plural}` : last.body ?? '',
      url: last.url ?? '/',
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

  if (done.length) await db.from('hb_notifications').update({ sent_at: new Date().toISOString() }).in('id', done)
  if (gone.length) await db.from('hb_push_subs').delete().in('endpoint', gone)
  return Response.json({ sent, groups: groups.size, waiting: rows.length - done.length, removed: gone.length })
})
