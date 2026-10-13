// HandBase : fonction Supabase « transcrire » : dictée par Voxtral (Mistral AI), pour la page d'essai
// public/essai-dictee/ (moteur « Voxtral (Mistral, en ligne) »). La clé Mistral reste ici, jamais dans la page.
//
// - Réservée aux administrateurs connectés (jeton de session vérifié, hb_profiles.role = 'admin').
// - GET : vérifie l'accès et renvoie { admin, modele, restant_mois, restant_jour, max_secondes, max_octets }.
// - POST (multipart) : file (son webm / ogg / wav / mp4, 2 Mo au plus), duree (secondes, 60 au plus),
//   context_bias (facultatif, répété : mots du hand, 100 au plus) → { text, model, ms, biais, restant_mois, restant_jour }.
// - POST ?mode=filtres (JSON) : { phrase, schema, actuels, page? } → { action, filtres, retirer, nonGere, ms, restant_mois, restant_jour } :
//   page (facultatif) : « bilan », « evenements » ou « groupes » → consignes et exemples de cette page (CONSIGNES_PAGES) ;
//   absente ou inconnue : liste Joueurs (CONSIGNES), comme avant ;
//   action = remplacer, ajouter, retirer ou effacer, d'après les filtres actifs (actuels) ; recherche de
//   joueurs en langage naturel (« nés en 2010, plus d'1 m 80 »). Un petit modèle de Mistral (mistral-small-latest,
//   température 0, réponse JSON) traduit la phrase en filtres de la liste Joueurs, d'après le schéma construit par
//   l'appli (src/voiceSearch.ts : clés permises, valeurs possibles). Seuls la phrase, le schéma et les filtres actifs
//   sont envoyés, jamais de données de joueurs ; l'appli revérifie chaque valeur. Même compte, mêmes plafonds (un appel compté par phrase).
// - Plafonds : TRANSCRIRE_QUOTA_MOIS appels par mois civil (heure de Paris, 2000 par défaut) pour tous,
//   TRANSCRIRE_QUOTA_JOUR appels par jour et par compte (200 par défaut) ; au-delà : erreur « quota_atteint »
//   ou « quota_jour_atteint ». Compteurs : supabase/042_quota_transcription.sql (des nombres seulement).
// - Rien n'est journalisé du son ni du texte : seulement des codes d'erreur.
//
// Secrets (Edge Functions > Secrets) : MISTRAL_API_KEY ; facultatifs : TRANSCRIRE_QUOTA_MOIS, TRANSCRIRE_QUOTA_JOUR,
// MISTRAL_MODELE (voxtral-mini-latest par défaut), MISTRAL_MODELE_FILTRES (mistral-small-latest par défaut). SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase.
// Déploiement : voir README.md à côté.
import { createClient } from 'npm:@supabase/supabase-js@2'

// Offre gratuite Mistral : environ 1 requête par seconde. Dictée puis recherche s'enchaînent en moins d'une seconde :
// sur un refus 429, on attend (Retry-After s'il est donné, au plus 5 s) et on réessaie, 3 fois au plus.
async function avecRelance(appel: () => Promise<Response>): Promise<Response> {
  let res = await appel()
  for (const attente of [1200, 2500, 4000]) {
    if (res.status !== 429) break
    const ra = Number(res.headers.get('retry-after'))
    await res.body?.cancel()
    await new Promise((r) => setTimeout(r, ra > 0 ? Math.min(ra * 1000, 5000) : attente))
    res = await appel()
  }
  return res
}

const MAX_OCTETS = 2 * 1024 * 1024
const MAX_SECONDES = 60
const MAX_MOTS = 100
const MAX_PHRASE = 300
const MAX_SCHEMA = 40_000
const MAX_ACTUELS = 2_000
const ACTIONS = ['remplacer', 'ajouter', 'retirer', 'effacer']
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
  const filtres = new URL(req.url).searchParams.get('mode') === 'filtres'

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
      // Modes de POST connus de cette version (l'appli n'affiche la recherche vocale que si « filtres » y est ; celle des
      // Événements et des Groupes, que si leur mode y est : consignes propres à ces pages, champ « page »).
      modes: ['dictee', 'filtres', 'avis', 'filtres_bilan', 'filtres_evenements', 'filtres_groupes'],
    })
  }

  if (!cle) return json({ error: 'cle_absente' }, 503)
  if (filtres) return await rechercheFiltres(req, db, userId, cle, maxMois, maxJour, json)
  if (new URL(req.url).searchParams.get('mode') === 'avis') return await avisVocal(req, db, userId, cle, maxMois, maxJour, json)
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
  let res = await avecRelance(() => appel(biais))
  // Si Mistral refuse les mots de contexte (format ou langue), nouvel essai sans eux.
  if (biais && (res.status === 400 || res.status === 422)) {
    await res.body?.cancel()
    biais = false
    res = await avecRelance(() => appel(false))
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

// ---------- Recherche de joueurs en langage naturel (POST ?mode=filtres) ----------

// Consignes du modèle : courtes, explicites, avec des exemples (petits modèles comme ministral-8b). Les exemples sont relus
// par tools/test-recherche-vocale.ts (chaque réponse d'exemple doit être acceptée par l'appli et donner l'effet attendu).
const CONSIGNES = `Tu transformes la phrase d'un entraîneur de handball en filtres pour sa liste de joueurs.
Réponds seulement par ce JSON : {"action":"…","filtres":{…},"retirer":[…],"nonGere":[…]}

ACTION (une seule)
- "remplacer" : nouvelle recherche complète, sans lien avec les filtres actuels. Ex. « montre-moi les… », « cherche les… », « tous les… », « les gardiens de 2011 ».
- "ajouter" : garde les filtres actuels et ajoute ou change des critères. Ex. « ajoute… », « rajoute… », « en plus », « aussi », « et… », « seulement ceux qui… », « parmi eux », « affine… », « garde… et… ».
- "retirer" : enlève des critères ; mets leurs clés dans "retirer". Ex. « enlève le filtre taille », « sans condition d'année », « peu importe le poste », « retire le Var ».
- "effacer" : enlève tous les filtres. Ex. « efface la sélection », « réinitialise », « tout effacer », « remets à zéro », « montre tout le monde », « recommence ».
- En cas de doute, s'il y a des filtres actuels : "ajouter" si la phrase donne un seul critère avec un mot de liaison (et, aussi, que, qui, seulement), sinon "remplacer".

FILTRES
- Seulement les clés du schéma ; ne jamais inventer de valeur ; n'ajouter aucun critère non demandé.
- Taille : « 1 m 80 », « 1,80 », « 180 » → 180 ; « plus de », « au moins » → tailleMin.
- « nés en 2010 », « 2010 » → annee 2010. « garçons » → sexe M ; « filles », « joueuses » → F ; « joueur(s) » seul ne fixe pas le sexe.
- Nom ou prénom d'une personne (« trouve Lucas Martin », « le joueur Dupont », « les Martin ») → recherche, recopié tel quel. Numéro de licence → recherche, chiffres collés. « enlève le nom » → retirer ["recherche"].
- « gaucher(e) » → gaucher ; « droitier(e) » → droitier. « premier trimestre », « nés en janvier » → trimestre 1.
- Département, région, club : recopie le nom ou le numéro dit (« Var », « 83 », « PACA », « Toulon »).
- « Pôle », « polistes » → pole en_cours ; « avec vidéo » → avecVideo true ; « mes suivis » → suivis true.
- Ce qui ne rentre dans aucune clé va dans "nonGere" en quelques mots (« moins de 1 m 70 », « nés en 2010 ou 2011 », « U15 »).

EXEMPLES
Actuels {} ; « tous les joueurs nés en 2010 qui mesurent plus d'1 m 80 » → {"action":"remplacer","filtres":{"annee":2010,"tailleMin":180},"retirer":[],"nonGere":[]}
Actuels {"sexe":"M"} ; « montre-moi les demi-centres du Pôle » → {"action":"remplacer","filtres":{"poste":"DC","pole":"en_cours"},"retirer":[],"nonGere":[]}
Actuels {"annee":2010,"tailleMin":180} ; « ajoute au filtre que le gamin doit être dans le Var » → {"action":"ajouter","filtres":{"departement":"Var"},"retirer":[],"nonGere":[]}
Actuels {"annee":2010} ; « seulement les gauchères » → {"action":"ajouter","filtres":{"sexe":"F","lateralite":"gaucher"},"retirer":[],"nonGere":[]}
Actuels {"annee":2010,"departement":"83"} ; « et qui ont une vidéo » → {"action":"ajouter","filtres":{"avecVideo":true},"retirer":[],"nonGere":[]}
Actuels {"annee":2010,"tailleMin":180} ; « enlève le filtre taille » → {"action":"retirer","filtres":{},"retirer":["tailleMin"],"nonGere":[]}
Actuels {"departement":"83","poste":"PIV"} ; « peu importe le poste » → {"action":"retirer","filtres":{},"retirer":["poste"],"nonGere":[]}
Actuels {"annee":2010,"poste":"DC"} ; « sans condition d'année mais des pivots » → {"action":"ajouter","filtres":{"poste":"PIV"},"retirer":["annee"],"nonGere":[]}
Actuels {"annee":2010,"departement":"83"} ; « efface la sélection » → {"action":"effacer","filtres":{},"retirer":[],"nonGere":[]}
Actuels {} ; « trouve Lucas Martin » → {"action":"remplacer","filtres":{"recherche":"Lucas Martin"},"retirer":[],"nonGere":[]}
Actuels {} ; « les Martin nés en 2010 » → {"action":"remplacer","filtres":{"recherche":"Martin","annee":2010},"retirer":[],"nonGere":[]}
Actuels {"annee":2010} ; « ajoute Martin » → {"action":"ajouter","filtres":{"recherche":"Martin"},"retirer":[],"nonGere":[]}
Actuels {"annee":2010,"recherche":"(nom)"} ; « enlève le nom » → {"action":"retirer","filtres":{},"retirer":["recherche"],"nonGere":[]}
Actuels {} ; « les filles de 2011 de moins de 1 m 70 en U15 » → {"action":"remplacer","filtres":{"sexe":"F","annee":2011},"retirer":[],"nonGere":["moins de 1 m 70","U15"]}`

// Consignes des autres pages (champ « page » de la requête ; absent : liste Joueurs, CONSIGNES ci-dessus). Même forme de
// réponse, mêmes actions ; exemples propres à chaque page, relus eux aussi par tools/test-recherche-vocale.ts.
const ACTIONS_COMMUNES = `ACTION (une seule)
- "remplacer" : nouvelle recherche complète, sans lien avec les filtres actuels. Ex. « montre-moi les… », « cherche les… », « tous les… ».
- "ajouter" : garde les filtres actuels et ajoute ou change des critères. Ex. « ajoute… », « en plus », « aussi », « et… », « seulement ceux qui… », « parmi eux ».
- "retirer" : enlève des critères ; mets leurs clés dans "retirer". Ex. « enlève… », « sans condition de… », « peu importe… ».
- "effacer" : enlève tous les filtres. Ex. « efface tout », « réinitialise », « remets à zéro », « montre tout ».
- En cas de doute, s'il y a des filtres actuels : "ajouter" si la phrase donne un seul critère avec un mot de liaison (et, aussi, que, qui, seulement), sinon "remplacer".`

const CONSIGNES_PAGES: Record<string, string> = {
  bilan: `Tu transformes la phrase d'un entraîneur de handball en filtres pour son bilan de détection (joueurs vus par génération, par lieu et par club, avec une carte de France).
Réponds seulement par ce JSON : {"action":"…","filtres":{…},"retirer":[…],"nonGere":[…]}

${ACTIONS_COMMUNES}

FILTRES
- Seulement les clés du schéma ; ne jamais inventer de valeur ; n'ajouter aucun critère non demandé.
- « nés en 2010 », « la génération 2010 », « les 2010 » → annee 2010. « garçons » → sexe M ; « filles », « joueuses » → F.
- « cette saison », « la saison » → periode saison ; « depuis toujours », « depuis le début », « sur toutes les saisons » → periode toujours.
- Département, région, club : recopie le nom ou le numéro dit (« Var », « 83 », « PACA », « Toulon »).
- « montre la carte » → vue carte ; « par génération », « les générations » → vue generations.
- Ce qui ne rentre dans aucune clé va dans "nonGere" en quelques mots.

EXEMPLES
Actuels {} ; « les filles de 2011 dans le Var » → {"action":"remplacer","filtres":{"sexe":"F","annee":2011,"departement":"Var"},"retirer":[],"nonGere":[]}
Actuels {"annee":2010} ; « depuis toujours » → {"action":"ajouter","filtres":{"periode":"toujours"},"retirer":[],"nonGere":[]}
Actuels {"annee":2010,"departement":"83"} ; « et le club de Toulon » → {"action":"ajouter","filtres":{"club":"Toulon"},"retirer":[],"nonGere":[]}
Actuels {"region":"Région Sud","annee":2011} ; « peu importe l'année » → {"action":"retirer","filtres":{},"retirer":["annee"],"nonGere":[]}
Actuels {"sexe":"M","departement":"83"} ; « montre la Bretagne par génération » → {"action":"remplacer","filtres":{"region":"Bretagne","vue":"generations"},"retirer":[],"nonGere":[]}
Actuels {"annee":2010,"departement":"83"} ; « efface tout » → {"action":"effacer","filtres":{},"retirer":[],"nonGere":[]}`,

  evenements: `Tu transformes la phrase d'un entraîneur de handball en filtres pour sa liste d'événements (matchs, tournois, entraînements, observations).
Réponds seulement par ce JSON : {"action":"…","filtres":{…},"retirer":[…],"nonGere":[…]}

${ACTIONS_COMMUNES}

FILTRES
- Seulement les clés du schéma ; ne jamais inventer de valeur ; n'ajouter aucun critère non demandé.
- Type : « les matchs » → match ; « les tournois » → tournoi ; « les entraînements », « les stages » → entrainement ; « les observations », « les détections » → observation.
- « en 2025 », « de 2025 » → annee 2025. « mes événements », « ceux que j'ai créés » → mesEvenements true.
- Nom ou lieu d'un événement (« le tournoi de Cannes », « à Toulon », « Intercomités ») → recherche, recopié tel que dit, sans le type s'il est déjà dans "type".
- Ce qui ne rentre dans aucune clé va dans "nonGere" en quelques mots (« la semaine prochaine », « avec plus de 20 joueurs »).

EXEMPLES
Actuels {} ; « les tournois de 2025 » → {"action":"remplacer","filtres":{"type":"tournoi","annee":2025},"retirer":[],"nonGere":[]}
Actuels {"type":"tournoi"} ; « seulement ceux que j'ai créés » → {"action":"ajouter","filtres":{"mesEvenements":true},"retirer":[],"nonGere":[]}
Actuels {} ; « le match à Toulon » → {"action":"remplacer","filtres":{"type":"match","recherche":"Toulon"},"retirer":[],"nonGere":[]}
Actuels {"type":"match","annee":2025} ; « peu importe l'année » → {"action":"retirer","filtres":{},"retirer":["annee"],"nonGere":[]}
Actuels {"type":"match","recherche":"(nom)"} ; « enlève le nom » → {"action":"retirer","filtres":{},"retirer":["recherche"],"nonGere":[]}
Actuels {"annee":2025} ; « réinitialise » → {"action":"effacer","filtres":{},"retirer":[],"nonGere":[]}`,

  groupes: `Tu transformes la phrase d'un entraîneur de handball en filtres pour sa liste de groupes de joueurs (Intercomités, Pôle, sélections…).
Réponds seulement par ce JSON : {"action":"…","filtres":{…},"retirer":[…],"nonGere":[…]}

${ACTIONS_COMMUNES}

FILTRES
- Seulement les clés du schéma ; ne jamais inventer de valeur ; n'ajouter aucun critère non demandé.
- Portée : « fédéraux », « de la Fédération » → federation ; « de ligue », « régionaux » → ligue ; « de comité », « départementaux » → comite.
- « garçons » → sexe M ; « filles » → F ; « mixtes » → mixte. « 2011 », « nés en 2011 » → annee 2011.
- Ligue (région) et comité (département) : recopie le nom ou le numéro dit (« Var », « 83 », « PACA »).
- Nom d'un groupe (« Intercomités », « Pôle Espoirs », « sélection U15 ») → recherche, recopié tel que dit.
- Ce qui ne rentre dans aucune clé va dans "nonGere" en quelques mots.

EXEMPLES
Actuels {} ; « les groupes de filles du Var » → {"action":"remplacer","filtres":{"sexe":"F","departement":"Var"},"retirer":[],"nonGere":[]}
Actuels {"sexe":"F"} ; « et ceux de 2011 » → {"action":"ajouter","filtres":{"annee":2011},"retirer":[],"nonGere":[]}
Actuels {} ; « les Intercomités » → {"action":"remplacer","filtres":{"recherche":"Intercomités"},"retirer":[],"nonGere":[]}
Actuels {} ; « les groupes de ligue en PACA » → {"action":"remplacer","filtres":{"portee":"ligue","region":"PACA"},"retirer":[],"nonGere":[]}
Actuels {"sexe":"M","annee":2011} ; « peu importe le sexe » → {"action":"retirer","filtres":{},"retirer":["sexe"],"nonGere":[]}
Actuels {"departement":"83","annee":2011} ; « efface les filtres » → {"action":"effacer","filtres":{},"retirer":[],"nonGere":[]}`,
}

// deno-lint-ignore no-explicit-any
type Db = any

async function rechercheFiltres(
  req: Request,
  db: Db,
  userId: string,
  cle: string,
  maxMois: number,
  maxJour: number,
  json: (body: unknown, status?: number) => Response,
): Promise<Response> {
  const taille = Number(req.headers.get('content-length') ?? 0)
  if (taille > MAX_SCHEMA + 4096) return json({ error: 'trop_gros' }, 413)
  let entree: { phrase?: unknown; schema?: unknown; actuels?: unknown; page?: unknown }
  try {
    entree = await req.json()
  } catch {
    return json({ error: 'requete_illisible' }, 400)
  }
  const phrase = typeof entree.phrase === 'string' ? entree.phrase.replace(/\s+/g, ' ').trim() : ''
  if (!phrase) return json({ error: 'phrase_absente' }, 400)
  if (phrase.length > MAX_PHRASE) return json({ error: 'phrase_trop_longue' }, 413)
  // Schéma compact : une ligne « clé : valeurs » par filtre (moins de mots pour le modèle).
  const schema =
    entree.schema && typeof entree.schema === 'object' && !Array.isArray(entree.schema)
      ? Object.entries(entree.schema as Record<string, unknown>)
          .map(([k, v]) => `${k} : ${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join('\n')
      : ''
  if (!schema || schema.length > MAX_SCHEMA) return json({ error: 'schema_invalide' }, 400)
  // Filtres actifs (clés du schéma) : pour « ajoute… », « enlève… ».
  const actuels = entree.actuels && typeof entree.actuels === 'object' && !Array.isArray(entree.actuels) ? JSON.stringify(entree.actuels) : '{}'
  if (actuels.length > MAX_ACTUELS) return json({ error: 'schema_invalide' }, 400)
  // Page d'où vient la phrase (bilan, événements, groupes) : ses consignes ; absente ou inconnue : liste Joueurs.
  const consignes = (typeof entree.page === 'string' && Object.hasOwn(CONSIGNES_PAGES, entree.page) && CONSIGNES_PAGES[entree.page]) || CONSIGNES

  // Plafonds : un appel compté par phrase, comme une dictée.
  const { data: quota, error: quotaError } = await db.rpc('hb_transcription_compter', { p_user: userId, p_max_mois: maxMois, p_max_jour: maxJour })
  if (quotaError) return json({ error: 'quota_indisponible' }, 500)
  if (!quota?.ok) return json({ error: quota?.raison ?? 'quota_atteint', restant_mois: quota?.restant_mois ?? 0, restant_jour: quota?.restant_jour ?? 0 }, 429)

  const modele = Deno.env.get('MISTRAL_MODELE_FILTRES') || 'mistral-small-latest'
  const t0 = performance.now()
  const res = await avecRelance(() => fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modele,
      temperature: 0,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${consignes}\n\nSCHÉMA (clé : valeurs)\n${schema}` },
        { role: 'user', content: `Actuels ${actuels} ; « ${phrase} »` },
      ],
    }),
  }))
  const ms = Math.round(performance.now() - t0)
  const restants = { restant_mois: quota.restant_mois, restant_jour: quota.restant_jour }
  if (!res.ok) {
    console.error('transcrire (filtres) : Mistral a répondu', res.status)
    await res.body?.cancel()
    const error = res.status === 429 ? 'mistral_limite' : res.status === 401 ? 'mistral_cle' : 'mistral_erreur'
    return json({ error, status: res.status, ...restants }, 502)
  }
  // La réponse du modèle n'est jamais journalisée (elle reprend la phrase).
  let sortie: { action?: unknown; filtres?: unknown; retirer?: unknown; nonGere?: unknown } = {}
  try {
    const out = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
    const contenu = out.choices?.[0]?.message?.content
    const texte = typeof contenu === 'string' ? contenu : Array.isArray(contenu) ? contenu.map((c) => (c as { text?: string })?.text ?? '').join('') : ''
    sortie = JSON.parse(texte.replace(/^```(?:json)?\s*|\s*```$/g, ''))
  } catch {
    return json({ error: 'reponse_illisible', ...restants }, 502)
  }
  const filtresOk = sortie.filtres && typeof sortie.filtres === 'object' && !Array.isArray(sortie.filtres) ? sortie.filtres : {}
  const nonGere = Array.isArray(sortie.nonGere)
    ? sortie.nonGere.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 80)).slice(0, 10)
    : []
  const action = typeof sortie.action === 'string' && ACTIONS.includes(sortie.action) ? sortie.action : ''
  const retirer = Array.isArray(sortie.retirer) ? sortie.retirer.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 40)).slice(0, 16) : []
  return json({ action, filtres: filtresOk, retirer, nonGere, ms, model: modele, ...restants })
}

// ---------- « Avis vocal » : notes proposées d'après un avis dicté (POST ?mode=avis) ----------
// Entrée (JSON) : { texte, criteres: [{ id, label, description?, echelle: { min, max, libelles? } }] } : seulement les critères
// notés sur une échelle qui s'appliquent au poste du joueur (src/dictation/avis.ts), sous des identifiants courts (c1, c2…) ;
// aucune donnée de joueur, aucun nom. Sortie : { notes: [{ id, valeur, extrait, confiance }], pointsForts, axes, ambigus, ms }.
// Le modèle PROPOSE seulement : l'appli revérifie chaque note (critère connu, valeur dans l'échelle, extrait présent dans le
// texte) et le coach accepte ou écarte chacune avant d'enregistrer. Modèle : MISTRAL_MODELE_AVIS (mistral-small-latest par
// défaut, plus nuancé que ministral-8b), température 0, réponse JSON. Même compte, mêmes plafonds (un appel compté par avis).
// Ni le texte ni la réponse ne sont journalisés.

const MAX_AVIS_TEXTE = 2000
const MAX_AVIS_CRITERES = 60

const CONSIGNES_AVIS = `Tu aides un entraîneur de handball (détection de jeunes) à remplir une fiche d'évaluation d'après ce qu'il a dit d'un joueur.
Tu reçois la liste des critères (id, label, description, echelle min-max, libelles éventuels) puis le texte dicté.
Règles :
1. Note UNIQUEMENT les critères dont l'entraîneur parle explicitement. Un critère dont il ne parle pas n'apparaît pas. Ne devine jamais : dans le doute, ne note pas.
2. "extrait" : copie mot pour mot un court passage du texte qui justifie la note (sans le reformuler).
3. Si un passage peut correspondre à plusieurs critères, ne choisis pas : décris l'hésitation dans "ambigus" en nommant les critères par leur label (ex. "« voit bien le jeu » : Lecture du jeu ou Prise d'information").
4. "valeur" : un entier de l'échelle du critère (respecte les libelles s'il y en a). "excellent", "explose", "remarquable", "très fort" : le maximum ; "bon", "solide", "à l'aise" : au-dessus du milieu ; "correct", "moyen", "niveau attendu" : le milieu ; "doit travailler", "en retard", "un peu juste", "fragile" : sous le milieu. Le minimum seulement si l'entraîneur le dit clairement ("très insuffisant").
5. "confiance" : "forte" si l'intensité est claire, sinon "moyenne".
6. "pointsForts" : reformule brièvement, en termes positifs, les qualités citées. "axes" : ce qu'il faut travailler selon l'entraîneur, de façon constructive, en commençant par "À travailler : ". Rien d'inventé, aucun jugement définitif, aucun nom de personne. Chaîne vide si rien n'est dit.
Réponds UNIQUEMENT par un objet JSON strict : {"notes":[{"id":"...","valeur":0,"extrait":"...","confiance":"forte"}],"pointsForts":"...","axes":"...","ambigus":["..."]}

Exemple 1. Critères : c1 Vitesse (1-5), c2 Tir (1-5), c3 Défense (1-5).
Texte : "Très rapide, il explose sur les contre-attaques. Au tir c'est correct."
Réponse : {"notes":[{"id":"c1","valeur":5,"extrait":"il explose sur les contre-attaques","confiance":"forte"},{"id":"c2","valeur":3,"extrait":"Au tir c'est correct","confiance":"forte"}],"pointsForts":"Très rapide, explosif en contre-attaque.","axes":"","ambigus":[]}
(c3 : pas évoqué, pas noté.)

Exemple 2. Critères : c1 Lecture du jeu (1-5), c2 Prise d'information (1-5), c3 Repli défensif (0-3).
Texte : "Il voit bien le jeu. Par contre il doit travailler ses replis, il est souvent en retard."
Réponse : {"notes":[{"id":"c3","valeur":1,"extrait":"il doit travailler ses replis","confiance":"moyenne"}],"pointsForts":"Bonne vision du jeu.","axes":"À travailler : les replis défensifs.","ambigus":["« Il voit bien le jeu » : Lecture du jeu ou Prise d'information"]}`

async function avisVocal(
  req: Request,
  db: Db,
  userId: string,
  cle: string,
  maxMois: number,
  maxJour: number,
  json: (body: unknown, status?: number) => Response,
): Promise<Response> {
  const taille = Number(req.headers.get('content-length') ?? 0)
  if (taille > 64 * 1024) return json({ error: 'trop_gros' }, 413)
  // deno-lint-ignore no-explicit-any
  let entree: { texte?: unknown; criteres?: any }
  try {
    entree = await req.json()
  } catch {
    return json({ error: 'requete_illisible' }, 400)
  }
  const texte = typeof entree.texte === 'string' ? entree.texte.replace(/\s+/g, ' ').trim() : ''
  if (!texte) return json({ error: 'texte_absent' }, 400)
  if (texte.length > MAX_AVIS_TEXTE) return json({ error: 'texte_trop_long' }, 413)
  // Critères recopiés champ par champ : rien d'autre que ce qui est prévu ne part chez Mistral.
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '')
  const criteres: { id: string; label: string; description?: string; echelle: { min: number; max: number; libelles?: Record<string, string> } }[] = []
  for (const c of Array.isArray(entree.criteres) ? entree.criteres.slice(0, MAX_AVIS_CRITERES) : []) {
    const id = str(c?.id, 12)
    const label = str(c?.label, 100)
    const min = Number(c?.echelle?.min)
    const max = Number(c?.echelle?.max)
    if (!/^c\d{1,3}$/.test(id) || !label || !Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 10 || min >= max) continue
    const libelles: Record<string, string> = {}
    const lib = c?.echelle?.libelles
    if (lib && typeof lib === 'object') for (const [k, v] of Object.entries(lib)) if (/^\d{1,2}$/.test(k) && str(v, 40)) libelles[k] = str(v, 40)
    const description = str(c?.description, 200)
    criteres.push({ id, label, ...(description && { description }), echelle: { min, max, ...(Object.keys(libelles).length ? { libelles } : {}) } })
  }
  if (!criteres.length) return json({ error: 'criteres_invalides' }, 400)

  // Plafonds : un appel compté par avis, comme une dictée.
  const { data: quota, error: quotaError } = await db.rpc('hb_transcription_compter', { p_user: userId, p_max_mois: maxMois, p_max_jour: maxJour })
  if (quotaError) return json({ error: 'quota_indisponible' }, 500)
  if (!quota?.ok) return json({ error: quota?.raison ?? 'quota_atteint', restant_mois: quota?.restant_mois ?? 0, restant_jour: quota?.restant_jour ?? 0 }, 429)

  const modele = Deno.env.get('MISTRAL_MODELE_AVIS') || 'mistral-small-latest'
  const t0 = performance.now()
  const res = await avecRelance(() => fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modele,
      temperature: 0,
      max_tokens: 900,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: CONSIGNES_AVIS },
        { role: 'user', content: `Critères (JSON) :\n${JSON.stringify(criteres)}\n\nTexte dicté :\n"""${texte.replace(/"""/g, '"')}"""` },
      ],
    }),
  }))
  const ms = Math.round(performance.now() - t0)
  const restants = { restant_mois: quota.restant_mois, restant_jour: quota.restant_jour }
  if (!res.ok) {
    console.error('transcrire (avis) : Mistral a répondu', res.status)
    await res.body?.cancel()
    const error = res.status === 429 ? 'mistral_limite' : res.status === 401 ? 'mistral_cle' : 'mistral_erreur'
    return json({ error, status: res.status, ...restants }, 502)
  }
  // La réponse du modèle n'est jamais journalisée (elle reprend le texte).
  let sortie: { notes?: unknown; pointsForts?: unknown; axes?: unknown; ambigus?: unknown } = {}
  try {
    const out = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
    const contenu = out.choices?.[0]?.message?.content
    const brut = typeof contenu === 'string' ? contenu : Array.isArray(contenu) ? contenu.map((c) => (c as { text?: string })?.text ?? '').join('') : ''
    sortie = JSON.parse(brut.replace(/^```(?:json)?\s*|\s*```$/g, ''))
  } catch {
    return json({ error: 'reponse_illisible', ...restants }, 502)
  }
  // Forme seulement (l'appli revérifie chaque note : critère, échelle, extrait).
  const ids = new Set(criteres.map((c) => c.id))
  const notes = (Array.isArray(sortie.notes) ? sortie.notes : [])
    .filter((n) => n && typeof n === 'object' && ids.has(String((n as { id?: unknown }).id)))
    .slice(0, MAX_AVIS_CRITERES)
    .map((n) => {
      const { id, valeur, extrait, confiance } = n as Record<string, unknown>
      return { id, valeur, extrait: str(extrait, 300), confiance: confiance === 'forte' ? 'forte' : 'moyenne' }
    })
  const ambigus = Array.isArray(sortie.ambigus) ? sortie.ambigus.map((a) => str(a, 200)).filter(Boolean).slice(0, 5) : []
  return json({ notes, pointsForts: str(sortie.pointsForts, 500), axes: str(sortie.axes, 500), ambigus, ms, model: modele, ...restants })
}
