// Essai de dictée : page autonome, hors de l'application HandBase.
// Le son reste en mémoire. Seuls les réglages et les résultats de cette page sont gardés
// sur l'appareil (clés handbase.essai-dictee.*). De l'application, seule la session Supabase est lue (pour
// Voxtral, en lecture seule) ; rien d'autre n'est lu ni écrit.

import { nettoyer, nettoyerDetail } from './nettoyage.js'
import { promptWhisper, motsVoxtral } from './vocabulaire.js'

const $ = (id) => document.getElementById(id)
const KEY_PREFS = 'handbase.essai-dictee.prefs'
const KEY_RESULTS = 'handbase.essai-dictee.results'

// Modèles multilingues ONNX (Hugging Face, onnx-community), révisions figées.
// Tailles en Mo : encodeur + décodeur de la variante, sans les petits fichiers (≈ 3 Mo de plus).
const MODELS = {
  tiny: {
    label: 'Whisper tiny', repo: 'onnx-community/whisper-tiny', revision: 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7',
    variants: { q8: 41, q4: 96, gpu: 120 },
  },
  base: {
    label: 'Whisper base', repo: 'onnx-community/whisper-base', revision: '1846881b6b3a3024392c1eea3ad983695bc23925',
    variants: { q8: 77, q4: 142, gpu: 206 },
  },
  small: {
    label: 'Whisper small', repo: 'onnx-community/whisper-small', revision: '36050c46d777d46dc4b5f43f6d90574fc38f8732',
    variants: { q8: 249, q4: 299, gpu: 586 },
  },
  turbo: {
    label: 'Whisper large v3 turbo (ordinateur avec WebGPU seulement)', repo: 'onnx-community/whisper-large-v3-turbo',
    revision: '360ebcde2559d60bb474678be3c1de9ef347d01a',
    variants: { q4f16: 564, q4: 759 },
  },
}
const VARIANTS = {
  q8: { label: 'q8, léger (conseillé en WASM)', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } },
  q4: { label: 'q4', dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' } },
  gpu: { label: 'fp32 + q4 (conseillé en WebGPU)', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } },
  q4f16: { label: 'q4f16 (WebGPU avec shader-f16)', dtype: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' } },
}

// Phrases à lire, jargon du handball, aucune personne réelle.
const PHRASES = [
  'Le demi-centre accélère la montée de balle et sert le pivot entre les deux défenseurs.',
  "Bon repli défensif de l'ailier gauche, puis une roucoulette en contre-attaque.",
  'Le gaucher arme à neuf mètres, mais le gardien sort la parade.',
  'Très à l\'aise en 1 contre 1, il conclut par une chabala au-dessus du gardien.',
  'Belle combinaison kung-fu sur l\'aile, à travailler : la lecture du jeu en défense étagée.',
]

// ---------- stockage de la page seulement ----------
function readStore(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback } catch { return fallback }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* stockage indisponible : sans importance */ }
}

const prefs = Object.assign({ engine: 'whisper', model: '', variant: '', device: 'auto', amb: 'calme', mode: 'hold', phrase: 1, threads: 'auto', vocab: true }, readStore(KEY_PREFS, {}))
let results = readStore(KEY_RESULTS, [])
if (!Array.isArray(results)) results = []
const savePrefs = () => writeStore(KEY_PREFS, prefs)
const saveResults = () => writeStore(KEY_RESULTS, results)

// ---------- appareil ----------
const dev = { lines: [], hasWebGPU: false, f16: false, webSpeech: false, verdict: '' }

function fmtBytes(n) {
  if (!n && n !== 0) return '?'
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace('.', ',') + ' Go'
  return Math.round(n / 1e6) + ' Mo'
}
const fmt = (n, d = 1) => (n == null || !isFinite(n) ? '—' : n.toFixed(d).replace('.', ','))

async function uaSummary() {
  const ua = navigator.userAgent
  let browser = 'navigateur inconnu'
  let m
  if ((m = ua.match(/Firefox\/(\d+)/))) browser = 'Firefox ' + m[1]
  else if ((m = ua.match(/Edg\/(\d+)/))) browser = 'Edge ' + m[1]
  else if ((m = ua.match(/SamsungBrowser\/(\d+)/))) browser = 'Samsung Internet ' + m[1]
  else if ((m = ua.match(/Chrome\/(\d+)/))) browser = 'Chrome ' + m[1]
  else if ((m = ua.match(/Version\/(\d+).*Safari/))) browser = 'Safari ' + m[1]
  let os = 'système inconnu'
  if ((m = ua.match(/Android (\d+(\.\d+)?)/))) os = 'Android ' + m[1]
  else if (/iPhone|iPad/.test(ua)) os = 'iOS'
  else if (/Windows/.test(ua)) os = 'Windows'
  else if (/Mac OS X/.test(ua)) os = 'macOS'
  else if (/Ubuntu/.test(ua)) os = 'Ubuntu'
  else if (/Linux/.test(ua)) os = 'Linux'
  let model = ''
  try {
    if (navigator.userAgentData?.getHighEntropyValues) {
      const h = await navigator.userAgentData.getHighEntropyValues(['model', 'platformVersion'])
      if (h.model) model = h.model
      if (os.startsWith('Android') && h.platformVersion) os = 'Android ' + h.platformVersion.split('.')[0]
    }
  } catch { /* indisponible */ }
  return browser + ', ' + os + (model ? ', ' + model : '')
}

async function detectDevice() {
  const L = []
  L.push(['Navigateur', await uaSummary()])
  L.push(['Mémoire', navigator.deviceMemory ? navigator.deviceMemory + ' Go (arrondi par le navigateur)' : 'non communiquée'])
  L.push(['Cœurs', navigator.hardwareConcurrency ? String(navigator.hardwareConcurrency) : 'inconnu'])
  let gpuText = 'non disponible'
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter && !adapter.isFallbackAdapter) {
        dev.hasWebGPU = true
        dev.f16 = adapter.features.has('shader-f16')
        let info = adapter.info
        if (!info && adapter.requestAdapterInfo) { try { info = await adapter.requestAdapterInfo() } catch { /* ancien navigateur */ } }
        const parts = info ? [info.vendor, info.architecture, info.device, info.description].filter(Boolean) : []
        gpuText = 'oui' + (parts.length ? ' (' + parts.join(', ') + ')' : '') + (dev.f16 ? ', shader-f16' : '')
      } else if (adapter) {
        gpuText = 'adaptateur logiciel seulement (non retenu)'
      } else {
        gpuText = 'API présente, aucun adaptateur'
      }
    } catch (e) {
      gpuText = 'erreur : ' + (e.message || e)
    }
  }
  L.push(['WebGPU', gpuText])
  L.push(['crossOriginIsolated', self.crossOriginIsolated ? 'oui (WASM sur plusieurs cœurs possible)' : 'non (WASM sur un seul cœur' + (window.coiNote ? ' : ' + window.coiNote : '') + ')'])
  try {
    const est = await navigator.storage?.estimate?.()
    if (est) L.push(['Stockage', fmtBytes(est.quota - est.usage) + ' libres sur ' + fmtBytes(est.quota) + ' (' + fmtBytes(est.usage) + ' utilisés par ce site)'])
    else L.push(['Stockage', 'estimation indisponible'])
  } catch { L.push(['Stockage', 'estimation indisponible']) }
  const micOk = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder)
  L.push(['Micro', micOk ? (window.isSecureContext ? 'API disponible' : 'API présente, mais il faut une adresse https') : 'API non disponible'])
  dev.webSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  L.push(['Dictée du navigateur', dev.webSpeech ? 'disponible' : 'non disponible'])
  await detectAI()
  L.push(['IA intégrée de Chrome', AI_LABEL[ai.state] + (ai.detail ? ' (' + ai.detail + ')' : '')])
  dev.lines = L

  const mem = navigator.deviceMemory
  const cores = navigator.hardwareConcurrency || 0
  let v
  if ((mem && mem <= 2) || (cores && cores <= 2)) v = ['Trop faible', 'v-bad']
  else if (dev.hasWebGPU || (cores >= 8 && (!mem || mem >= 6))) v = ['Probablement apte', 'v-ok']
  else v = ['Limite', 'v-warn']
  dev.verdict = v[0]
  $('devlist').innerHTML = ''
  for (const [k, val] of L) {
    const dt = document.createElement('dt'); dt.textContent = k
    const dd = document.createElement('dd'); dd.textContent = val
    $('devlist').append(dt, dd)
  }
  $('devverdict').innerHTML = ''
  const s = document.createElement('span'); s.className = v[1]; s.textContent = 'Verdict rapide : ' + v[0]
  $('devverdict').append(s)
}


// ---------- IA intégrée de Chrome (sur l'appareil) ----------
// Prompt API (LanguageModel) en priorité, sinon Rewriter API. Rien n'est envoyé à un serveur :
// Chrome télécharge son modèle (Gemini Nano) une fois et l'exécute sur l'appareil.
const AI_LABEL = { available: 'disponible', downloadable: 'à télécharger', downloading: 'à télécharger (en cours)', unavailable: 'indisponible' }
const ai = { state: 'unavailable', api: '', detail: '', fr: false }
const AI_SYSTEM = [
  'Tu mets en forme la dictée d\'un entraîneur de handball en note de repérage, en français. Cette note sera relue et validée par l\'entraîneur.',
  'Forme :',
  'Points forts : (ce que l\'entraîneur a dit de positif, avec ses mots)',
  'À revoir : (seulement si l\'entraîneur a lui-même cité un point à travailler ; sinon, n\'écris pas du tout cette ligne)',
  'Règles strictes :',
  '- reprends uniquement ce qui a été dit ; n\'invente rien, ne déduis rien ;',
  '- n\'ajoute aucun adjectif ni jugement absent du texte (pas de « efficace », « amélioré », « excellent »… s\'ils n\'ont pas été dits) ;',
  '- jamais de remplissage ni d\'espace réservé : pas de « … », pas de « à préciser », pas de ligne vide ;',
  '- garde tels quels les numéros de maillot, les postes et les termes de handball (demi-centre, pivot, ailier, chabala, roucoulette, kung-fu…) ;',
  '- ton neutre ou positif ; n\'ajoute aucun nom de personne ;',
  '- pas de titre ni de commentaire : réponds seulement avec la note.',
].join('\n')
const LM_LANG = { expectedInputs: [{ type: 'text', languages: ['fr'] }], expectedOutputs: [{ type: 'text', languages: ['fr'] }] }
const RW_OPTS = { tone: 'as-is', format: 'plain-text', length: 'as-is', expectedInputLanguages: ['fr'], expectedContextLanguages: ['fr'], outputLanguage: 'fr' }

async function detectAI() {
  ai.state = 'unavailable'; ai.api = ''; ai.detail = ''
  try {
    if (typeof self.LanguageModel !== 'undefined') {
      let a = await self.LanguageModel.availability(LM_LANG)
      ai.fr = a !== 'unavailable'
      if (a === 'unavailable') { a = await self.LanguageModel.availability({}); if (a !== 'unavailable') ai.detail = 'français non déclaré pris en charge' }
      if (a !== 'unavailable') { ai.state = a; ai.api = 'LanguageModel'; ai.detail = ['Prompt API', ai.detail].filter(Boolean).join(', '); return }
    }
    if (typeof self.Rewriter !== 'undefined') {
      const a = await self.Rewriter.availability(RW_OPTS)
      if (a !== 'unavailable') { ai.state = a; ai.api = 'Rewriter'; ai.detail = 'Rewriter API'; return }
    }
    ai.detail = typeof self.LanguageModel !== 'undefined' || typeof self.Rewriter !== 'undefined' ? 'API présente, modèle non pris en charge sur cet appareil' : 'API absente de ce navigateur'
  } catch (e) {
    ai.detail = 'erreur : ' + (e.message || e)
  }
}

// Reformule un texte nettoyé ; renvoie { text, ms, createMs }.
async function aiRewrite(text, onProgress) {
  const monitor = (m) => m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded))
  const t0 = performance.now()
  if (ai.api === 'LanguageModel') {
    const session = await self.LanguageModel.create({
      ...(ai.fr ? LM_LANG : {}),
      initialPrompts: [{ role: 'system', content: AI_SYSTEM }],
      monitor,
    })
    const t1 = performance.now()
    try {
      const out = await session.prompt('Dictée :\n' + text)
      return { text: out.trim(), ms: performance.now() - t1, createMs: t1 - t0 }
    } finally {
      session.destroy?.()
    }
  }
  const rw = await self.Rewriter.create({ ...RW_OPTS, sharedContext: AI_SYSTEM, monitor })
  const t1 = performance.now()
  try {
    const out = await rw.rewrite(text, { context: 'Dictée d\'un entraîneur de handball à transformer en note de repérage.' })
    return { text: out.trim(), ms: performance.now() - t1, createMs: t1 - t0 }
  } finally {
    rw.destroy?.()
  }
}

async function reformulate(r, btn, out) {
  btn.disabled = true
  const was = btn.textContent
  btn.textContent = 'Reformulation…'
  try {
    const res = await aiRewrite(r.clean || r.text, (p) => { btn.textContent = 'Téléchargement de l\'IA de Chrome… ' + Math.round((p || 0) * 100) + ' %' })
    r.ai = res.text
    r.aiS = res.ms / 1000
    r.aiCreateS = res.createMs / 1000
    r.aiApi = ai.api
    saveResults()
    if (ai.state !== 'available') { ai.state = 'available' }
    renderResults()
  } catch (e) {
    out.textContent = 'Reformulation impossible : ' + (e.message || e)
    btn.textContent = was
    btn.disabled = false
  }
}

// ---------- réglages ----------
const radio = (name) => document.querySelector('input[name="' + name + '"]:checked')?.value
function setRadio(name, value) {
  const el = document.querySelector('input[name="' + name + '"][value="' + value + '"]')
  if (el && !el.disabled) el.checked = true
}
const resolvedDevice = () => {
  const d = radio('device')
  if (d === 'auto') return dev.hasWebGPU ? 'webgpu' : 'wasm'
  return d
}
function recommendedVariant(modelKey, device) {
  if (modelKey === 'turbo') return dev.f16 && device === 'webgpu' ? 'q4f16' : 'q4'
  if (device === 'webgpu') return modelKey === 'small' ? 'q4' : 'gpu'
  return 'q8'
}
function fillModels() {
  const sel = $('model')
  sel.innerHTML = ''
  for (const [k, m] of Object.entries(MODELS)) {
    const o = document.createElement('option')
    o.value = k
    const min = Math.min(...Object.values(m.variants))
    o.textContent = m.label + ' (à partir de ' + min + ' Mo)'
    sel.append(o)
  }
  sel.value = MODELS[prefs.model] ? prefs.model : 'base'
}
function fillVariants(keepPref) {
  const m = MODELS[$('model').value]
  const sel = $('variant')
  sel.innerHTML = ''
  for (const [k, mb] of Object.entries(m.variants)) {
    const o = document.createElement('option')
    o.value = k
    o.textContent = VARIANTS[k].label + ' : ' + mb + ' Mo'
    if (k === 'q4f16' && !dev.f16) { o.disabled = true; o.textContent += ' (non pris en charge ici)' }
    sel.append(o)
  }
  const rec = recommendedVariant($('model').value, resolvedDevice())
  const want = keepPref && m.variants[prefs.variant] && !(prefs.variant === 'q4f16' && !dev.f16) ? prefs.variant : rec
  sel.value = want
  updateSizeNote()
}
function updateSizeNote() {
  const m = MODELS[$('model').value]
  const mb = m.variants[$('variant').value]
  const d = resolvedDevice()
  let t = 'Téléchargement : environ ' + (mb + 3) + ' Mo la première fois, puis gardé dans le cache du navigateur. Le moteur de calcul (environ 22 Mo) est aussi téléchargé une fois. Calcul prévu : ' + (d === 'webgpu' ? 'WebGPU' : 'WASM') + '.'
  if ($('model').value === 'turbo') t += ' Ce modèle est trop lourd pour un téléphone.'
  if ($('model').value === 'small' && /Android/.test(navigator.userAgent)) t += ' Sur téléphone, small peut manquer de mémoire.'
  $('sizeNote').textContent = t
}
function fillPhrases() {
  const sel = $('phrase')
  sel.innerHTML = ''
  PHRASES.forEach((p, i) => {
    const o = document.createElement('option'); o.value = String(i + 1); o.textContent = 'Phrase ' + (i + 1); sel.append(o)
  })
  const o = document.createElement('option'); o.value = '0'; o.textContent = 'Texte libre (sans comparaison)'; sel.append(o)
  sel.value = String(prefs.phrase ?? 1)
  if (!sel.value) sel.value = '1'
  showPhrase()
}
function showPhrase() {
  const n = Number($('phrase').value)
  $('phraseText').textContent = n ? PHRASES[n - 1] : 'Dites ce que vous voulez, par exemple une courte évaluation.'
}
function engine() { return radio('engine') }
function updateEngineUi() {
  const e = engine()
  $('whisperOpts').classList.toggle('hidden', e !== 'whisper')
  $('vocabBox').classList.toggle('hidden', e === 'webspeech')
  $('wsNote').classList.toggle('hidden', e !== 'webspeech')
  $('vxNote').classList.toggle('hidden', e !== 'voxtral')
  updateButtons()
}

// ---------- Voxtral (Mistral AI), par la fonction Supabase « transcrire » ----------
// La clé Mistral reste sur le serveur. La page reprend, en lecture seule, la session HandBase gardée par
// l'application sur ce site (clé « sb-<projet>-auth-token ») ; elle ne la renouvelle jamais elle-même
// (ce serait déconnecter l'application) : session expirée → ouvrir HandBase, puis revenir.
const vx = { state: 'inconnu', url: '', token: '', restantMois: null, restantJour: null }
const VX_TEXTE = {
  inconnu: 'Voxtral : vérification…',
  ok: 'Voxtral : prêt.',
  non_connecte: "Voxtral : connectez-vous d'abord dans HandBase (compte administrateur), puis rechargez cette page.",
  expire: 'Voxtral : session expirée. Ouvrez HandBase sur ce site pour la renouveler, puis rechargez cette page.',
  pas_admin: 'Voxtral : réservé aux comptes administrateurs.',
  absent: "Voxtral n'est pas installé sur ce serveur.",
  sans_cle: "Voxtral : la clé Mistral n'est pas encore configurée sur le serveur.",
  erreur: 'Voxtral : serveur injoignable.',
}
function readSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      const m = k && k.match(/^sb-([a-z0-9]+)-auth-token$/)
      if (!m) continue
      const v = JSON.parse(localStorage.getItem(k) || 'null')
      const sess = v?.currentSession ?? v
      if (sess?.access_token) return { ref: m[1], token: sess.access_token, expiresAt: Number(sess.expires_at) || 0 }
    }
  } catch { /* stockage indisponible */ }
  return null
}
async function detectVoxtral() {
  const sess = readSession()
  if (!sess) return setVx('non_connecte')
  if (sess.expiresAt && sess.expiresAt * 1000 < Date.now() + 60000) return setVx('expire')
  vx.url = 'https://' + sess.ref + '.supabase.co/functions/v1/transcrire'
  vx.token = sess.token
  try {
    const res = await fetch(vx.url, { headers: { Authorization: 'Bearer ' + vx.token } })
    if (res.status === 404) return setVx('absent')
    if (res.status === 401) return setVx('expire')
    if (res.status === 403) return setVx('pas_admin')
    if (!res.ok) return setVx('erreur')
    const d = await res.json()
    vx.restantMois = d.restant_mois
    vx.restantJour = d.restant_jour
    setVx(d.pret ? 'ok' : 'sans_cle')
  } catch {
    setVx('erreur')
  }
}
function setVx(state) {
  vx.state = state
  const input = document.querySelector('input[name="engine"][value="voxtral"]')
  input.disabled = state !== 'ok'
  if (input.disabled && input.checked) { setRadio('engine', 'whisper'); updateEngineUi() }
  let t = VX_TEXTE[state] || ''
  if (state === 'ok' && vx.restantMois != null) t += ' Restant : ' + vx.restantMois + ' dictées ce mois-ci, ' + vx.restantJour + " aujourd'hui pour vous."
  $('vxState').textContent = t
}
const VX_ERREURS = {
  quota_atteint: 'Quota du mois atteint : dictez au clavier.',
  quota_jour_atteint: "Plafond du jour atteint pour votre compte : dictez au clavier, ou réessayez demain.",
  trop_long: 'Son trop long pour Voxtral : 60 secondes au plus.',
  trop_gros: 'Son trop lourd pour Voxtral : 2 Mo au plus.',
  mistral_limite: "Limite de l'offre gratuite Mistral atteinte pour l'instant : réessayez dans un moment.",
  mistral_cle: 'La clé Mistral est refusée : à vérifier sur le serveur.',
  cle_absente: "La clé Mistral n'est pas configurée sur le serveur.",
  non_connecte: 'Session expirée : ouvrez HandBase pour la renouveler, puis rechargez cette page.',
  pas_admin: 'Voxtral est réservé aux comptes administrateurs.',
}
function blobName(blob) {
  const t = blob.type || ''
  const ext = /ogg/.test(t) ? 'ogg' : /mp4|m4a|aac/.test(t) ? 'm4a' : /wav/.test(t) ? 'wav' : /mpeg|mp3/.test(t) ? 'mp3' : 'webm'
  return 'son.' + ext
}
async function runVoxtral(blob, audioS) {
  if (vx.state !== 'ok') throw new Error(VX_TEXTE[vx.state] || 'Voxtral indisponible.')
  if (audioS > 60) throw new Error(VX_ERREURS.trop_long)
  if (blob.size > 2 * 1024 * 1024) throw new Error(VX_ERREURS.trop_gros)
  const form = new FormData()
  form.append('file', blob, blob.name || blobName(blob))
  form.append('duree', String(Math.ceil(audioS * 10) / 10))
  if (vocabOn()) for (const m of motsVoxtral) form.append('context_bias', m)
  const t0 = performance.now()
  let res
  try {
    res = await fetch(vx.url, { method: 'POST', headers: { Authorization: 'Bearer ' + vx.token }, body: form })
  } catch {
    throw new Error('Voxtral : serveur injoignable (connexion ?).')
  }
  const ms = performance.now() - t0
  let d = {}
  try { d = await res.json() } catch { /* réponse vide */ }
  if (d.restant_mois != null) { vx.restantMois = d.restant_mois; vx.restantJour = d.restant_jour; setVx(vx.state) }
  if (!res.ok) {
    let msg = VX_ERREURS[d.error] || 'Voxtral : erreur ' + res.status + (d.error ? ' (' + d.error + ')' : '')
    if (d.error === 'quota_jour_atteint' && d.restant_mois != null) msg += ' Reste ce mois-ci : ' + d.restant_mois + '.'
    if (d.error === 'non_connecte') setVx('expire')
    throw new Error(msg)
  }
  return { text: d.text || '', ms, serverMs: d.ms, model: d.model, biais: !!d.biais }
}

async function voxtralAndRecord(blob, audioS, note) {
  busy = true
  updateButtons()
  const phrase = Number($('phrase').value)
  const amb = radio('amb')
  try {
    setStatus('Envoi à Voxtral…')
    const r = await runVoxtral(blob, audioS)
    const transS = r.ms / 1000
    addResult({
      kind: 'dictée', engine: 'Voxtral', model: r.model || 'voxtral', variant: '', device: 'en ligne', vocab: r.biais, amb, phrase,
      audioS, loadS: null, transS, serverS: r.serverMs != null ? r.serverMs / 1000 : null, rtf: transS / audioS, text: r.text,
      wer: phrase ? wer(PHRASES[phrase - 1], r.text) : null, note,
    })
    setStatus('Terminé : ' + fmt(transS, 2) + ' s aller-retour pour ' + fmt(audioS) + ' s de son.')
  } catch (e) {
    setStatus(e.message, true)
  } finally {
    busy = false
    updateButtons()
  }
}

const vocabOn = () => $('vocab').checked
function wantedThreads() {
  if (!self.crossOriginIsolated) return 1
  const v = radio('threads')
  if (v === 'auto') return Math.min(navigator.hardwareConcurrency || 1, 8)
  return Math.min(Number(v) || 1, navigator.hardwareConcurrency || 1)
}
function updateThreadsUi() {
  const iso = !!self.crossOriginIsolated
  for (const el of document.querySelectorAll('input[name="threads"]')) el.disabled = !iso && el.value !== '1'
  if (!iso) setRadio('threads', '1')
  $('threadsNote').textContent = iso
    ? 'Auto : ' + Math.min(navigator.hardwareConcurrency || 1, 8) + ' fils sur cet appareil. Changer relance le moteur. Sans effet en WebGPU.'
    : 'Page non isolée : un seul fil possible' + (window.coiNote ? ' (' + window.coiNote + ')' : '') + '.'
}

// ---------- état ----------
let worker = null
let workerReady = null
let loaded = null // { key, model, variant, device, loadS, loadReported }
let loading = null
let busy = false
let lastAudio = null // Float32Array 16 kHz mono
let lastAudioSource = ''
let lastBlob = null // son d'origine (pour Voxtral)
let pending = new Map()
let nextId = 1

function setStatus(text, err) {
  $('status').textContent = text || ''
  $('status').classList.toggle('err', !!err)
}
function updateButtons() {
  $('againBtn').disabled = busy || !lastAudio || engine() === 'webspeech' || (engine() === 'voxtral' && !lastBlob)
  $('aptBtn').disabled = busy || !lastAudio || engine() !== 'whisper'
  $('loadBtn').disabled = busy
  $('talk').disabled = busy && !recording
  $('talk').classList.toggle('busy', busy && !recording)
}

function explainError(text) {
  if (/memory|OOM|alloc|out of bounds|RangeError|Array buffer|bad_alloc|Aborted\(\)|device lost|code \d+/i.test(text)) {
    return 'Mémoire insuffisante pour ce modèle. Essayez un modèle plus petit (tiny ou base) ou la variante q8. (' + text + ')'
  }
  if (/Failed to fetch|NetworkError|network|404|Could not locate/i.test(text)) {
    return 'Téléchargement impossible : vérifiez la connexion, puis réessayez. (' + text + ')'
  }
  return text
}
const isMemoryError = (t) => /memory|OOM|alloc|RangeError|bad_alloc/i.test(t)

function getWorker() {
  if (worker) return workerReady
  worker = new Worker('./worker.js', { type: 'module' })
  workerReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Le moteur ne démarre pas (connexion au CDN ?)')), 60000)
    worker.addEventListener('message', function onReady(e) {
      if (e.data.type === 'ready') { clearTimeout(timer); worker.removeEventListener('message', onReady); resolve() }
    })
    worker.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error(e.message || 'Le moteur ne peut pas démarrer dans ce navigateur')) }, { once: true })
  })
  worker.addEventListener('message', onWorkerMessage)
  worker.addEventListener('error', (e) => {
    // Plantage du worker : souvent un manque de mémoire.
    const text = explainError(e.message || 'Le moteur s\'est arrêté (mémoire insuffisante ?)')
    killWorker()
    for (const p of pending.values()) p.reject(new Error(text))
    pending.clear()
    setStatus(text, true)
  })
  return workerReady
}
function killWorker() {
  try { worker?.terminate() } catch { /* déjà arrêté */ }
  worker = null
  workerReady = null
  loaded = null
  $('loadInfo').textContent = 'Aucun modèle chargé.'
}

function onWorkerMessage(e) {
  const d = e.data
  if (d.type === 'progress') {
    const pct = d.total ? Math.min(100, (d.loaded / d.total) * 100) : 0
    $('prog').classList.remove('hidden')
    $('prog').firstElementChild.style.width = pct.toFixed(0) + '%'
    $('loadInfo').textContent = 'Téléchargement : ' + fmtBytes(d.loaded) + ' sur ' + fmtBytes(d.total) + ' (' + pct.toFixed(0) + ' %)'
  } else if (d.type === 'status') {
    setStatus(d.text)
  } else if (d.type === 'loaded' || d.type === 'freed') {
    pending.get('load')?.resolve(d)
    pending.delete('load')
  } else if (d.type === 'result') {
    pending.get(d.id)?.resolve(d)
    pending.delete(d.id)
  } else if (d.type === 'error') {
    const key = d.op === 'load' || d.op === 'free' ? 'load' : d.id
    pending.get(key)?.reject(new Error(d.text))
    pending.delete(key)
  }
}
function ask(key, msg) {
  return new Promise((resolve, reject) => {
    pending.set(key, { resolve, reject })
    worker.postMessage(msg)
  })
}

async function ensureModel(forceDevice) {
  const modelKey = $('model').value
  const variant = $('variant').value
  const device = forceDevice || resolvedDevice()
  const threads = wantedThreads()
  const key = [modelKey, variant, device, threads].join('|')
  if (loaded && (loaded.key === key || (loaded.wanted === key))) return loaded
  if (loading) await loading
  if (loaded && (loaded.key === key || loaded.wanted === key)) return loaded
  loading = (async () => {
    const m = MODELS[modelKey]
    $('prog').classList.add('hidden')
    $('loadInfo').textContent = 'Démarrage du moteur…'
    setStatus('Chargement de ' + m.label + ' (' + VARIANTS[variant].label.split(' ')[0] + ', ' + device + ')…')
    const t0 = performance.now()
    await getWorker()
    if (loaded) $('loadInfo').textContent = 'Libération du modèle précédent…'
    loaded = null
    const res = await ask('load', { type: 'load', repo: m.repo, revision: m.revision, dtype: VARIANTS[variant].dtype, device, threads })
    const loadS = (performance.now() - t0) / 1000
    loaded = { key: [modelKey, variant, res.device, threads].join('|'), wanted: key, model: modelKey, variant, device: res.device, threads: res.device === 'wasm' ? res.threads : null, loadS, loadReported: false }
    $('prog').classList.add('hidden')
    let info = 'Modèle prêt : ' + m.label.split(' (')[0] + ', ' + variant + ', ' + res.device + (res.device === 'wasm' ? ' (' + res.threads + (res.threads > 1 ? ' fils' : ' fil') + ')' : '') + ', chargé en ' + fmt(loadS) + ' s (téléchargement compris s\'il n\'était pas en cache).'
    if (res.fallback) info += ' WebGPU a échoué, le calcul se fait en WASM. (' + res.fallback + ')'
    $('loadInfo').textContent = info
    setStatus('')
    return loaded
  })()
  try {
    return await loading
  } catch (e) {
    $('prog').classList.add('hidden')
    $('loadInfo').textContent = 'Échec du chargement.'
    throw new Error(explainError(e.message))
  } finally {
    loading = null
  }
}

async function runWhisper(audio, tick) {
  let mdl = await ensureModel()
  const id = nextId++
  try {
    tick?.()
    const r = await ask(id, { type: 'transcribe', id, audio, prompt: vocabOn() ? promptWhisper : null })
    return { ...r, mdl }
  } catch (e) {
    if (mdl.device === 'webgpu' && !isMemoryError(e.message) && worker) {
      setStatus('WebGPU a échoué pendant la transcription, nouvel essai en WASM…')
      mdl = await ensureModel('wasm')
      const id2 = nextId++
      const r = await ask(id2, { type: 'transcribe', id: id2, audio, prompt: vocabOn() ? promptWhisper : null })
      return { ...r, mdl, note: 'WebGPU a échoué, repli WASM' }
    }
    throw new Error(explainError(e.message))
  }
}

// ---------- taux d'erreur ----------
const NUMBERS = { zero: '0', un: '1', une: '1', deux: '2', trois: '3', quatre: '4', cinq: '5', six: '6', sept: '7', huit: '8', neuf: '9', dix: '10', onze: '11', douze: '12', treize: '13', quatorze: '14', quinze: '15', seize: '16', vingt: '20' }
function words(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’'`\-–—]/g, ' ').replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/).filter(Boolean).map((w) => NUMBERS[w] || w)
}
function wer(ref, hyp) {
  const r = words(ref)
  const h = words(hyp)
  if (!r.length) return null
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j)
  for (let i = 1; i <= r.length; i++) {
    const cur = [i]
    for (let j = 1; j <= h.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[h.length] / r.length
}

// ---------- résultats ----------
function addResult(r) {
  if (r.kind !== 'aptitude') {
    const det = nettoyerDetail(r.text || '')
    r.clean = det.texte
    r.fixes = det.corrections.map((c) => c.de + ' → ' + c.vers)
    r.cleanWer = r.phrase ? wer(PHRASES[r.phrase - 1], r.clean) : null
  }
  r.n = (results.at(-1)?.n || 0) + 1
  r.at = new Date().toISOString()
  results.push(r)
  saveResults()
  renderResults()
}
const pct = (x) => (x == null ? '—' : Math.round(x * 100) + ' %')
const calc = (r) => (r.device || '') + (r.threads ? ', ' + r.threads + ' fil' + (r.threads > 1 ? 's' : '') : '')
const vocabTxt = (r) => (r.vocab == null ? '' : r.vocab ? 'oui' : 'non')
function renderResults() {
  const box = $('resList')
  box.innerHTML = ''
  if (!results.length) { box.innerHTML = '<p class="muted">Aucun résultat pour l\'instant.</p>'; return }
  for (const r of [...results].reverse()) {
    const div = document.createElement('div')
    div.className = 'result'
    const head = document.createElement('div')
    const tags = [r.n + '.', r.engine, r.model ? r.model + ' ' + r.variant : '', calc(r),
      r.vocab == null ? '' : r.vocab ? 'vocabulaire du hand' : 'sans vocabulaire', r.amb, r.phrase ? 'phrase ' + r.phrase : 'texte libre'].filter(Boolean)
    for (const t of tags) { const s = document.createElement('span'); s.className = 'tag'; s.textContent = t; head.append(s) }
    div.append(head)
    if (r.kind === 'aptitude') {
      const p = document.createElement('div'); p.className = 'apt ' + verdictClass(r.verdict)
      p.textContent = "Test d'aptitude : " + r.verdict + ' (FTR médian ' + fmt(r.rtf, 2) + ')'
      const m = document.createElement('div'); m.className = 'meta'
      m.textContent = 'Son ' + fmt(r.audioS) + ' s, 3 passages : ' + r.rtfs.map((x) => fmt(x, 2)).join(' / ') + ' (FTR)'
      div.append(p, m)
    } else {
      const grid = document.createElement('div'); grid.className = 'versions'
      const col = (title, text, extra) => {
        const c = document.createElement('div'); c.className = 'ver'
        const h = document.createElement('div'); h.className = 'vh'; h.textContent = title
        const t = document.createElement('div'); t.className = 'text'; t.textContent = text
        c.append(h, t)
        if (extra) c.append(extra)
        grid.append(c)
        return c
      }
      col('Brut' + (r.wer != null ? ' · TEM ' + pct(r.wer) : ''), r.text || '(rien de reconnu)')
      const clean = r.clean ?? nettoyer(r.text || '')
      const fixBox = r.fixes?.length ? document.createElement('div') : null
      if (fixBox) { fixBox.className = 'meta'; fixBox.textContent = 'corrigé : ' + r.fixes.length + (r.fixes.length > 1 ? ' mots' : ' mot') + ' (' + r.fixes.join(' ; ') + ')' }
      col('Nettoyé' + (r.cleanWer != null ? ' · TEM ' + pct(r.cleanWer) : ''), clean || '(vide)', fixBox)
      if (r.ai) {
        const v = document.createElement('div'); v.className = 'meta'; v.textContent = 'Proposition à relire et valider par l\'entraîneur.'
        col('Reformulé (IA sur l\'appareil, ' + fmt(r.aiS, 1) + ' s)', r.ai, v)
      } else if (ai.state !== 'unavailable' && clean) {
        const out = document.createElement('div'); out.className = 'meta'
        const b = document.createElement('button')
        b.textContent = ai.state === 'available' ? 'Reformuler (IA sur l\'appareil)' : 'Télécharger l\'IA de Chrome et reformuler'
        b.addEventListener('click', () => reformulate(r, b, out))
        const box = col('Reformulé (IA sur l\'appareil)', '', null)
        box.lastChild.remove()
        box.append(b, out)
      }
      const m = document.createElement('div'); m.className = 'meta'
      const parts = ['son ' + fmt(r.audioS) + ' s']
      if (r.loadS != null) parts.push('chargement ' + fmt(r.loadS) + ' s')
      if (r.engine === 'Whisper') parts.push('transcription ' + fmt(r.transS, 2) + ' s', 'FTR ' + fmt(r.rtf, 2))
      else if (r.engine === 'Voxtral') parts.push('aller-retour ' + fmt(r.transS, 2) + ' s (dont Mistral ' + fmt(r.serverS, 2) + ' s)', 'FTR ' + fmt(r.rtf, 2) + ' réseau compris')
      else parts.push('délai après relâche ' + fmt(r.transS, 2) + ' s')
      if (r.note) parts.push(r.note)
      m.textContent = parts.join(' · ')
      div.append(grid, m)
    }
    box.append(div)
  }
}
const verdictClass = (v) => (v === 'Apte' ? 'v-ok' : v === 'Limite' ? 'v-warn' : 'v-bad')

function resultsText() {
  const L = []
  L.push('Essai de dictée HandBase, ' + new Date().toLocaleString('fr-FR'))
  L.push('Appareil :')
  for (const [k, v] of dev.lines) L.push('  ' + k + ' : ' + v)
  L.push('  Verdict rapide : ' + dev.verdict)
  L.push('')
  L.push('n° | moteur | modèle | calcul | vocabulaire | ambiance | phrase | son (s) | chargement (s) | transcription (s) | FTR | TEM brut | TEM nettoyé | texte brut')
  L.push('   (dessous : texte nettoyé, puis texte reformulé par l\'IA de Chrome s\'il y en a un)')
  for (const r of results) {
    if (r.kind === 'aptitude') {
      L.push([r.n, "test d'aptitude", r.model + ' ' + r.variant, calc(r), vocabTxt(r), r.amb, r.phrase || 'libre', fmt(r.audioS), '', '', fmt(r.rtf, 2),
        '', '', r.verdict + ' (FTR ' + r.rtfs.map((x) => fmt(x, 2)).join(' / ') + ')'].join(' | '))
    } else {
      L.push([r.n, r.engine, r.model ? r.model + ' ' + r.variant : '', calc(r), vocabTxt(r), r.amb, r.phrase || 'libre', fmt(r.audioS),
        r.loadS != null ? fmt(r.loadS) : '', fmt(r.transS, 2), r.engine === 'Webspeech' || r.rtf == null ? '' : fmt(r.rtf, 2), pct(r.wer), pct(r.cleanWer),
        (r.text || '') + (r.note ? ' [' + r.note + ']' : '') + (r.serverS != null ? ' [Mistral ' + fmt(r.serverS, 2) + ' s]' : '')].join(' | '))
      L.push('   nettoyé : ' + (r.clean ?? nettoyer(r.text || '')) + (r.fixes?.length ? '  [corrigé : ' + r.fixes.join(' ; ') + ']' : ''))
      if (r.ai) L.push('   reformulé (' + r.aiApi + ', ' + fmt(r.aiS, 1) + ' s, ouverture ' + fmt(r.aiCreateS, 1) + ' s) : ' + r.ai.replace(/\s*\n\s*/g, ' / '))
    }
  }
  return L.join('\n')
}

// ---------- son ----------
async function toMono16k(arrayBuffer) {
  const AC = window.AudioContext || window.webkitAudioContext
  const ctx = new AC()
  let buf
  try { buf = await ctx.decodeAudioData(arrayBuffer) } finally { ctx.close?.() }
  const len = Math.max(1, Math.ceil(buf.duration * 16000))
  const off = new OfflineAudioContext(1, len, 16000)
  const src = off.createBufferSource()
  src.buffer = buf
  src.connect(off.destination)
  src.start()
  const out = await off.startRendering()
  return new Float32Array(out.getChannelData(0))
}

function micErrorText(e) {
  if (!window.isSecureContext) return 'Le micro demande une adresse https.'
  if (e.name === 'NotAllowedError' || e.name === 'SecurityError') return 'Micro refusé. Autorisez le micro pour ce site (icône à gauche de l\'adresse), puis rechargez la page.'
  if (e.name === 'NotFoundError') return 'Aucun micro trouvé sur cet appareil.'
  if (e.name === 'NotReadableError') return 'Le micro est déjà utilisé par une autre application.'
  return 'Micro indisponible : ' + (e.message || e.name)
}

let recording = false
let stopWanted = false
let rec = null // { stream, recorder, chunks, t0 } ou { speech, t0, ... }

async function startCapture() {
  if (recording || busy) return
  recording = true
  stopWanted = false
  $('talk').classList.add('rec')
  $('talk').textContent = 'Ouverture du micro…'
  if (engine() === 'webspeech') return startSpeech()
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('API absente'), { name: 'NotSupportedError' })
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const recorder = new MediaRecorder(stream)
    const chunks = []
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    rec = { stream, recorder, chunks, t0: performance.now() }
    recorder.onstop = () => onRecorded(rec)
    recorder.start()
    $('talk').textContent = modeHold() ? 'Parlez… relâchez pour finir' : 'Parlez… touchez pour finir'
    setStatus('Enregistrement en cours')
    if (stopWanted) stopCapture()
  } catch (e) {
    recording = false
    resetTalk()
    setStatus(micErrorText(e), true)
  }
}
function stopCapture() {
  if (!recording) return
  if (!rec) { stopWanted = true; return }
  if (rec.speech) { stopSpeech(); return }
  if (rec.recorder.state !== 'inactive') rec.recorder.stop()
}
const modeHold = () => radio('mode') === 'hold'
function resetTalk() {
  $('talk').classList.remove('rec')
  $('talk').textContent = modeHold() ? 'Maintenir pour parler' : 'Toucher pour parler'
}

async function onRecorded(r) {
  r.stream.getTracks().forEach((t) => t.stop())
  rec = null
  recording = false
  resetTalk()
  const blob = new Blob(r.chunks, { type: r.recorder.mimeType || 'audio/webm' })
  let audio
  try {
    audio = await toMono16k(await blob.arrayBuffer())
  } catch (e) {
    setStatus('Son illisible : ' + (e.message || e), true)
    return
  }
  if (audio.length < 0.3 * 16000) { setStatus(modeHold() ? 'Trop court : maintenez le bouton pendant que vous parlez.' : 'Trop court.', true); return }
  lastAudio = audio
  lastBlob = blob
  lastAudioSource = 'micro'
  updateButtons()
  if (engine() === 'voxtral') await voxtralAndRecord(blob, audio.length / 16000)
  else await transcribeAndRecord(audio)
}

async function transcribeAndRecord(audio, note) {
  busy = true
  updateButtons()
  const audioS = audio.length / 16000
  const phrase = Number($('phrase').value)
  const amb = radio('amb')
  try {
    const startT = performance.now()
    let timer
    const r = await runWhisper(audio, () => {
      timer = setInterval(() => setStatus('Transcription… ' + fmt((performance.now() - startT) / 1000) + ' s'), 250)
      setStatus('Transcription…')
    }).finally(() => clearInterval(timer))
    const transS = r.ms / 1000
    const firstLoad = !r.mdl.loadReported
    r.mdl.loadReported = true
    addResult({
      kind: 'dictée', engine: 'Whisper', model: r.mdl.model, variant: r.mdl.variant, device: r.mdl.device, threads: r.mdl.threads, vocab: !!r.prompted, promptTokens: r.promptTokens, amb, phrase,
      audioS, loadS: firstLoad ? r.mdl.loadS : null, transS, rtf: transS / audioS, text: r.text,
      wer: phrase ? wer(PHRASES[phrase - 1], r.text) : null, note: [note, r.note].filter(Boolean).join(', ') || undefined,
    })
    setStatus('Terminé : ' + fmt(transS, 2) + ' s pour ' + fmt(audioS) + ' s de son.')
  } catch (e) {
    setStatus(e.message, true)
  } finally {
    busy = false
    updateButtons()
  }
}

// ---------- dictée du navigateur ----------
function startSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  const s = new SR()
  s.lang = 'fr-FR'
  s.continuous = true
  s.interimResults = true
  s.maxAlternatives = 1
  const st = { speech: s, t0: 0, tRelease: 0, finals: [], interim: '', error: '' }
  rec = st
  s.onstart = () => {
    st.t0 = performance.now()
    $('talk').textContent = modeHold() ? 'Parlez… relâchez pour finir' : 'Parlez… touchez pour finir'
    setStatus('Écoute en cours')
    if (stopWanted) stopSpeech()
  }
  s.onresult = (ev) => {
    st.finals = []
    st.interim = ''
    for (let i = 0; i < ev.results.length; i++) {
      const t = ev.results[i][0].transcript.trim()
      if (ev.results[i].isFinal) st.finals.push(t)
      else st.interim += ' ' + t
    }
    setStatus('Entendu : ' + joinFinals(st.finals) + ' ' + st.interim)
  }
  s.onerror = (ev) => { st.error = ev.error }
  s.onend = () => onSpeechEnd(st)
  try { s.start() } catch (e) { st.error = e.message; onSpeechEnd(st) }
}
// Chrome Android répète parfois le texte déjà reconnu dans chaque résultat final.
function joinFinals(list) {
  let acc = ''
  for (const t of list) {
    if (!acc || t.toLowerCase().startsWith(acc.toLowerCase())) acc = t
    else if (!acc.toLowerCase().endsWith(t.toLowerCase())) acc += ' ' + t
  }
  return acc.trim()
}
function stopSpeech() {
  if (!rec?.speech) return
  rec.tRelease = performance.now()
  $('talk').textContent = 'Attente du résultat…'
  try { rec.speech.stop() } catch { /* déjà arrêté */ }
}
function onSpeechEnd(st) {
  rec = null
  recording = false
  resetTalk()
  const tEnd = performance.now()
  const tRelease = st.tRelease || tEnd
  const text = (joinFinals(st.finals) + ' ' + (st.finals.length ? '' : st.interim)).trim()
  if (st.error && !text) {
    const map = {
      'not-allowed': 'Micro ou dictée refusés. Autorisez le micro pour ce site, puis rechargez la page.',
      'service-not-allowed': 'Dictée du navigateur refusée ou indisponible sur cet appareil.',
      'no-speech': 'Aucune parole entendue.',
      network: 'La dictée du navigateur a besoin d\'une connexion.',
      'audio-capture': 'Aucun micro disponible.',
      'language-not-supported': 'Le français n\'est pas pris en charge par cette dictée.',
    }
    setStatus(map[st.error] || 'Erreur de la dictée du navigateur : ' + st.error, true)
    return
  }
  const phrase = Number($('phrase').value)
  const audioS = st.t0 ? (tRelease - st.t0) / 1000 : null
  addResult({
    kind: 'dictée', engine: 'Dictée navigateur', model: '', variant: '', device: 'service en ligne', amb: radio('amb'), phrase,
    audioS, loadS: null, transS: (tEnd - tRelease) / 1000, rtf: null, text, wer: phrase ? wer(PHRASES[phrase - 1], text) : null,
    note: st.tRelease ? undefined : 'arrêt par le navigateur avant la fin',
  })
  setStatus('Terminé.')
}

// ---------- test d'aptitude ----------
async function aptitude() {
  if (!lastAudio || busy) return
  busy = true
  updateButtons()
  const audio = lastAudio
  const audioS = audio.length / 16000
  $('aptOut').textContent = ''
  try {
    const rtfs = []
    let mdl
    let aptVocab = false
    for (let i = 1; i <= 3; i++) {
      setStatus("Test d'aptitude : passage " + i + ' sur 3…')
      $('aptOut').textContent = 'Passage ' + i + ' sur 3…'
      const r = await runWhisper(audio)
      mdl = r.mdl
      aptVocab = !!r.prompted
      rtfs.push(r.ms / 1000 / audioS)
    }
    const med = [...rtfs].sort((a, b) => a - b)[1]
    const verdict = med < 1.5 ? 'Apte' : med < 3 ? 'Limite' : 'Trop lent'
    $('aptOut').innerHTML = ''
    const p = document.createElement('div'); p.className = 'apt ' + verdictClass(verdict)
    p.textContent = verdict + ' : FTR médian ' + fmt(med, 2) + ' (' + mdl.model + ' ' + mdl.variant + ', ' + mdl.device + ', son de ' + fmt(audioS) + ' s)'
    $('aptOut').append(p)
    if (audioS < 5) {
      const n = document.createElement('p'); n.className = 'muted'; n.textContent = 'Son court : refaites-le avec une phrase d\'au moins 5 secondes pour une mesure fiable.'
      $('aptOut').append(n)
    }
    addResult({ kind: 'aptitude', engine: 'Whisper', model: mdl.model, variant: mdl.variant, device: mdl.device, threads: mdl.threads, vocab: aptVocab, amb: radio('amb'),
      phrase: Number($('phrase').value), audioS, rtf: med, rtfs, verdict })
    setStatus('')
  } catch (e) {
    $('aptOut').textContent = ''
    setStatus(e.message, true)
  } finally {
    busy = false
    updateButtons()
  }
}

// ---------- branchements ----------
function bind() {
  const talk = $('talk')
  talk.addEventListener('contextmenu', (e) => e.preventDefault())
  talk.addEventListener('pointerdown', (e) => {
    if (e.button && e.button !== 0) return
    e.preventDefault()
    if (modeHold()) {
      try { talk.setPointerCapture(e.pointerId) } catch { /* sans importance */ }
      startCapture()
    } else if (recording) stopCapture()
    else startCapture()
  })
  const release = () => { if (modeHold() && recording) stopCapture() }
  talk.addEventListener('pointerup', release)
  talk.addEventListener('pointercancel', release)
  talk.addEventListener('keydown', (e) => {
    if ((e.key !== ' ' && e.key !== 'Enter') || e.repeat) return
    e.preventDefault()
    if (modeHold() || !recording) startCapture()
    else stopCapture()
  })
  talk.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') release() })

  $('model').addEventListener('change', () => { prefs.model = $('model').value; fillVariants(false); prefs.variant = $('variant').value; savePrefs() })
  $('variant').addEventListener('change', () => { prefs.variant = $('variant').value; updateSizeNote(); savePrefs() })
  for (const el of document.querySelectorAll('input[name="device"]')) {
    el.addEventListener('change', () => { prefs.device = radio('device'); fillVariants(false); prefs.variant = $('variant').value; savePrefs() })
  }
  for (const el of document.querySelectorAll('input[name="engine"]')) el.addEventListener('change', () => { prefs.engine = engine(); savePrefs(); updateEngineUi() })
  for (const el of document.querySelectorAll('input[name="amb"]')) el.addEventListener('change', () => { prefs.amb = radio('amb'); savePrefs() })
  for (const el of document.querySelectorAll('input[name="mode"]')) el.addEventListener('change', () => { prefs.mode = radio('mode'); savePrefs(); resetTalk() })
  for (const el of document.querySelectorAll('input[name="threads"]')) {
    el.addEventListener('change', () => { prefs.threads = radio('threads'); savePrefs(); killWorker() })
  }
  $('vocab').addEventListener('change', () => { prefs.vocab = vocabOn(); savePrefs() })
  $('phrase').addEventListener('change', () => { prefs.phrase = Number($('phrase').value); savePrefs(); showPhrase() })

  $('loadBtn').addEventListener('click', async () => {
    busy = true; updateButtons()
    try { await ensureModel() } catch (e) { setStatus(e.message, true) } finally { busy = false; updateButtons() }
  })
  $('clearCacheBtn').addEventListener('click', async () => {
    if (!confirm('Supprimer les modèles téléchargés par cette page ? Ils seront retéléchargés au prochain essai.')) return
    killWorker()
    try {
      const ok = await caches.delete('transformers-cache')
      setStatus(ok ? 'Modèles supprimés du cache.' : 'Aucun modèle en cache.')
    } catch (e) { setStatus('Suppression impossible : ' + e.message, true) }
    detectDevice()
  })
  $('againBtn').addEventListener('click', () => {
    if (!lastAudio) return
    const note = lastAudioSource === 'fichier' ? 'fichier audio' : 'même son'
    if (engine() === 'voxtral') { if (lastBlob) voxtralAndRecord(lastBlob, lastAudio.length / 16000, note) }
    else transcribeAndRecord(lastAudio, note)
  })
  $('aptBtn').addEventListener('click', aptitude)
  $('fileIn').addEventListener('change', async () => {
    const f = $('fileIn').files[0]
    if (!f) return
    try {
      lastAudio = await toMono16k(await f.arrayBuffer())
      lastBlob = f
      lastAudioSource = 'fichier'
      updateButtons()
      if (engine() === 'webspeech') { setStatus('Fichier chargé. Choisissez Whisper ou Voxtral pour le transcrire.'); return }
      if (engine() === 'voxtral') await voxtralAndRecord(f, lastAudio.length / 16000, 'fichier audio')
      else await transcribeAndRecord(lastAudio, 'fichier audio')
    } catch (e) {
      setStatus('Fichier illisible : ' + (e.message || e), true)
    } finally {
      $('fileIn').value = ''
    }
  })
  $('copyBtn').addEventListener('click', async () => {
    const text = resultsText()
    let ok = false
    try { await navigator.clipboard.writeText(text); ok = true } catch { /* repli ci-dessous */ }
    if (!ok) {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.append(ta); ta.select()
      try { ok = document.execCommand('copy') } catch { ok = false }
      ta.remove()
    }
    $('copyMsg').textContent = ok ? 'Résultats copiés : collez-les dans la conversation.' : 'Copie impossible sur ce navigateur.'
  })
  $('clearBtn').addEventListener('click', () => {
    if (!confirm('Effacer tous les résultats de cette page ?')) return
    results = []
    saveResults()
    renderResults()
    $('aptOut').textContent = ''
  })
}

async function init() {
  fillPhrases()
  setRadio('engine', prefs.engine)
  setRadio('device', prefs.device)
  setRadio('amb', prefs.amb)
  setRadio('mode', prefs.mode)
  $('vocab').checked = prefs.vocab !== false
  resetTalk()
  bind()
  renderResults()
  await detectDevice()
  renderResults() // avec le bouton « Reformuler » si l'IA de Chrome est là
  detectVoxtral()
  if (!dev.webSpeech) {
    $('wsLabel').classList.add('hidden')
    setRadio('engine', 'whisper')
  }
  fillModels()
  fillVariants(true)
  setRadio('threads', prefs.threads || 'auto')
  updateThreadsUi()
  updateEngineUi()
  $('loadInfo').textContent = 'Aucun modèle chargé. Il se charge aussi tout seul à la première dictée.'
}

// Accès pour les essais techniques (son synthétique), sans effet sur l'usage normal.
window.essaiDictee = {
  transcribe: (samples) => { lastAudio = samples; lastAudioSource = 'fichier'; updateButtons(); return transcribeAndRecord(samples, 'son de test') },
  wer,
  nettoyer,
  texte: () => resultsText(),
  // Essai de l'interface Voxtral contre un faux serveur local (console seulement).
  voxtralLocal: async (url) => { const s = readSession(); vx.url = url; vx.token = s?.token || 'essai'; const r = await fetch(url, { headers: { Authorization: 'Bearer ' + vx.token } }); const d = await r.json(); vx.restantMois = d.restant_mois; vx.restantJour = d.restant_jour; setVx('ok') },
  voxtral: (samples, blob) => { lastAudio = samples; lastBlob = blob; return voxtralAndRecord(blob, samples.length / 16000, 'son de test') },
}

init()
