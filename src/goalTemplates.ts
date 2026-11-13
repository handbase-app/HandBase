import { cleanObjectiveText, cleanShortText, cleanVideoUrl, OBJ_STEP_TEXT_MAX, OBJ_STEPS_MAX, type WorkObjective } from './objectives'

/*
 * Modèles d'objectifs (04/11) : réglés par l'installation (administrateurs, Réglages → « Modèles d'objectifs »). Un modèle =
 * un titre, des étapes (8 au plus), des liens vidéo facultatifs. Sur la fiche, « + Depuis un modèle » ajoute l'objectif avec
 * ses étapes (nouveaux identifiants, rien de coché), puis on l'adapte au jeune ; le modèle, lui, ne change pas.
 * Stockage : une ligne de la configuration de l'installation (hb_config, clé « modeles_objectifs » ; 044 l'accepte comme
 * toute clé `^[a-z][a-z0-9_]{0,39}$`, écriture des administrateurs seulement). Aucun modèle livré : la démonstration seule en
 * pose quelques-uns, génériques (DEMO_TEMPLATES), sur l'appareil.
 * Fichier pur : testé par tools/test-objectifs-etapes.ts.
 */

export const GOAL_TEMPLATES_KEY = 'modeles_objectifs'
/** Modèles gardés, au plus. */
export const TEMPLATES_MAX = 30

export interface GoalTemplate {
  id: string
  text: string
  video?: string
  steps: { text: string; video?: string }[]
}

/** Valeur lue (forme abîmée, ancienne) → modèles propres : titre obligatoire, étapes vides retirées, liens http(s) seulement. */
export function cleanTemplates(raw: unknown): GoalTemplate[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { templates?: unknown }).templates) ? (raw as { templates: unknown[] }).templates : []
  const out: GoalTemplate[] = []
  const seen = new Set<string>()
  for (const r of list) {
    if (out.length >= TEMPLATES_MAX) break
    if (!r || typeof r !== 'object') continue
    const x = r as Record<string, unknown>
    const text = cleanObjectiveText(x.text)
    const id = typeof x.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x.id) ? x.id : ''
    if (!text || !id || seen.has(id)) continue
    seen.add(id)
    const steps = (Array.isArray(x.steps) ? x.steps : [])
      .map((s) => {
        const y = s && typeof s === 'object' ? (s as Record<string, unknown>) : {}
        const t = cleanShortText(y.text, OBJ_STEP_TEXT_MAX)
        const v = cleanVideoUrl(y.video)
        return t ? { text: t, ...(v ? { video: v } : {}) } : null
      })
      .filter((s): s is { text: string; video?: string } => !!s)
      .slice(0, OBJ_STEPS_MAX)
    const video = cleanVideoUrl(x.video)
    out.push({ id, text, ...(video ? { video } : {}), steps })
  }
  return out
}

/** Modèles de l'installation (ligne de configuration non supprimée). Valeur `{ demo: true, templates }` : ceux de la démo. */
export function templatesOf(rows: readonly { id: string; key?: string; value: unknown; deleted?: boolean }[]): GoalTemplate[] {
  return cleanTemplates(rows.find((r) => !r.deleted && (r.key ?? r.id) === GOAL_TEMPLATES_KEY)?.value)
}

/** La ligne de configuration est-elle celle de la démonstration (posée sur l'appareil, jamais envoyée) ? */
export const isDemoTemplatesValue = (v: unknown) => !!v && typeof v === 'object' && (v as { demo?: unknown }).demo === true

/** Objectif « en cours » tiré d'un modèle : ses étapes avec de nouveaux identifiants, rien de coché. */
export function objectiveFromTemplate(t: GoalTemplate, newId: () => string): WorkObjective {
  return {
    id: newId(),
    text: t.text,
    status: 'en_cours',
    ...(t.video ? { video: t.video } : {}),
    ...(t.steps.length ? { steps: t.steps.map((s) => ({ id: newId(), text: s.text, ...(s.video ? { video: s.video } : {}) })) } : {}),
  }
}

/**
 * Modèles de la démonstration : génériques (préparation physique et gestes de base, rien de fédéral), liens vidéo vers des
 * pages génériques. Posés par le chargement de la démo s'il n'y a pas déjà des modèles.
 */
export const DEMO_TEMPLATES: GoalTemplate[] = [
  {
    id: 'demo-modele-detente',
    text: 'Gagner en détente',
    steps: [
      { text: 'Corde à sauter 10 min par jour' },
      { text: 'Sauts sur banc : 3 séries, 2 fois par semaine' },
      { text: 'Test de détente dans 6 semaines' },
    ],
  },
  {
    id: 'demo-modele-vitesse',
    text: 'Gagner en vitesse sur les premiers appuis',
    steps: [
      { text: 'Échelle de rythme : 10 min avant chaque entraînement' },
      { text: 'Départs arrêtés sur 10 m : 6 répétitions, 2 fois par semaine' },
      { text: 'Refaire le sprint 10 m dans un mois' },
    ],
  },
  {
    id: 'demo-modele-communication',
    text: 'Mieux communiquer en défense',
    steps: [{ text: 'Annoncer son joueur à chaque attaque adverse' }, { text: 'Prévenir le partenaire à chaque écran' }, { text: 'Faire le point avec le staff après le prochain match' }],
  },
  {
    id: 'demo-modele-souplesse',
    text: 'Gagner en souplesse',
    video: 'https://www.youtube.com/results?search_query=etirements+sportifs',
    steps: [{ text: 'Étirements 10 min après chaque séance' }, { text: 'Gainage : 3 séries de 30 s, 3 fois par semaine' }],
  },
]
