#!/usr/bin/env node
/*
 * Annonce le niveau de charge du serveur à tous les appareils (message « charge » sur le canal commun hb:commun, lu par
 * src/sync.ts et src/charge.ts). HORS BASE : passe par l'API de diffusion de Realtime (POST /realtime/v1/api/broadcast),
 * pas par realtime.send (les messages envoyés depuis la base n'arrivaient pas aux abonnés sur Realtime auto-hébergé,
 * voir supabase/057_synchro_legere.sql). PAS ACTIVÉ SUR LES DÉMOS : à lancer à la main, ou par une tâche sur le serveur.
 *
 *   NEXTAR_URL=https://… NEXTAR_SERVICE_KEY=… node tools/annoncer-charge.mjs sature 600   # saturé pendant 10 min
 *   NEXTAR_URL=https://… NEXTAR_SERVICE_KEY=… node tools/annoncer-charge.mjs calme         # fin de l'annonce
 *   node tools/annoncer-charge.mjs charge 300 --essai                                      # affiche sans rien envoyer
 *
 * Niveaux : calme (retire le plancher), charge, sature ; durée en secondes (300 par défaut, l'appli plafonne à 15 min :
 * une annonce oubliée s'éteint seule ; la répéter, toutes les 1 à 5 min, tant que la charge dure). Effet sur les appareils
 * (src/charge.ts) : regroupement des signaux, « vu » et traces, signe de vie et filet espacés ; JAMAIS les notations.
 * La clé de service (service_role) ne doit jamais quitter le serveur : variable d'environnement seulement, jamais affichée,
 * jamais sur la ligne de commande.
 *
 * Automatiser (proposition, rien n'est posé) : une tâche cron d'une minute SUR LE SERVEUR qui lit un indicateur simple et
 * annonce le niveau quand il change, avec ses propres seuils et un retour lent, par exemple
 *   - connexions actives de la base : select count(*) from pg_stat_activity where state = 'active' and backend_type =
 *     'client backend' (chargé au-delà de ~60 % des connexions de PostgREST, saturé au-delà de ~90 %) ;
 *   - ou les refus d'Envoy : compteur cluster.rest.upstream_rq_pending_overflow (augmente depuis la dernière minute :
 *     saturé) ;
 *   - ou la mémoire de Realtime (docker stats) proche de MEM_REALTIME.
 */

const NIVEAUX = ['calme', 'charge', 'sature']
const args = process.argv.slice(2)
const essai = args.includes('--essai')
const [niveauBrut, ttlBrut] = args.filter((a) => !a.startsWith('--'))
const niveau = (niveauBrut ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
if (!NIVEAUX.includes(niveau)) {
  console.error(`Niveau attendu : ${NIVEAUX.join(', ')} (reçu : ${niveauBrut ?? 'rien'})`)
  process.exit(2)
}
const ttl = ttlBrut === undefined ? 300 : Number(ttlBrut)
if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 3600) {
  console.error('Durée attendue : un nombre de secondes entre 1 et 3600')
  process.exit(2)
}

const message = { topic: 'hb:commun', event: 'charge', payload: { niveau, ttl }, private: true }
const url = (process.env.NEXTAR_URL ?? '').replace(/\/+$/, '')
if (essai) {
  console.log(`Essai : POST ${url || '<NEXTAR_URL>'}/realtime/v1/api/broadcast`)
  console.log(JSON.stringify({ messages: [message] }))
  process.exit(0)
}
const key = process.env.NEXTAR_SERVICE_KEY
if (!url || !key) {
  console.error('NEXTAR_URL et NEXTAR_SERVICE_KEY sont nécessaires (variables d’environnement).')
  process.exit(2)
}
const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [message] }),
})
if (!res.ok) {
  console.error(`Refusé : ${res.status} ${(await res.text()).slice(0, 200)}`)
  process.exit(1)
}
console.log(`Annoncé : ${niveau}${niveau === 'calme' ? '' : ` pendant ${ttl} s`}`)
