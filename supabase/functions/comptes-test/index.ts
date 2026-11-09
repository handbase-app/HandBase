// HandBase : fonction Supabase « comptes-test » : comptes de test gardés sur le COMPTE ADMINISTRATEUR, pour les retrouver
// sur tous ses appareils (« Changer de compte », src/comptes.ts) sans retaper leur mot de passe. Règle (Geoffroy, 09/11/2026) :
// seulement les comptes AJOUTÉS UNE FOIS avec leur mot de passe, sur n'importe quel appareil. Table :
// supabase/076_comptes_test.sql (lecture par l'administrateur, ses lignes seulement ; écriture ici seulement).
//
// POST JSON, en-tête Authorization: Bearer <jeton de l'administrateur connecté> :
// - { action: "lier", jeton_test } : jeton_test = jeton d'accès du compte de test, obtenu par la connexion AVEC SON MOT DE
//   PASSE sur un client à part (ou session encore gardée sur l'appareil, pour un compte ajouté avant cette version). Les deux
//   jetons sont vérifiés au serveur d'authentification (getUser) : c'est la preuve que le mot de passe a été saisi une fois.
//   L'appelant doit être administrateur (hb_profiles.role), la cible un autre compte, pas administrateur. 20 comptes au plus.
//   → { ok, compte: { test_uid, email, libelle, role, ajoute_le } }.
// - { action: "ouvrir", test_uid } : l'appelant est toujours administrateur, la ligne (lui, test_uid) existe, la cible existe,
//   n'est pas bloquée ni administrateur. Lien de connexion fabriqué au serveur (auth.admin.generateLink, type magiclink) :
//   AUCUN e-mail n'est envoyé (generateLink n'envoie jamais rien, SMTP inutile) ; seul hashed_token est rendu. L'appli
//   l'échange contre une session (verifyOtp { token_hash, type: "magiclink" }) sur un client à part : le compte de test
//   devient alors un compte gardé normal de l'appareil. Usage unique, échangé aussitôt (valable 24 h sinon : réglage
//   GOTRUE_MAILER_OTP_EXP par défaut du serveur d'authentification).
//   → { token_hash }.
// - { action: "retirer", test_uid } : la ligne de CET appelant part (toujours permis : on retire ce qu'on a). → { ok }.
// Erreurs (JSON error) : non_connecte (401), demande (400), meme_compte (400), pas_admin / cible_admin / cible_bloquee (403),
// inconnu / cible_absente (404), trop (409), table_absente (503, 076 pas encore passé), serveur (500).
//
// JAMAIS de mot de passe ni de jeton du compte de test stocké ou journalisé : ni dans la table, ni dans les journaux (aucun
// console.log de la demande ; seuls des codes d'erreur sortent).
//
// Variables (fournies par la pile Supabase) : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Rien d'autre.
// Déploiement (serveur maison) : copier ce dossier dans volumes/functions/comptes-test/ de la pile hand, puis redémarrer le
// conteneur des fonctions (voir le compte rendu de la version). Supabase en ligne : npx supabase functions deploy comptes-test
// (garder la vérification JWT).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { decisionLier, decisionOuvrir, libelleDe, lireDemande, roleTest, statutRefus, MAX_DEMANDE, type Refus } from './regles.ts'

const ORIGINES = ['https://handbase-demo.github.io', 'https://handbase-app.github.io', 'https://volleybase-demo.github.io']
// Essais locaux et serveur maison (Tailscale : adresses 100.64–127.x.x ou nom MagicDNS en .ts.net), comme « transcrire ».
const LOCAL =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d{1,3}\.\d{1,3}|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}|[a-z0-9-]+\.[a-z0-9-]+\.ts\.net)(:\d+)?$/

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  const ok = ORIGINES.includes(origin) || LOCAL.test(origin)
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  }
}

// Table absente (076 pas passé) : PostgREST rend PGRST205 (ou 42P01 selon la version).
const tableAbsente = (e: { code?: string } | null) => !!e && (e.code === 'PGRST205' || e.code === '42P01')

Deno.serve(async (req) => {
  const h = cors(req)
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: h })
  const refus = (r: Refus) => json({ error: r }, statutRefus(r))
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h })
  if (req.method !== 'POST') return json({ error: 'methode' }, 405)

  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'non_connecte' }, 401)
  const texte = await req.text().catch(() => '')
  if (texte.length > MAX_DEMANDE) return json({ error: 'demande' }, 400)
  const d = lireDemande(texte)
  if (!d) return json({ error: 'demande' }, 400)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data: moi, error: errMoi } = await db.auth.getUser(jwt)
  if (errMoi || !moi?.user) return json({ error: 'non_connecte' }, 401)
  const appelant = moi.user.id
  const roleDe = async (uid: string) => ((await db.from('hb_profiles').select('role').eq('user_id', uid).maybeSingle()).data as { role?: string } | null)?.role ?? ''

  try {
    if (d.action === 'retirer') {
      const { error } = await db.from('hb_comptes_test').delete().eq('admin_uid', appelant).eq('test_uid', d.test_uid)
      if (tableAbsente(error)) return json({ error: 'table_absente' }, 503)
      if (error) return json({ error: 'serveur' }, 500)
      return json({ ok: true })
    }

    const roleAppelant = await roleDe(appelant)
    if (roleAppelant !== 'admin') return refus('pas_admin')

    if (d.action === 'lier') {
      // Preuve du mot de passe : le jeton du compte de test, vérifié au serveur d'authentification puis oublié.
      const { data: lui, error: errLui } = await db.auth.getUser(d.jeton_test)
      if (errLui || !lui?.user) return json({ error: 'non_connecte' }, 401)
      const cible = lui.user
      const roleCible = await roleDe(cible.id)
      const { data: lignes, error: errL } = await db.from('hb_comptes_test').select('test_uid').eq('admin_uid', appelant)
      if (tableAbsente(errL)) return json({ error: 'table_absente' }, 503)
      if (errL) return json({ error: 'serveur' }, 500)
      const r = decisionLier({
        appelant,
        roleAppelant,
        cible: cible.id,
        roleCible,
        lignes: lignes?.length ?? 0,
        dejaLie: !!lignes?.some((l) => l.test_uid === cible.id),
      })
      if (r) return refus(r)
      const ligne = { admin_uid: appelant, test_uid: cible.id, email: cible.email ?? '', libelle: libelleDe(cible.user_metadata), role: roleTest(roleCible) }
      if (!ligne.email) return refus('cible_absente')
      const { data: faite, error } = await db
        .from('hb_comptes_test')
        .upsert(ligne, { onConflict: 'admin_uid,test_uid' })
        .select('test_uid, email, libelle, role, ajoute_le')
        .single()
      if (error || !faite) return json({ error: 'serveur' }, 500)
      return json({ ok: true, compte: faite })
    }

    // ouvrir
    const { data: ligne, error: errL } = await db.from('hb_comptes_test').select('test_uid').eq('admin_uid', appelant).eq('test_uid', d.test_uid).maybeSingle()
    if (tableAbsente(errL)) return json({ error: 'table_absente' }, 503)
    if (errL) return json({ error: 'serveur' }, 500)
    const { data: lu } = ligne ? await db.auth.admin.getUserById(d.test_uid) : { data: null }
    const cible = lu?.user ?? null
    const roleCible = cible ? await roleDe(cible.id) : ''
    const r = decisionOuvrir({
      roleAppelant,
      ligne: !!ligne,
      cibleExiste: !!cible,
      email: cible?.email ?? '',
      bloqueeJusqua: (cible as { banned_until?: string | null } | null)?.banned_until,
      roleCible,
      maintenant: Date.now(),
    })
    if (r) return refus(r)
    // Lien fabriqué sans envoi d'e-mail ; seul le jeton haché repart (l'adresse du lien, qui le contient aussi, est jetée).
    const { data: lien, error: errLien } = await db.auth.admin.generateLink({ type: 'magiclink', email: cible!.email! })
    const tokenHash = lien?.properties?.hashed_token
    if (errLien || !tokenHash) return json({ error: 'serveur' }, 500)
    await db
      .from('hb_comptes_test')
      .update({ ouvert_le: new Date().toISOString(), role: roleTest(roleCible), email: cible!.email!, libelle: libelleDe(cible!.user_metadata) })
      .eq('admin_uid', appelant)
      .eq('test_uid', d.test_uid)
    return json({ token_hash: tokenHash })
  } catch {
    return json({ error: 'serveur' }, 500)
  }
})
