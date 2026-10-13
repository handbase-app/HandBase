// Essai de dictée : Whisper dans le navigateur (transformers.js), exécuté dans un worker
// pour que la page reste réactive pendant le chargement et la transcription.
// Aucun son n'est envoyé ni enregistré : il reste en mémoire, ici et dans la page.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js'

env.allowLocalModels = false // pas de recherche de modèles sur le site lui-même
env.useBrowserCache = true // modèles gardés dans le cache du navigateur (« transformers-cache »)

let pipe = null
let pipeKey = ''

function post(type, data) {
  self.postMessage({ type, ...data })
}

function errText(e) {
  if (!e) return 'Erreur inconnue'
  if (typeof e === 'string') return e
  if (typeof e === 'number') return 'Erreur interne du moteur (code ' + e + ')'
  return (e.name && e.name !== 'Error' ? e.name + ' : ' : '') + (e.message || String(e))
}

async function freePipe() {
  if (pipe) {
    try { await pipe.dispose() } catch { /* déjà libéré */ }
  }
  pipe = null
  pipeKey = ''
}

async function create(msg, device) {
  const files = {}
  const t0 = performance.now()
  const p = await pipeline('automatic-speech-recognition', msg.repo, {
    revision: msg.revision,
    device,
    dtype: msg.dtype,
    progress_callback: (ev) => {
      if (ev.status === 'progress' && ev.file) {
        files[ev.file] = { loaded: ev.loaded || 0, total: ev.total || 0 }
        let loaded = 0
        let total = 0
        for (const f of Object.values(files)) { loaded += f.loaded; total += f.total }
        post('progress', { loaded, total, file: ev.file })
      }
    },
  })
  return { p, ms: performance.now() - t0 }
}

async function load(msg) {
  const key = [msg.repo, msg.revision, JSON.stringify(msg.dtype), msg.device].join('|')
  if (pipe && pipeKey === key) {
    post('loaded', { ms: 0, device: msg.device, cached: true })
    return
  }
  await freePipe()
  let device = msg.device
  let fallback = ''
  let res
  try {
    res = await create(msg, device)
  } catch (e) {
    if (device !== 'webgpu') throw e
    fallback = errText(e)
    device = 'wasm'
    post('status', { text: 'WebGPU a échoué, nouvel essai en WASM…' })
    res = await create(msg, device)
  }
  pipe = res.p
  pipeKey = [msg.repo, msg.revision, JSON.stringify(msg.dtype), device].join('|')
  post('loaded', { ms: res.ms, device, fallback })
}

async function transcribe(msg) {
  if (!pipe) throw new Error('Aucun modèle chargé')
  const audio = msg.audio
  const long = audio.length > 30 * 16000
  const t0 = performance.now()
  const out = await pipe(audio, {
    language: 'french',
    task: 'transcribe',
    ...(long ? { chunk_length_s: 30, stride_length_s: 5 } : {}),
  })
  const ms = performance.now() - t0
  const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text || '').trim()
  post('result', { id: msg.id, text, ms })
}

self.onmessage = async (e) => {
  const msg = e.data
  try {
    if (msg.type === 'load') await load(msg)
    else if (msg.type === 'transcribe') await transcribe(msg)
    else if (msg.type === 'free') { await freePipe(); post('freed', {}) }
  } catch (err) {
    post('error', { op: msg.type, id: msg.id, text: errText(err) })
  }
}

post('ready', {})
