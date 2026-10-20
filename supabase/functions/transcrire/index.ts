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
// - POST ?mode=avis (JSON) : notes proposées d'après un avis dicté (voir plus bas).
// - POST ?mode=question (JSON) : { phrase, schema, contexte?, actuels? } → { recette, nonGere, action?, retirer?, ms, model,
//   restant_mois, restant_jour } : contexte « joueurs » (liste Joueurs, filtres = recette) : consignes en plus
//   (CONSIGNES_JOUEURS) et action rendue (ajouter, retirer, effacer) d'après les NOMS des filtres posés (actuels, jamais leurs
//   valeurs) ; contextes « evenements » et « groupes » (listes Événements et Groupes, filtres = recette de la page) :
//   consignes propres (CONSIGNES_EVENEMENTS, CONSIGNES_GROUPES, sans celles des joueurs), même réponse avec action ;
//   sans contexte, comme avant. « Poser une
//   question » au bilan de détection (« les joueuses 2011 vues une seule fois cette saison, par département »). Le modèle
//   (MISTRAL_MODELE_QUESTION, mistral-small-latest par défaut, température 0, JSON) traduit la phrase en RECETTE d'après la
//   description envoyée par l'appli (src/recipe.ts : clés, opérateurs, valeurs permises). Seuls la phrase et cette
//   description partent : aucune donnée de joueur, aucun nom de club, de lieu, de groupe ou d'événement (recopiés tels que
//   dits, retrouvés par l'appli). L'appli revérifie chaque champ et calcule la réponse sur l'appareil. Un appel compté.
// - POST ?mode=sql (JSON) : { phrase, schema, precedent? } → { sql, explication, affichage, nonGere, ms, model, restant_mois,
//   restant_jour } : « mode avancé » de « Poser une question », quand la recette ne sait pas répondre. Le modèle
//   (MISTRAL_MODELE_SQL, codestral-latest par défaut, température 0, JSON) écrit UNE requête SQLite en lecture d'après la
//   DESCRIPTION des tables de la copie locale (src/sqlMirror.ts : colonnes, valeurs possibles ; aucune donnée, aucun nom).
//   L'appli recontrôle la requête et l'exécute seulement dans le navigateur, sur une copie jetable de ses données locales :
//   jamais de SQL sur la base Supabase. `precedent` { sql, erreur } : une seule correction après une erreur SQLite (la
//   requête et le message d'erreur, jamais de données). Un appel compté.
// - POST ?mode=action (JSON) : { phrase, schema, page? } → { plan, ms, model, restant_mois, restant_jour } : « Demander » une
//   ACTION (créer un groupe avec des joueurs, les ajouter à un groupe ou à un événement existant, ouvrir un événement ou un
//   groupe avec un filtre de joueurs, filtrer les groupes ou événements par créateur). Le modèle (MISTRAL_MODELE_ACTION,
//   sinon MISTRAL_MODELE_QUESTION, mistral-small-latest par défaut, température 0, JSON) rend un PLAN : type d'action (liste
//   blanche), noms CITÉS tels que dits (groupe, événement, personne) et recette des joueurs d'après le schéma envoyé (le même
//   que « question » : src/recipe.ts). Seuls la phrase et ce schéma partent : aucune donnée, aucun nom de joueur, de groupe,
//   d'événement ou d'utilisateur. L'appli relit le plan (src/askAction.ts, parsePlan), retrouve les noms sur l'appareil,
//   calcule les joueurs et montre une carte de validation : rien n'est écrit sans « Accepter ». Suppression, retrait,
//   modification, comptes : jamais (« interdite »). Un appel compté.
// - Plafonds : TRANSCRIRE_QUOTA_MOIS appels par mois civil (heure de Paris, 2000 par défaut) pour tous,
//   TRANSCRIRE_QUOTA_JOUR appels par jour et par compte (200 par défaut) ; au-delà : erreur « quota_atteint »
//   ou « quota_jour_atteint ». Compteurs : supabase/042_quota_transcription.sql (des nombres seulement).
// - Rien n'est journalisé du son ni du texte : seulement des codes d'erreur.
//
// Secrets (Edge Functions > Secrets) : MISTRAL_API_KEY ; facultatifs : TRANSCRIRE_QUOTA_MOIS, TRANSCRIRE_QUOTA_JOUR,
// MISTRAL_MODELE (voxtral-mini-latest par défaut), MISTRAL_MODELE_FILTRES, MISTRAL_MODELE_AVIS et MISTRAL_MODELE_QUESTION
// (mistral-small-latest par défaut), MISTRAL_MODELE_ACTION (sinon celui de « question »), MISTRAL_MODELE_SQL (codestral-latest par défaut). SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase.
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
// Essais locaux : localhost, ou le serveur de test ouvert depuis un téléphone du même Wi-Fi (http ou https, adresse 192.168.x.x).
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$/

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
      // « question » : « Poser une question » au bilan de détection (recette calculée par l'appli, POST ?mode=question) ;
      // « sql » : son mode avancé (requête SQLite exécutée par l'appli sur sa copie locale, POST ?mode=sql).
      // « question_joueurs » : « question » comprend aussi le contexte de la liste Joueurs (champ « contexte », action rendue) ;
      // « question_evenements », « question_groupes » : contextes des listes Événements et Groupes (recette de la page).
      // « filtres_evenements », « filtres_groupes » : anciens micros de ces pages, gardés pour les versions précédentes.
      // « action » : « Demander » une action (plan relu par l'appli, carte de validation avant toute écriture, POST ?mode=action).
      modes: ['dictee', 'filtres', 'avis', 'filtres_bilan', 'filtres_evenements', 'filtres_groupes', 'question', 'question_joueurs', 'question_evenements', 'question_groupes', 'sql', 'action'],
    })
  }

  if (!cle) return json({ error: 'cle_absente' }, 503)
  if (filtres) return await rechercheFiltres(req, db, userId, cle, maxMois, maxJour, json)
  if (new URL(req.url).searchParams.get('mode') === 'avis') return await avisVocal(req, db, userId, cle, maxMois, maxJour, json)
  if (new URL(req.url).searchParams.get('mode') === 'question') return await questionRecette(req, db, userId, cle, maxMois, maxJour, json)
  if (new URL(req.url).searchParams.get('mode') === 'sql') return await requeteSql(req, db, userId, cle, maxMois, maxJour, json)
  if (new URL(req.url).searchParams.get('mode') === 'action') return await planAction(req, db, userId, cle, maxMois, maxJour, json)
  // Mode que cette version ne connaît pas : « mode_inconnu » (l'appli relit alors les modes annoncés par le GET).
  const modeDemande = new URL(req.url).searchParams.get('mode')
  if (modeDemande && modeDemande !== 'dictee') return json({ error: 'mode_inconnu' }, 400)
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
- « nés en 2010 », « la génération 2010 », « les 2010 » → annee 2010 ; plusieurs générations (« les 2010 et 2012 ») → annee [2010,2012] ; « de 2010 à 2012 » → annee {"de":2010,"a":2012}. « garçons » → sexe M ; « filles », « joueuses » → F.
- « cette saison », « la saison » → periode saison ; « depuis toujours », « depuis le début », « sur toutes les saisons » → periode toujours.
- Département, région, club : recopie le nom ou le numéro dit (« Var », « 83 », « PACA », « Toulon »).
- « montre la carte » → vue carte ; « par génération », « les générations » → vue generations.
- Ce qui ne rentre dans aucune clé va dans "nonGere" en quelques mots.

EXEMPLES
Actuels {} ; « les filles de 2011 dans le Var » → {"action":"remplacer","filtres":{"sexe":"F","annee":2011,"departement":"Var"},"retirer":[],"nonGere":[]}
Actuels {"sexe":"F"} ; « les 2010 et 2012 » → {"action":"ajouter","filtres":{"annee":[2010,2012]},"retirer":[],"nonGere":[]}
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

// ---------- « Poser une question » au bilan de détection (POST ?mode=question) ----------
// Entrée (JSON) : { phrase, schema } : la phrase (300 caractères au plus) et la description de la recette construite par
// l'appli (src/recipe.ts, buildQuestionSchema : une ligne par clé, opérateurs, valeurs permises, date du jour). Aucune donnée
// de joueur. Sortie : { recette, nonGere, ms, model, restant_mois, restant_jour }. Le modèle rend seulement une RECETTE :
// l'appli revérifie chaque champ (inconnu : ignoré et signalé), retrouve les noms dans ses listes et calcule la réponse sur
// l'appareil (lecture seule). Modèle : MISTRAL_MODELE_QUESTION (mistral-small-latest par défaut), température 0, JSON.
// Les exemples sont relus par tools/test-questions.ts (chaque recette d'exemple est acceptée par l'appli, avec l'effet
// attendu). Ni la phrase ni la réponse ne sont journalisées. Tableau « par staff » : l'appli lit les noms sur l'appareil,
// le modèle n'en voit ni n'en écrit aucun.

const MAX_RECETTE = 8_000

const CONSIGNES_QUESTION = `Tu traduis la question d'un entraîneur de handball (détection de jeunes) en RECETTE JSON pour son bilan de détection. L'appli calcule la réponse elle-même : tu ne vois aucune donnée et tu ne réponds jamais à la question.
Réponds seulement par ce JSON : {"recette":{"population":{…},"vus":{…},"avis":[…],"nbAvis":{…},"mesures":[…],"sortie":{…}},"nonGere":[…]}

RÈGLES
- Seulement les clés et les valeurs du SCHÉMA ; omets ce qui n'est pas demandé ; n'invente aucune valeur.
- Clubs, régions, départements, groupes, événements : recopie le nom dit (« Var », « 83 », « PACA », « Toulon »).
- « nés en 2010 », « les 2010 » → annee 2010 ; « de 2010 à 2012 », « entre 2010 et 2012 », « nés de 2010 à 2012 » → annees {"de":2010,"a":2012} ; plusieurs années citées (« les 2010 et 2012 », « 2010, 2012 et 2014 ») → annees [2010,2012,2014]. « filles », « joueuses » → sexe F ; « garçons » → M ; « joueurs » seul ne fixe pas le sexe.
- Prénom ou nom : « s'appellent Lucas », « les Martin », « prénommées Léa » → noms ["Lucas"] (recopié tel que dit).
- Taille : « 1 m 85 », « 1,85 » → 185 ; « plus de », « au moins » → tailleMin ; « moins de » → tailleMax.
- Vus : « vus », « ont été vus », « déjà vus » sans nombre → op ">=" n 1 ; « vu une fois », « une seule fois » → "=" 1 ; « au moins deux fois » → ">=" 2 ; « jamais vu », « personne n'a vu » → op "aucun". On compte les événements ; « par trois personnes », « trois membres du staff » → compter personnes.
- Période : SEULEMENT si la phrase en dit une, sinon omets periode (l'appli prend la saison en cours et l'affiche). « cette saison » → saison ; « dans l'année », « sur un an », « 12 derniers mois » → 12mois ; « depuis toujours », « jamais » → toujours ; « depuis septembre », « depuis le 1er janvier 2026 » → periode depuis + depuis (mois dit ou date AAAA-MM-JJ).
- Avis : « en défense », « défenseurs » → moyenne de la catégorie Défense ; « note générale » → sur global ; notes sur 5. Un critère nommé (« vitesse », « explosivité ») → sur critere avec son nom.
- Notes une par une : « jamais plus de 3 (en défense) », « jamais au-dessus de 3 », « toutes ses notes à 3 au plus » → avis {"calcul":"max","op":"<=","valeur":3} ; « toujours au moins 4 » → {"calcul":"min","op":">=","valeur":4}. Jamais une moyenne à la place.
- Plusieurs qualités à la fois (« les plus rapides et les plus malins ») → moyenne {"sur":"combine","nom":[noms de critères ou de catégories]} (score combiné).
- Mesures et âge : « taille moyenne », « moyenne de taille / de poids / au sprint » → valeur "moyenne_mesure" et mesure (nom de mesuresPossibles) ; « âge moyen », « moyenne d'âge » → valeur "age_moyen". Avec « par … » : tableau ; sinon : nombre.
- NE REMPLACE JAMAIS une grandeur demandée (taille, âge, poids, une mesure) par une moyenne d'avis ni par autre chose : si elle n'est ni dans mesuresPossibles ni l'âge, mets-la dans "nonGere".
- « les meilleurs », « les mieux notés », « les plus … » → tri moyenne, ordre decroissant, limite 20 (ou le nombre dit) ; « les moins bien notés » → tri moyenne, ordre croissant.
- « progressé », « progression », « évolution entre deux avis » → tri progression, ordre decroissant.
- « prioritaires », « à aller voir en priorité », « qui aller voir » → tri priorite (l'appli applique sa règle et l'explique), limite 20.
- Sortie : « combien », « nombre de » → nombre ; « par club », « par département », « par région », « par génération », « par poste », « par sexe » → tableau + par ; « par événement », « à chaque événement » → tableau par evenement (les joueurs vus à chaque événement) ; « carte » → carte ; sinon liste. « part », « pourcentage de vus » → valeur part_vus.
- « compare A et B » (filles et garçons, postes, générations) → tableau par la dimension comparée (sexe, poste, annee), sans la fixer dans population.
- « quel département / club / région est le plus en retard », « le moins vu », « où aller » → tableau, valeur part_vus, tri part_vus, ordre croissant ; « le plus vu », « le plus en avance » → ordre decroissant.
- « quel coach », « qui du staff », « quel observateur » a vu le plus de joueurs → tableau par staff, tri vus ; « a écrit le plus d'avis » → tri nbAvis. Jamais de nom de personne.
- « les clubs où personne n'a été vu » → vus aucun, tableau par club, garder tous.
- « quel club (département, génération…) a le plus de … » → tableau par cette dimension, tri compte, ordre decroissant (« le moins de » : croissant).
- UN SEUL demandé (« quel club », « le club qui », « quelle région ») → limite 1 ; « les 5 clubs », « les 3 départements » → limite 5, 3 ; « quels clubs », « classement des clubs » → pas de limite. Toujours une recette, jamais rien dans "nonGere" pour cela (l'appli place les clubs sur la carte).
- « licenciés », « inscrits », « joueurs de la base » → tous les joueurs (rien à mettre : chaque joueur de la base est licencié). « en France », « au niveau national », « partout » → aucun lieu (omets regions et departements).
- Ce qui ne rentre dans aucune clé va dans "nonGere" (à côté de "recette", jamais dedans) en quelques mots. Si rien n'est traduisible : "recette":{}.

EXEMPLES
« les joueuses 2011 vues une seule fois cette saison, par département » → {"recette":{"population":{"sexe":"F","annee":2011},"vus":{"compter":"evenements","op":"=","n":1,"periode":"saison"},"sortie":{"type":"tableau","par":"departement"}},"nonGere":[]}
« montre-moi la carte de France des joueurs vus au moins deux fois dans l'année » → {"recette":{"vus":{"compter":"evenements","op":">=","n":2,"periode":"12mois"},"sortie":{"type":"carte"}},"nonGere":[]}
« les meilleurs défenseurs nés en 2010 selon les avis » → {"recette":{"population":{"annee":2010},"sortie":{"type":"liste","tri":"moyenne","moyenne":{"sur":"categorie","nom":"Défense"},"ordre":"decroissant","limite":20}},"nonGere":[]}
« combien de gardiens 2009 mesurent plus de 1m85 » → {"recette":{"population":{"postes":["GB"],"annee":2009,"tailleMin":185},"sortie":{"type":"nombre"}},"nonGere":[]}
« les clubs du Var où on n'a vu personne depuis septembre » → {"recette":{"population":{"departements":["Var"]},"vus":{"op":"aucun","n":0,"periode":"depuis","depuis":"septembre"},"sortie":{"type":"tableau","par":"club","garder":"tous"}},"nonGere":[]}
« les garçons vus par au moins trois personnes du staff depuis toujours » → {"recette":{"population":{"sexe":"M"},"vus":{"compter":"personnes","op":">=","n":3,"periode":"toujours"},"sortie":{"type":"liste","tri":"vus","ordre":"decroissant"}},"nonGere":[]}
« combien de joueurs du Pôle n'ont encore jamais été vus » → {"recette":{"population":{"pole":"en_cours"},"vus":{"op":"aucun","n":0,"periode":"toujours"},"sortie":{"type":"nombre"}},"nonGere":[]}
« les pivots gauchers de la région Sud avec au moins 4 de moyenne en attaque » → {"recette":{"population":{"postes":["PIV"],"lateralite":"gaucher","regions":["Région Sud"]},"avis":[{"sur":"categorie","nom":"Attaque","op":">=","valeur":4}],"sortie":{"type":"liste"}},"nonGere":[]}
« les 2010 et 2011 du groupe Intercomités classés par taille » → {"recette":{"population":{"annees":{"de":2010,"a":2011},"groupes":["Intercomités"]},"sortie":{"type":"liste","tri":"taille","ordre":"decroissant"}},"nonGere":[]}
« la part de joueurs vus cette saison par région » → {"recette":{"sortie":{"type":"tableau","par":"region","valeur":"part_vus","periode":"saison"}},"nonGere":[]}
« les joueurs avec au moins 2 avis et 3,5 de moyenne générale, du moins bien noté au mieux noté » → {"recette":{"nbAvis":{"op":">=","n":2},"avis":[{"sur":"global","op":">=","valeur":3.5}],"sortie":{"type":"liste","tri":"moyenne","ordre":"croissant"}},"nonGere":[]}
« les joueurs du tournoi de Cannes qui sautent plus de 40 au CMJ » → {"recette":{"population":{"evenements":["tournoi de Cannes"]},"mesures":[{"critere":"CMJ – hauteur","op":">=","valeur":40}],"sortie":{"type":"liste","tri":"mesure","ordre":"decroissant"}},"nonGere":[]}
« la carte des joueuses 2012 vues au moins une fois depuis le 1er janvier 2026 » → {"recette":{"population":{"sexe":"F","annee":2012},"vus":{"op":">=","n":1,"periode":"depuis","depuis":"2026-01-01"},"sortie":{"type":"carte"}},"nonGere":[]}
« les gardiennes 2010 et 2012 du Var » → {"recette":{"population":{"sexe":"F","postes":["GB"],"annees":[2010,2012],"departements":["Var"]},"sortie":{"type":"liste"}},"nonGere":[]}
« les 2011 du Var qui jouent en Nationale 2 » → {"recette":{"population":{"annee":2011,"departements":["Var"]},"sortie":{"type":"liste"}},"nonGere":["jouent en Nationale 2"]}
« compare les filles et les garçons nés en 2012 : combien ont été vus ? » → {"recette":{"population":{"annee":2012},"vus":{"op":">=","n":1},"sortie":{"type":"tableau","par":"sexe"}},"nonGere":[]}
« quel coach a vu le plus de joueurs cette saison ? » → {"recette":{"sortie":{"type":"tableau","par":"staff","tri":"vus","ordre":"decroissant","periode":"saison"}},"nonGere":[]}
« qui a écrit le plus d'avis sur les 2011 ? » → {"recette":{"population":{"annee":2011},"sortie":{"type":"tableau","par":"staff","tri":"nbAvis","ordre":"decroissant"}},"nonGere":[]}
« les demi-centres les plus rapides et les plus malins, nés en 2011 » → {"recette":{"population":{"postes":["DC"],"annee":2011},"sortie":{"type":"liste","tri":"moyenne","moyenne":{"sur":"combine","nom":["Vitesse","Intelligence de jeu"]},"ordre":"decroissant","limite":20}},"nonGere":[]}
« quel département est le plus en retard sur les 2013 ? » → {"recette":{"population":{"annee":2013},"sortie":{"type":"tableau","par":"departement","valeur":"part_vus","tri":"part_vus","ordre":"croissant"}},"nonGere":[]}
« la région où les 2011 sont le plus vus » → {"recette":{"population":{"annee":2011},"sortie":{"type":"tableau","par":"region","valeur":"part_vus","tri":"part_vus","ordre":"decroissant"}},"nonGere":[]}
« les joueurs qui ont le plus progressé entre leurs deux derniers avis » → {"recette":{"sortie":{"type":"liste","tri":"progression","ordre":"decroissant","limite":20}},"nonGere":[]}
« si je n'ai qu'un week-end, quels joueurs prioritaires je dois aller voir en Bretagne ? » → {"recette":{"population":{"regions":["Bretagne"]},"sortie":{"type":"liste","tri":"priorite","limite":20}},"nonGere":[]}
« combien de joueurs s'appellent Lucas » → {"recette":{"population":{"noms":["Lucas"]},"sortie":{"type":"nombre"}},"nonGere":[]}
« quel club a le plus de pivots gauchers » → {"recette":{"population":{"postes":["PIV"],"lateralite":"gaucher"},"sortie":{"type":"tableau","par":"club","tri":"compte","ordre":"decroissant","limite":1}},"nonGere":[]}
« quel club en France a le plus de licenciés ? » → {"recette":{"sortie":{"type":"tableau","par":"club","tri":"compte","ordre":"decroissant","limite":1}},"nonGere":[]}
« les 5 clubs du Var avec le plus de joueuses vues cette saison » → {"recette":{"population":{"sexe":"F","departements":["Var"]},"vus":{"op":">=","n":1,"periode":"saison"},"sortie":{"type":"tableau","par":"club","tri":"compte","ordre":"decroissant","limite":5}},"nonGere":[]}
« quels joueurs ont changé de club cette année ? » → {"recette":{},"nonGere":["changé de club"]}
« quelle est la taille moyenne par poste chez les garçons nés en 2010 ? » → {"recette":{"population":{"sexe":"M","annee":2010},"sortie":{"type":"tableau","par":"poste","valeur":"moyenne_mesure","mesure":"Taille"}},"nonGere":[]}
« quelle est la taille moyenne des gardiennes nées en 2011 ? » → {"recette":{"population":{"sexe":"F","annee":2011,"postes":["GB"]},"sortie":{"type":"nombre","valeur":"moyenne_mesure","mesure":"Taille"}},"nonGere":[]}
« quel est l'âge moyen des joueurs vus à chaque événement, et combien de joueurs par événement ? » → {"recette":{"sortie":{"type":"tableau","par":"evenement","valeur":"age_moyen"}},"nonGere":[]}
« les joueurs vus par au moins 3 coachs mais jamais plus de 3 en défense » → {"recette":{"vus":{"compter":"personnes","op":">=","n":3},"avis":[{"sur":"categorie","nom":"Défense","calcul":"max","op":"<=","valeur":3}],"sortie":{"type":"liste"}},"nonGere":[]}
« le nombre moyen de buts marqués par les pivots » → {"recette":{},"nonGere":["buts marqués : pas dans les données"]}`

// Contexte « joueurs » : la phrase est dite sur la liste Joueurs, dont les filtres SONT une recette. Elle AJOUTE à la
// sélection par défaut ; « actuels » : les noms des filtres posés (jamais leurs valeurs, jamais un nom de joueur).
const MAX_ACTUELS_CLES = 40
const CONSIGNES_JOUEURS = `
CONTEXTE : LISTE JOUEURS
La phrase est dite sur la liste Joueurs : la recette FILTRE ou TRIE cette liste, ou CALCULE quelque chose sur les joueurs déjà affichés. "actuels" donne les noms des filtres déjà posés (pas leurs valeurs).
Réponds par : {"action":"…","recette":{…},"retirer":[…],"nonGere":[…]}
- "ajouter" (PAR DÉFAUT) : la phrase ajoute ou change des critères ; les filtres actuels restent. « nés en 2010 », « seulement les filles », « et de plus d'1 m 85 », « parmi eux les gauchers ». Un critère déjà posé prend la nouvelle valeur.
- "retirer" : seulement si la phrase dit d'enlever (« enlève la taille », « peu importe le poste », « sans l'année ») : clés dans "retirer" (noms de "actuels").
- "effacer" : seulement si la phrase dit d'effacer ou de recommencer (« efface tout », « recommence », « efface les filtres et… ») ; la recette donne ce qui suit (« efface tout et montre les gardiens » → effacer + postes GB).
- Calcul sur la sélection (« combien sont-ils ? », « quelle est leur taille moyenne ? », « l'âge moyen », « par club ») : action "ajouter", sortie nombre (avec valeur) ou tableau, sans répéter les filtres actuels.
- Tri (« classe-les par taille », « les mieux notés d'abord ») : sortie liste avec tri.
- Un nom de personne dit (« Lucas », « les Martin ») → population noms.
EXEMPLES (contexte joueurs)
Actuels ["sexe"] ; « nés en 2010 de plus d'1 m 85 » → {"action":"ajouter","recette":{"population":{"annee":2010,"tailleMin":185}},"retirer":[],"nonGere":[]}
Actuels ["sexe","annee"] ; « quelle est la taille moyenne ? » → {"action":"ajouter","recette":{"sortie":{"type":"nombre","valeur":"moyenne_mesure","mesure":"Taille"}},"retirer":[],"nonGere":[]}
Actuels ["annee","taille"] ; « enlève la taille » → {"action":"retirer","recette":{},"retirer":["taille"],"nonGere":[]}
Actuels ["sexe","annee"] ; « seulement les filles » → {"action":"ajouter","recette":{"population":{"sexe":"F"}},"retirer":[],"nonGere":[]}
Actuels ["annee","departements"] ; « efface tout et dis-moi la taille moyenne des joueurs » → {"action":"effacer","recette":{"sortie":{"type":"nombre","valeur":"moyenne_mesure","mesure":"Taille"}},"retirer":[],"nonGere":[]}
Actuels ["annee"] ; « combien sont-ils par club ? » → {"action":"ajouter","recette":{"sortie":{"type":"tableau","par":"club"}},"retirer":[],"nonGere":[]}
Actuels [] ; « les gauchers vus au moins deux fois, classés par taille » → {"action":"ajouter","recette":{"population":{"lateralite":"gaucher"},"vus":{"op":">=","n":2},"sortie":{"type":"liste","tri":"taille","ordre":"decroissant"}},"retirer":[],"nonGere":[]}
Actuels ["postes"] ; « peu importe le poste, mais au Pôle » → {"action":"ajouter","recette":{"population":{"pole":"en_cours"}},"retirer":["postes"],"nonGere":[]}`

// Contextes « evenements » et « groupes » : la phrase est dite sur la liste Événements ou Groupes, dont les filtres SONT une
// recette propre à la page (description envoyée par l'appli : src/eventQuery.ts, src/groupQuery.ts). Même règle que la liste
// Joueurs : la phrase AJOUTE par défaut. Consignes complètes (celles des joueurs ne sont pas envoyées).
const CONSIGNES_LISTE = (quoi: string) => `Tu traduis une phrase en français, dite sur la liste ${quoi} d'une appli de détection de handball, en RECETTE JSON d'après le SCHÉMA (clés, valeurs permises). Réponds UNIQUEMENT par un objet JSON :
{"action":"…","recette":{…},"retirer":[…],"nonGere":[…]}
RÈGLES
- Seulement les clés du SCHÉMA ; une clé non dite est omise. Noms de lieux, de personnes, de groupes ou d'événements : recopiés TELS QUE DITS (l'appli les retrouve).
- "actuels" donne les noms des filtres déjà posés (pas leurs valeurs).
- "ajouter" (PAR DÉFAUT) : la phrase ajoute ou change des critères ; les filtres actuels restent ; un critère déjà posé prend la nouvelle valeur.
- "retirer" : seulement si la phrase dit d'enlever (« enlève le type », « peu importe la date ») : clés dans "retirer" (noms de "actuels").
- "effacer" : seulement si la phrase dit d'effacer ou de recommencer (« efface tout et… », « recommence ») ; la recette donne ce qui suit.
- Calcul sur la sélection (« combien ? », « combien par mois ? ») : action "ajouter", sortie nombre ou tableau, sans répéter les filtres actuels.
- Tri (« les plus récents d'abord », « classés par nombre de joueurs ») : sortie liste avec tri et ordre.
- Ce qui ne rentre dans aucune clé : une courte explication dans "nonGere" (ne l'invente pas en filtre).`

const CONSIGNES_EVENEMENTS = `${CONSIGNES_LISTE('Événements (matchs, tournois, entraînements, observations)')}
- Dates : periode relative (a_venir, passes, ce_mois, cette_saison, saison_derniere) ou {"annee"}, {"mois":"AAAA-MM"}, {"du","au"} d'après "aujourdhui". La saison va du 1er septembre au 31 août.
- « mes événements », « les miens » : mes = les_miens ; « ceux que j'ai créés » : crees ; « où je participe » : participant.
- Génération des joueurs : « la génération 2011 » → generation 2011 ; « les 2010 et 2012 » → generation [2010,2012] ; « de 2010 à 2012 » → generation {"de":2010,"a":2012}.
EXEMPLES (contexte evenements)
Actuels [] ; « les tournois de cette saison » → {"action":"ajouter","recette":{"types":["tournoi"],"periode":"cette_saison"},"retirer":[],"nonGere":[]}
Actuels ["types"] ; « à venir dans le Var » → {"action":"ajouter","recette":{"periode":"a_venir","departements":["Var"]},"retirer":[],"nonGere":[]}
Actuels ["types","periode"] ; « combien par mois ? » → {"action":"ajouter","recette":{"sortie":{"type":"tableau","par":"mois"}},"retirer":[],"nonGere":[]}
Actuels ["periode"] ; « seulement les miens avec une feuille de match » → {"action":"ajouter","recette":{"mes":"les_miens","feuilleDeMatch":true},"retirer":[],"nonGere":[]}
Actuels ["types","lieux"] ; « enlève le lieu » → {"action":"retirer","recette":{},"retirer":["lieux"],"nonGere":[]}
Actuels ["types"] ; « efface tout et montre les matchs entre mars et mai 2025 » → {"action":"effacer","recette":{"types":["match"],"periode":{"du":"2025-03-01","au":"2025-05-31"}},"retirer":[],"nonGere":[]}
Actuels [] ; « ceux avec au moins 20 joueurs et des joueurs à revoir, les plus récents d'abord » → {"action":"ajouter","recette":{"joueurs":{"op":">=","n":20},"aRevoir":true,"sortie":{"type":"liste","tri":"date","ordre":"decroissant"}},"retirer":[],"nonGere":[]}
Actuels ["periode"] ; « les observations de la génération 2011 créées par Paul » → {"action":"ajouter","recette":{"types":["observation"],"generation":2011,"createurs":["Paul"]},"retirer":[],"nonGere":[]}`

const CONSIGNES_GROUPES = `${CONSIGNES_LISTE('Groupes (listes de joueurs : Intercomités, Pôle, sélections…)')}
- Visibilité : prive (moi seul), mon_staff, tout_le_staff. Niveau : federation, ligue, comite. Une ligue est une région, un comité un département.
- « mes groupes » : mes = les_miens ; « ceux que j'ai créés » : crees ; « où je participe » : participant ; « que je suis » : suivis.
EXEMPLES (contexte groupes)
Actuels [] ; « les groupes de filles du Var » → {"action":"ajouter","recette":{"sexe":"F","comites":["Var"]},"retirer":[],"nonGere":[]}
Actuels ["sexe"] ; « ceux de 2011 » → {"action":"ajouter","recette":{"annees":[2011]},"retirer":[],"nonGere":[]}
Actuels ["sexe","annees"] ; « combien par comité ? » → {"action":"ajouter","recette":{"sortie":{"type":"tableau","par":"comite"}},"retirer":[],"nonGere":[]}
Actuels ["comites"] ; « peu importe le comité, seulement les groupes privés » → {"action":"ajouter","recette":{"visibilite":["prive"]},"retirer":["comites"],"nonGere":[]}
Actuels ["sexe","comites"] ; « enlève le sexe » → {"action":"retirer","recette":{},"retirer":["sexe"],"nonGere":[]}
Actuels ["annees"] ; « efface tout et montre les groupes que je suis » → {"action":"effacer","recette":{"suivis":true},"retirer":[],"nonGere":[]}
Actuels [] ; « mes groupes de plus de 15 joueurs, classés par nombre de joueurs » → {"action":"ajouter","recette":{"mes":"les_miens","joueurs":{"op":">","n":15},"sortie":{"type":"liste","tri":"joueurs","ordre":"decroissant"}},"retirer":[],"nonGere":[]}
Actuels [] ; « les groupes de ligue créés par Paul en Bretagne » → {"action":"ajouter","recette":{"niveau":"ligue","createurs":["Paul"],"ligues":["Bretagne"]},"retirer":[],"nonGere":[]}`

/** Consignes de chaque contexte de liste (« joueurs » : en plus des consignes de la recette des joueurs). */
const CONTEXTES: Record<string, string> = { joueurs: CONSIGNES_JOUEURS, evenements: CONSIGNES_EVENEMENTS, groupes: CONSIGNES_GROUPES }

async function questionRecette(
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
  let entree: { phrase?: unknown; schema?: unknown; contexte?: unknown; actuels?: unknown }
  try {
    entree = await req.json()
  } catch {
    return json({ error: 'requete_illisible' }, 400)
  }
  const phrase = typeof entree.phrase === 'string' ? entree.phrase.replace(/\s+/g, ' ').trim() : ''
  if (!phrase) return json({ error: 'phrase_absente' }, 400)
  if (phrase.length > MAX_PHRASE) return json({ error: 'phrase_trop_longue' }, 413)
  // Listes Joueurs, Événements, Groupes : noms des filtres posés seulement (mots courts), jamais leurs valeurs.
  // Contexte inconnu (version future de l'appli) : comme sans contexte.
  const contexte = typeof entree.contexte === 'string' && Object.hasOwn(CONTEXTES, entree.contexte) ? entree.contexte : ''
  const joueurs = contexte === 'joueurs'
  const actuels = contexte && Array.isArray(entree.actuels)
    ? entree.actuels.filter((k): k is string => typeof k === 'string' && /^[A-Za-z]{1,30}$/.test(k)).slice(0, MAX_ACTUELS_CLES)
    : []
  // Description de la recette : une ligne « clé : valeurs » par clé (textes seulement), rien d'autre.
  const schema =
    entree.schema && typeof entree.schema === 'object' && !Array.isArray(entree.schema)
      ? Object.entries(entree.schema as Record<string, unknown>)
          .filter(([, v]) => typeof v === 'string')
          .map(([k, v]) => `${k.slice(0, 40)} : ${v}`)
          .join('\n')
      : ''
  if (!schema || schema.length > MAX_SCHEMA) return json({ error: 'schema_invalide' }, 400)

  // Plafonds : un appel compté par question, comme une dictée.
  const { data: quota, error: quotaError } = await db.rpc('hb_transcription_compter', { p_user: userId, p_max_mois: maxMois, p_max_jour: maxJour })
  if (quotaError) return json({ error: 'quota_indisponible' }, 500)
  if (!quota?.ok) return json({ error: quota?.raison ?? 'quota_atteint', restant_mois: quota?.restant_mois ?? 0, restant_jour: quota?.restant_jour ?? 0 }, 429)

  const modele = Deno.env.get('MISTRAL_MODELE_QUESTION') || 'mistral-small-latest'
  const t0 = performance.now()
  const res = await avecRelance(() => fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modele,
      temperature: 0,
      max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `${contexte && !joueurs ? CONTEXTES[contexte] : `${CONSIGNES_QUESTION}${joueurs ? `\n${CONSIGNES_JOUEURS}` : ''}`}\n\nSCHÉMA (clé : valeurs)\n${schema}`,
        },
        { role: 'user', content: contexte ? `Actuels ${JSON.stringify(actuels)} ; « ${phrase} »` : `« ${phrase} »` },
      ],
    }),
  }))
  const ms = Math.round(performance.now() - t0)
  const restants = { restant_mois: quota.restant_mois, restant_jour: quota.restant_jour }
  if (!res.ok) {
    console.error('transcrire (question) : Mistral a répondu', res.status)
    await res.body?.cancel()
    const error = res.status === 429 ? 'mistral_limite' : res.status === 401 ? 'mistral_cle' : 'mistral_erreur'
    return json({ error, status: res.status, ...restants }, 502)
  }
  // La réponse du modèle n'est jamais journalisée (elle reprend la phrase).
  let sortie: Record<string, unknown> = {}
  try {
    const out = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
    const contenu = out.choices?.[0]?.message?.content
    const texte = typeof contenu === 'string' ? contenu : Array.isArray(contenu) ? contenu.map((c) => (c as { text?: string })?.text ?? '').join('') : ''
    sortie = JSON.parse(texte.replace(/^```(?:json)?\s*|\s*```$/g, ''))
  } catch {
    return json({ error: 'reponse_illisible', ...restants }, 502)
  }
  // Forme seulement : un objet de taille raisonnable (l'appli revérifie chaque champ). Recette rendue sans enveloppe : acceptée.
  const objet = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  if (!objet(sortie)) return json({ error: 'reponse_illisible', ...restants }, 502)
  // « nonGere » : à côté de la recette ; s'il est dedans (petits modèles), il en est sorti ; un texte seul est accepté.
  const brute = objet(sortie.recette) ? sortie.recette : sortie
  const recette = Object.fromEntries(Object.entries(brute).filter(([k]) => k !== 'nonGere' && k !== 'action' && k !== 'retirer'))
  if (JSON.stringify(recette).length > MAX_RECETTE) return json({ error: 'reponse_illisible', ...restants }, 502)
  const liste = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])
  const nonGere = [...liste(sortie.nonGere), ...(brute !== sortie ? liste(brute.nonGere) : [])]
    .filter((x): x is string => typeof x === 'string' && !!x.trim())
    .map((x) => x.trim().slice(0, 80))
    .slice(0, 10)
  if (!contexte) return json({ recette, nonGere, ms, model: modele, ...restants })
  // Listes (Joueurs, Événements, Groupes) : action (ajouter par défaut) et noms des filtres à retirer.
  const action = ['ajouter', 'retirer', 'effacer', 'remplacer'].includes(sortie.action as string) ? sortie.action : 'ajouter'
  const retirer = liste(sortie.retirer).filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 30)).slice(0, 16)
  return json({ recette, nonGere, action, retirer, ms, model: modele, ...restants })
}

// ---------- « Poser une question », mode avancé : requête SQLite (POST ?mode=sql) ----------
// Entrée (JSON) : { phrase, schema, precedent? } : la phrase (300 caractères au plus), la DESCRIPTION des tables de la copie
// locale construite par l'appli (src/sqlMirror.ts, buildSqlSchema : colonnes, valeurs possibles, postes, catégories et
// critères des réglages, date du jour ; aucune donnée, aucun nom de joueur, de club, de lieu ou de personne) et, pour une
// seule correction, la requête précédente avec le message d'erreur de SQLite (jamais de lignes de résultat).
// Sortie : { sql, explication, affichage, nonGere, ms, model, restant_mois, restant_jour }. La requête n'est JAMAIS exécutée
// ici ni sur la base Supabase : l'appli la recontrôle (src/sqlGuard.ts : un seul SELECT / WITH, aucun mot qui écrit,
// LIMIT 500) et l'exécute dans le navigateur, sur une copie jetable en lecture seule de ses données locales.
// Modèle : MISTRAL_MODELE_SQL (codestral-latest par défaut), température 0, JSON. Les exemples sont exécutés par
// tools/test-sql.ts sur un jeu fictif (résultat attendu pour chacun). Ni la phrase ni la réponse ne sont journalisées.

const MAX_SQL = 4_000
const MAX_ERREUR = 300
const AFFICHAGES = ['nombre', 'liste', 'tableau', 'carte']

const CONSIGNES_SQL = `Tu écris UNE requête SQLite pour répondre à la question d'un entraîneur de handball (détection de jeunes). L'appli l'exécute elle-même, en lecture seule, sur une copie locale de ses données : tu ne vois aucune donnée.
Réponds seulement par ce JSON : {"sql":"…","explication":"…","affichage":"nombre|liste|tableau|carte","nonGere":[]}

RÈGLES
- SQLite seulement ; une seule instruction SELECT (ou WITH … SELECT), sans point-virgule, sans commentaire ; seulement les tables et colonnes du SCHÉMA, n'en invente aucune.
- Jamais PRAGMA, ATTACH, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, REPLACE (ni la fonction replace()), VACUUM ; pas de paramètre (?).
- LIMIT 500 au plus ; mets LIMIT quand tu listes ou classes.
- Joueurs listés : toujours la colonne joueur_id (joueurs.id AS joueur_id), puis nom, prenom et les valeurs utiles.
- Noms dits (prénom, nom, club, région, département, groupe, événement, catégorie, critère, personne du staff) : compare sans accents ni majuscules, sans_accents(colonne) = 'lucas' ou sans_accents(colonne) LIKE '%toulon%' (texte écrit sans accents, en minuscules).
- Département dit par son nom : sans_accents(departement_nom) ; par son numéro : departement = '83'.
- Moyennes d'avis : notes.note_sur5 avec notes.valide = 1 ; catégorie (« en défense ») : jointure criteres sur critere_id et sans_accents(criteres.categorie) LIKE '%defens%' ; critère nommé : sans_accents(criteres.libelle).
- Dates en texte AAAA-MM-JJ ; « cette saison » : entre les dates de la saison en cours (aujourdhui) ; jamais date('now') : prends la date d'aujourdhui donnée (les dates des exemples sont celles de la saison 2026-2027).
- « vu par N coachs » : COUNT(DISTINCT vus.staff) ; « vu à N événements » : COUNT(DISTINCT vus.evenement_id).
- Colonnes calculées : noms courts en minuscules avec _ (nb_joueurs, moyenne_defense, taille_moyenne_cm).
- explication : une phrase courte en français qui dit ce qui est compté, positive ou neutre (jamais « mauvais », « faible », « nul », « pas retenu » : dis « pas encore », « au plus », « moins de »).
- affichage : nombre (une seule valeur), liste (des joueurs), tableau (lignes regroupées), carte (par département : colonne departement et une valeur).
- Réponse par club : garde la colonne club (nom, tel quel) dans le résultat ; l'appli place les clubs sur une carte.
- Si les tables ne permettent pas de répondre : "sql":"" et la raison en quelques mots dans "nonGere".
- Si on te donne une requête précédente et l'erreur de SQLite : corrige cette requête.

EXEMPLES
« combien de joueurs s'appellent Lucas » → {"sql":"SELECT COUNT(*) AS nb_joueurs FROM joueurs WHERE sans_accents(prenom) = 'lucas'","explication":"Nombre de joueurs dont le prénom est Lucas (sans tenir compte des accents).","affichage":"nombre","nonGere":[]}
« quel club a le plus de pivots gauchers » → {"sql":"SELECT club, COUNT(*) AS nb_joueurs FROM joueurs WHERE poste = 'PIV' AND lateralite = 'gaucher' AND club IS NOT NULL GROUP BY club ORDER BY nb_joueurs DESC, club LIMIT 10","explication":"Clubs classés par nombre de pivots gauchers.","affichage":"tableau","nonGere":[]}
« les joueurs vus par 3 coachs différents mais jamais notés au-dessus de 3 en défense » → {"sql":"SELECT j.id AS joueur_id, j.nom, j.prenom, COUNT(DISTINCT v.staff) AS nb_coachs FROM joueurs j JOIN vus v ON v.joueur_id = j.id WHERE v.staff IS NOT NULL GROUP BY j.id HAVING COUNT(DISTINCT v.staff) >= 3 AND NOT EXISTS (SELECT 1 FROM notes n JOIN criteres c ON c.id = n.critere_id WHERE n.joueur_id = j.id AND sans_accents(c.categorie) LIKE '%defens%' AND n.note_sur5 > 3) ORDER BY nb_coachs DESC, j.nom LIMIT 500","explication":"Joueurs vus par au moins 3 personnes du staff, dont les notes de défense restent à 3 sur 5 au plus (ou pas encore notés en défense).","affichage":"liste","nonGere":[]}
« moyenne de taille par poste chez les 2010 » → {"sql":"SELECT poste, ROUND(AVG(taille_cm), 1) AS taille_moyenne_cm, COUNT(*) AS nb_joueurs FROM joueurs WHERE annee = 2010 AND taille_cm IS NOT NULL GROUP BY poste ORDER BY taille_moyenne_cm DESC","explication":"Taille moyenne des joueurs nés en 2010 qui ont une taille mesurée, par poste.","affichage":"tableau","nonGere":[]}
« les joueurs qui peuvent aussi jouer pivot » → {"sql":"SELECT id AS joueur_id, nom, prenom, poste FROM joueurs WHERE ',' || postes_secondaires || ',' LIKE '%,PIV,%' ORDER BY nom, prenom LIMIT 500","explication":"Joueurs qui ont pivot dans leurs postes secondaires.","affichage":"liste","nonGere":[]}
« quel coach a vu le plus de joueurs différents dans le Var » → {"sql":"SELECT v.staff, COUNT(DISTINCT v.joueur_id) AS nb_joueurs FROM vus v JOIN joueurs j ON j.id = v.joueur_id WHERE j.departement = '83' AND v.staff IS NOT NULL GROUP BY v.staff ORDER BY nb_joueurs DESC LIMIT 10","explication":"Personnes du staff classées par nombre de joueurs différents du Var vus.","affichage":"tableau","nonGere":[]}
« la moyenne en attaque des joueuses 2011 par club » → {"sql":"SELECT j.club, ROUND(AVG(n.note_sur5), 2) AS moyenne_attaque, COUNT(DISTINCT j.id) AS nb_joueuses FROM joueurs j JOIN notes n ON n.joueur_id = j.id JOIN criteres c ON c.id = n.critere_id WHERE j.sexe = 'F' AND j.annee = 2011 AND n.valide = 1 AND sans_accents(c.categorie) LIKE '%attaque%' GROUP BY j.club ORDER BY moyenne_attaque DESC","explication":"Moyenne des notes d'attaque (sur 5) des joueuses nées en 2011, par club.","affichage":"tableau","nonGere":[]}
« combien d'avis ont été écrits chaque mois depuis le 1er septembre 2026 » → {"sql":"SELECT substr(date, 1, 7) AS mois, COUNT(*) AS nb_avis FROM avis WHERE date >= '2026-09-01' GROUP BY mois ORDER BY mois","explication":"Nombre d'avis écrits par mois depuis le 1er septembre 2026.","affichage":"tableau","nonGere":[]}
« les joueurs du groupe Intercomités qui n'ont pas encore de mesure de CMJ » → {"sql":"SELECT j.id AS joueur_id, j.nom, j.prenom FROM joueurs j JOIN groupe_joueurs gj ON gj.joueur_id = j.id JOIN groupes g ON g.id = gj.groupe_id WHERE sans_accents(g.nom) LIKE '%intercomites%' AND NOT EXISTS (SELECT 1 FROM mesures m JOIN criteres c ON c.id = m.critere_id WHERE m.joueur_id = j.id AND sans_accents(c.libelle) LIKE 'cmj%') ORDER BY j.nom, j.prenom LIMIT 500","explication":"Joueurs du groupe Intercomités sans mesure de CMJ pour l'instant.","affichage":"liste","nonGere":[]}
« quelle génération compte le plus de gauchers » → {"sql":"SELECT annee, COUNT(*) AS nb_gauchers FROM joueurs WHERE lateralite = 'gaucher' AND annee IS NOT NULL GROUP BY annee ORDER BY nb_gauchers DESC, annee DESC","explication":"Nombre de gauchers par année de naissance.","affichage":"tableau","nonGere":[]}
« le gardien le plus grand de chaque département » → {"sql":"SELECT joueur_id, nom, prenom, departement, taille_cm FROM (SELECT id AS joueur_id, nom, prenom, departement, taille_cm, ROW_NUMBER() OVER (PARTITION BY departement ORDER BY taille_cm DESC) AS rang FROM joueurs WHERE poste = 'GB' AND taille_cm IS NOT NULL AND departement IS NOT NULL) WHERE rang = 1 ORDER BY departement LIMIT 500","explication":"Dans chaque département, le gardien avec la plus grande taille mesurée.","affichage":"liste","nonGere":[]}
« combien de joueurs par département ont été vus cette saison » → {"sql":"SELECT j.departement, COUNT(DISTINCT j.id) AS nb_joueurs FROM joueurs j JOIN vus v ON v.joueur_id = j.id WHERE v.date BETWEEN '2026-09-01' AND '2027-08-31' AND j.departement IS NOT NULL GROUP BY j.departement ORDER BY nb_joueurs DESC","explication":"Nombre de joueurs différents vus cette saison, par département.","affichage":"carte","nonGere":[]}
« quels joueurs ont changé de club cette année ? » → {"sql":"","explication":"","affichage":"tableau","nonGere":["l'historique des clubs n'est pas dans les données"]}`

async function requeteSql(
  req: Request,
  db: Db,
  userId: string,
  cle: string,
  maxMois: number,
  maxJour: number,
  json: (body: unknown, status?: number) => Response,
): Promise<Response> {
  const taille = Number(req.headers.get('content-length') ?? 0)
  if (taille > MAX_SCHEMA + MAX_SQL + 8192) return json({ error: 'trop_gros' }, 413)
  let entree: { phrase?: unknown; schema?: unknown; precedent?: unknown }
  try {
    entree = await req.json()
  } catch {
    return json({ error: 'requete_illisible' }, 400)
  }
  const phrase = typeof entree.phrase === 'string' ? entree.phrase.replace(/\s+/g, ' ').trim() : ''
  if (!phrase) return json({ error: 'phrase_absente' }, 400)
  if (phrase.length > MAX_PHRASE) return json({ error: 'phrase_trop_longue' }, 413)
  // Description des tables : une ligne « table : colonnes » par entrée (textes seulement), rien d'autre.
  const schema =
    entree.schema && typeof entree.schema === 'object' && !Array.isArray(entree.schema)
      ? Object.entries(entree.schema as Record<string, unknown>)
          .filter(([, v]) => typeof v === 'string')
          .map(([k, v]) => `${k.slice(0, 40)} : ${v}`)
          .join('\n')
      : ''
  if (!schema || schema.length > MAX_SCHEMA) return json({ error: 'schema_invalide' }, 400)
  // Correction (une seule, décidée par l'appli) : la requête précédente et le message de SQLite, rien d'autre.
  const p = entree.precedent && typeof entree.precedent === 'object' && !Array.isArray(entree.precedent) ? (entree.precedent as Record<string, unknown>) : null
  const precedent =
    p && typeof p.sql === 'string' && typeof p.erreur === 'string' && p.sql.length <= MAX_SQL + 200
      ? { sql: p.sql.trim(), erreur: p.erreur.replace(/\s+/g, ' ').trim().slice(0, MAX_ERREUR) }
      : null

  // Plafonds : un appel compté par requête (correction comprise).
  const { data: quota, error: quotaError } = await db.rpc('hb_transcription_compter', { p_user: userId, p_max_mois: maxMois, p_max_jour: maxJour })
  if (quotaError) return json({ error: 'quota_indisponible' }, 500)
  if (!quota?.ok) return json({ error: quota?.raison ?? 'quota_atteint', restant_mois: quota?.restant_mois ?? 0, restant_jour: quota?.restant_jour ?? 0 }, 429)

  const modele = Deno.env.get('MISTRAL_MODELE_SQL') || 'codestral-latest'
  const t0 = performance.now()
  const question = precedent
    ? `« ${phrase} »\nRequête précédente :\n${precedent.sql}\nErreur de SQLite : ${precedent.erreur}\nCorrige la requête.`
    : `« ${phrase} »`
  const res = await avecRelance(() => fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modele,
      temperature: 0,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${CONSIGNES_SQL}\n\nSCHÉMA (table : colonnes)\n${schema}` },
        { role: 'user', content: question },
      ],
    }),
  }))
  const ms = Math.round(performance.now() - t0)
  const restants = { restant_mois: quota.restant_mois, restant_jour: quota.restant_jour }
  if (!res.ok) {
    console.error('transcrire (sql) : Mistral a répondu', res.status)
    await res.body?.cancel()
    const error = res.status === 429 ? 'mistral_limite' : res.status === 401 ? 'mistral_cle' : 'mistral_erreur'
    return json({ error, status: res.status, ...restants }, 502)
  }
  // La réponse du modèle n'est jamais journalisée (elle reprend la phrase).
  let sortie: Record<string, unknown> = {}
  try {
    const out = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
    const contenu = out.choices?.[0]?.message?.content
    const texte = typeof contenu === 'string' ? contenu : Array.isArray(contenu) ? contenu.map((c) => (c as { text?: string })?.text ?? '').join('') : ''
    sortie = JSON.parse(texte.replace(/^```(?:json)?\s*|\s*```$/g, ''))
  } catch {
    return json({ error: 'reponse_illisible', ...restants }, 502)
  }
  if (!sortie || typeof sortie !== 'object' || Array.isArray(sortie)) return json({ error: 'reponse_illisible', ...restants }, 502)
  // Forme seulement (l'appli recontrôle tout) : une requête qui commence par SELECT ou WITH, de taille raisonnable.
  let sql = typeof sortie.sql === 'string' ? sortie.sql.trim().replace(/^```(?:sql)?\s*|\s*```$/g, '') : ''
  if (sql.length > MAX_SQL || (sql && !/^(select|with)\b/i.test(sql))) sql = ''
  const liste = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])
  const nonGere = liste(sortie.nonGere)
    .filter((x): x is string => typeof x === 'string' && !!x.trim())
    .map((x) => x.trim().slice(0, 120))
    .slice(0, 5)
  const explication = typeof sortie.explication === 'string' ? sortie.explication.replace(/\s+/g, ' ').trim().slice(0, 400) : ''
  const affichage = AFFICHAGES.includes(sortie.affichage as string) ? sortie.affichage : 'tableau'
  return json({ sql, explication, affichage, nonGere, ms, model: modele, ...restants })
}

// ---------- « Demander » une action : plan relu par l'appli (POST ?mode=action) ----------
// Entrée (JSON) : { phrase, schema, page? } : la phrase (300 caractères au plus), la DESCRIPTION de la recette des joueurs
// (src/recipe.ts, buildQuestionSchema : clés, opérateurs, postes, catégories et critères ; aucune donnée) et la page d'où
// vient la demande (joueurs, evenements, groupes, bilan : un mot, sans donnée). Sortie : { plan, ms, model, restant_mois,
// restant_jour }. Le plan n'est qu'une PROPOSITION : l'appli le relit (src/askAction.ts, parsePlan : action de la liste
// blanche seulement, textes bornés, recette revérifiée), retrouve les noms cités sur l'appareil, calcule les joueurs et
// demande l'accord de l'entraîneur (carte « Je vais : … », Accepter / Annuler) avant toute écriture. Ni la phrase ni la
// réponse ne sont journalisées. Exemples relus par tools/test-demander-actions.ts (chaque plan d'exemple doit être accepté).

const PAGES_ACTION = ['joueurs', 'evenements', 'groupes', 'bilan']

const CONSIGNES_ACTION = `Tu traduis la demande d'un entraîneur de handball (détection de jeunes) en PLAN JSON pour son appli. L'appli retrouve les noms, calcule les joueurs et demande TOUJOURS l'accord de l'entraîneur avant d'agir : tu ne vois aucune donnée.
Réponds seulement par ce JSON : {"action":"…","cible":"…","nom":"…","joueurs":{…},"createurs":[…],"liste":"…","nonGere":[…]}

ACTION (une seule)
- "creer_groupe" : créer un NOUVEAU groupe avec les joueurs trouvés (« crée un groupe avec… », « fais-moi un groupe des… », « trouve… et crée-moi un groupe avec »). "nom" : le nom dit (« appelé … »), sinon un nom court d'après les critères (40 caractères au plus).
- "ajouter_groupe" : ajouter les joueurs trouvés à un groupe EXISTANT (« ajoute… au groupe X », « mets-les dans le groupe X ») ; "cible" : son nom tel que dit.
- "ajouter_evenement" : ajouter les joueurs trouvés à un événement existant (tournoi, stage, match, rassemblement…) ; "cible" : son nom tel que dit.
- "ouvrir_evenement" : montrer certains joueurs D'UN événement (« les gauchers dans l'événement X », « la liste des gardiens du tournoi X ») ; "cible" : le nom de l'événement ; "joueurs" : le filtre, sans l'événement.
- "ouvrir_groupe" : même chose pour un groupe (« les gardiennes du groupe X »).
- "filtrer_createur" : les groupes ou les événements créés par quelqu'un ; "liste" : "groupes" ou "evenements" ; "createurs" : les noms tels que dits.
- "interdite" : supprimer, retirer, enlever, vider, modifier, renommer, archiver, déplacer ; toucher aux comptes, aux rôles, aux mots de passe ; envoyer un message. Rien d'autre à remplir.
- "aucune" : ce n'est pas une action (simple recherche, question de calcul).

RÈGLES
- "joueurs" est une RECETTE de joueurs d'après le SCHÉMA ci-dessous : {"population":{…},"vus":{…},"avis":[…],"nbAvis":{…},"mesures":[…]} ; jamais de "sortie". Omets ce qui n'est pas dit ; n'invente aucune valeur.
- Recette : « nés en 2010 », « les 2010 » → annee 2010 ; « filles », « joueuses » → sexe F ; « garçons » → M ; « gauchers » → lateralite gaucher ; « 1 m 80 », « 1,80 m » → 180 ; « plus de », « au moins » → tailleMin ; « moins de » → tailleMax ; « gardiens » → postes ["GB"] ; clubs, régions, départements : recopiés tels que dits (« Var », « 83 »).
- Noms de groupes, d'événements et de personnes : recopiés TELS QUE DITS, sans les corriger ; jamais dans "joueurs".
- Ce qui ne rentre nulle part : "nonGere" (quelques mots).

EXEMPLES
« Trouve-moi tous les gauchers du Var de plus d'1,80 m et crée-moi un groupe avec » → {"action":"creer_groupe","nom":"Gauchers Var 1,80 m+","joueurs":{"population":{"lateralite":"gaucher","departements":["Var"],"tailleMin":180}},"nonGere":[]}
« fais-moi un groupe appelé Repérés 2012 avec les filles de 2012 vues au moins deux fois » → {"action":"creer_groupe","nom":"Repérés 2012","joueurs":{"population":{"sexe":"F","annee":2012},"vus":{"op":">=","n":2}},"nonGere":[]}
« mets les gardiens de 2011 du Var dans le groupe Pôle Aix » → {"action":"ajouter_groupe","cible":"Pôle Aix","joueurs":{"population":{"postes":["GB"],"annee":2011,"departements":["Var"]}},"nonGere":[]}
« ajoute les pivots gauchers au tournoi de Cannes » → {"action":"ajouter_evenement","cible":"tournoi de Cannes","joueurs":{"population":{"postes":["PIV"],"lateralite":"gaucher"}},"nonGere":[]}
« donne-moi la liste des gauchers dans l'événement Détection 2013 » → {"action":"ouvrir_evenement","cible":"Détection 2013","joueurs":{"population":{"lateralite":"gaucher"}},"nonGere":[]}
« les gardiennes du groupe Pôle Aix » → {"action":"ouvrir_groupe","cible":"Pôle Aix","joueurs":{"population":{"sexe":"F","postes":["GB"]}},"nonGere":[]}
« montre-moi les groupes que Paul a créés » → {"action":"filtrer_createur","liste":"groupes","createurs":["Paul"],"nonGere":[]}
« supprime le groupe Pôle Aix » → {"action":"interdite","nonGere":[]}
« retire les gauchers du groupe Intercomités » → {"action":"interdite","nonGere":[]}
« combien de gauchers dans le Var ? » → {"action":"aucune","nonGere":[]}`

async function planAction(
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
  let entree: { phrase?: unknown; schema?: unknown; page?: unknown }
  try {
    entree = await req.json()
  } catch {
    return json({ error: 'requete_illisible' }, 400)
  }
  const phrase = typeof entree.phrase === 'string' ? entree.phrase.replace(/\s+/g, ' ').trim() : ''
  if (!phrase) return json({ error: 'phrase_absente' }, 400)
  if (phrase.length > MAX_PHRASE) return json({ error: 'phrase_trop_longue' }, 413)
  const page = typeof entree.page === 'string' && PAGES_ACTION.includes(entree.page) ? entree.page : ''
  // Description de la recette des joueurs : une ligne « clé : valeurs » par clé (textes seulement), rien d'autre.
  const schema =
    entree.schema && typeof entree.schema === 'object' && !Array.isArray(entree.schema)
      ? Object.entries(entree.schema as Record<string, unknown>)
          .filter(([, v]) => typeof v === 'string')
          .map(([k, v]) => `${k.slice(0, 40)} : ${v}`)
          .join('\n')
      : ''
  if (!schema || schema.length > MAX_SCHEMA) return json({ error: 'schema_invalide' }, 400)

  // Plafonds : un appel compté par demande, comme une dictée.
  const { data: quota, error: quotaError } = await db.rpc('hb_transcription_compter', { p_user: userId, p_max_mois: maxMois, p_max_jour: maxJour })
  if (quotaError) return json({ error: 'quota_indisponible' }, 500)
  if (!quota?.ok) return json({ error: quota?.raison ?? 'quota_atteint', restant_mois: quota?.restant_mois ?? 0, restant_jour: quota?.restant_jour ?? 0 }, 429)

  const modele = Deno.env.get('MISTRAL_MODELE_ACTION') || Deno.env.get('MISTRAL_MODELE_QUESTION') || 'mistral-small-latest'
  const t0 = performance.now()
  const res = await avecRelance(() => fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modele,
      temperature: 0,
      max_tokens: 600,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${CONSIGNES_ACTION}\n\nSCHÉMA DE LA RECETTE DES JOUEURS (clé : valeurs)\n${schema}` },
        { role: 'user', content: page ? `Page ${page} ; « ${phrase} »` : `« ${phrase} »` },
      ],
    }),
  }))
  const ms = Math.round(performance.now() - t0)
  const restants = { restant_mois: quota.restant_mois, restant_jour: quota.restant_jour }
  if (!res.ok) {
    console.error('transcrire (action) : Mistral a répondu', res.status)
    await res.body?.cancel()
    const error = res.status === 429 ? 'mistral_limite' : res.status === 401 ? 'mistral_cle' : 'mistral_erreur'
    return json({ error, status: res.status, ...restants }, 502)
  }
  // La réponse du modèle n'est jamais journalisée (elle reprend la phrase).
  let plan: unknown
  try {
    const out = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
    const contenu = out.choices?.[0]?.message?.content
    const texte = typeof contenu === 'string' ? contenu : Array.isArray(contenu) ? contenu.map((c) => (c as { text?: string })?.text ?? '').join('') : ''
    plan = JSON.parse(texte.replace(/^```(?:json)?\s*|\s*```$/g, ''))
  } catch {
    return json({ error: 'reponse_illisible', ...restants }, 502)
  }
  // Forme seulement : un objet de taille raisonnable (l'appli revérifie chaque champ et n'écrit rien sans accord).
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || JSON.stringify(plan).length > MAX_RECETTE) return json({ error: 'reponse_illisible', ...restants }, 502)
  return json({ plan, ms, model: modele, ...restants })
}
