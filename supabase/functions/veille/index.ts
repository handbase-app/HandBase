// Nextar : notification de LA VEILLE qui prépare l'événement sur le téléphone (supabase/060_push_veille.sql).
// Fonction Supabase « veille », appelée par pg_cron toutes les 5 minutes de 18 h à 22 h (heure de Paris), en-tête x-hb-secret.
//
// À chaque appel :
//  1. hors de la fenêtre d'envoi (VEILLE_DEBUT – VEILLE_FIN, heure de Paris) : rien (sauf { force: true }) ;
//  2. hb_veille_prendre(jour, lot) réserve le lot suivant de personnes concernées par un événement DEMAIN (au plus VEILLE_LOT,
//     l'événement le plus tôt d'abord) : un seul envoi par personne et par jour, même si la tâche est relancée ;
//  3. un message par personne (ses événements regroupés), envoyé en web push signé VAPID à chacun de ses appareils abonnés ;
//     le message est un signal minimal ({ type: "veille", jour, ev: [{ id, nom, h }] } : jamais un joueur, une mesure, un
//     avis) ; en le recevant, le service worker (src/veilleSw.ts) télécharge les données avec la session de la personne ;
//  4. abonnements expirés (404, 410) oubliés ; bilan noté (hb_veille_bilan).
// ÉTALEMENT : 300 personnes par appel, un appel toutes les 5 minutes : pas de ruée à 18 h (chaque téléphone attend en plus
// 0 à 20 s au hasard avant de télécharger).
//
// Secrets (Edge Functions > Secrets) : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…), HB_NOTIFY_SECRET (le
// même mot de passe que hb_notify_secret dans le coffre de la base). Réglages facultatifs : VEILLE_LOT (300), VEILLE_DEBUT
// (18), VEILLE_FIN (22). SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase. Déployer SANS vérification
// JWT (l'en-tête x-hb-secret protège l'appel).
//
// Corps facultatif (essais) : { "jour": "AAAA-MM-JJ" (jour d'envoi ; événements du lendemain), "force": true (hors
// fenêtre), "lot": n }.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  abonnementPerdu,
  dansFenetre,
  DEBUT_DEFAUT,
  enCalme,
  entier,
  FIN_DEFAUT,
  jourValide,
  LOT_DEFAUT,
  paquets,
  parallele,
  parisParts,
  parPersonne,
  TTL_S,
  veillePayload,
  type VeilleRow,
} from './veille.ts'

type Sub = { endpoint: string; user_id: string; p256dh: string; auth: string }

Deno.serve(async (req) => {
  const secret = Deno.env.get('HB_NOTIFY_SECRET')
  if (!secret || req.headers.get('x-hb-secret') !== secret) return new Response('Accès refusé', { status: 403 })

  let body: { jour?: unknown; force?: unknown; lot?: unknown } = {}
  try {
    body = (await req.json()) ?? {}
  } catch {
    /* corps vide */
  }
  const now = parisParts(new Date())
  const debut = entier(Deno.env.get('VEILLE_DEBUT'), DEBUT_DEFAUT, 0, 23)
  const fin = entier(Deno.env.get('VEILLE_FIN'), FIN_DEFAUT, 0, 24)
  if (body.force !== true && !dansFenetre(now.heure, debut, fin)) return Response.json({ envoyes: 0, raison: 'hors fenêtre', heure: now.heure })
  const jour = jourValide(body.jour) ? body.jour : now.jour
  const lot = entier(body.lot, entier(Deno.env.get('VEILLE_LOT'), LOT_DEFAUT, 1, 5000), 1, 5000)

  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const { data, error } = await db.rpc('hb_veille_prendre', { p_jour: jour, p_lot: lot })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  const personnes = parPersonne((data ?? []) as VeilleRow[])
  if (!personnes.size) return Response.json({ jour, personnes: 0, envoyes: 0 })

  // Appareils des personnes du lot (par paquets : la liste part dans l'adresse de la requête).
  const subs: Sub[] = []
  for (const part of paquets([...personnes.keys()], 100)) {
    const { data: s, error: e } = await db.from('hb_push_subs').select('endpoint, user_id, p256dh, auth').in('user_id', part)
    if (e) return Response.json({ error: e.message }, { status: 500 })
    subs.push(...((s ?? []) as Sub[]))
  }

  const ok: string[] = []
  const gone: string[] = []
  const bilan = new Map<string, { a: number; e: number }>()
  const tasks = subs.map((s) => async () => {
    const p = personnes.get(s.user_id)
    if (!p) return
    const b = bilan.get(s.user_id) ?? { a: 0, e: 0 }
    bilan.set(s.user_id, b)
    b.a++
    const payload = JSON.stringify(veillePayload(jour, p.events, { calme: enCalme(p.notif, now.heure) }))
    try {
      // topic : un message « veille » pas encore remis (téléphone éteint) est remplacé par le suivant au lieu de s'empiler.
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
        TTL: TTL_S,
        urgency: 'normal',
        topic: 'veille',
      })
      b.e++
      ok.push(s.endpoint)
    } catch (e) {
      // Abonnement expiré ou retiré par le téléphone : on l'oublie.
      if (abonnementPerdu((e as { statusCode?: number }).statusCode)) gone.push(s.endpoint)
    }
  })
  await parallele(tasks)

  const at = new Date().toISOString()
  for (const part of paquets(ok, 100)) await db.from('hb_push_subs').update({ last_ok_at: at }).in('endpoint', part)
  for (const part of paquets(gone, 100)) await db.from('hb_push_subs').delete().in('endpoint', part)
  await db.rpc('hb_veille_bilan', { p_jour: jour, p_bilan: [...bilan].map(([u, b]) => ({ u, a: b.a, e: b.e })) })
  return Response.json({ jour, personnes: personnes.size, appareils: subs.length, envoyes: ok.length, oublies: gone.length })
})
