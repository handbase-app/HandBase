import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BackButton } from '../backNav'
import { remplacerCodes, type IndexFiches, type Morceau } from '../codesJoueurs'
import { plural } from '../db'
import { lireRapport, retirerRapport, useNomsParCode, type Lecture } from '../rapports'
import { inlineText, parseMarkdown, type Bloc, type Inline } from '../rapportMarkdown'
import { ask } from '../components/Confirm'
import { flash } from '../components/ItemMenu'
import { appName } from '../appBrand'

/*
 * Rapport en codes (/rapport/:id, projet « Serveur MCP Nextar ») : l'IA du coach a rédigé un rapport avec les CODES des
 * joueurs (outil nextar_rapport) ; cette page le lit (son auteur seul : supabase/068_rapports.sql) et remplace chaque code par
 * le nom du joueur SUR L'APPAREIL, à partir de ses propres fiches (src/rapports.ts, src/codesJoueurs.ts). Les noms ne passent
 * jamais par le serveur MCP ni par l'IA. Un code hors des fiches de l'appareil reste un code ; un code partagé par deux fiches
 * ou mal recopié aussi (jamais un nom au hasard).
 * Mise en page sobre, noir sur blanc ; « Imprimer / PDF » : impression du navigateur (comme src/pages/GroupReport.tsx).
 * Le Markdown est dessiné par la page (src/rapportMarkdown.ts) : aucun HTML du rapport n'est injecté.
 */

interface Compte {
  noms: number
  inconnus: number
  partages: number
  invalides: number
}

function compter(blocs: Bloc[], idx: IndexFiches): Compte {
  const c: Compte = { noms: 0, inconnus: 0, partages: 0, invalides: 0 }
  const vus = new Set<string>()
  const visit = (xs: Inline[]) => {
    for (const x of xs) {
      if (x.k === 't')
        for (const m of remplacerCodes(x.t, idx.index, idx.nomDe)) {
          if (m.k === 'texte' || vus.has(m.code)) continue
          vus.add(m.code)
          if (m.k === 'joueur') c.noms++
          else if (m.raison === 'inconnu') c.inconnus++
          else if (m.raison === 'partage') c.partages++
          else c.invalides++
        }
      else if (x.k !== 'code') visit(x.c)
    }
  }
  for (const b of blocs) {
    if (b.k === 'h' || b.k === 'p' || b.k === 'quote') visit(b.c)
    else if (b.k === 'ul' || b.k === 'ol') b.items.forEach((it) => visit(it.c))
    else if (b.k === 'table') {
      b.head.forEach(visit)
      b.rows.forEach((r) => r.forEach(visit))
    }
  }
  return c
}

function MorceauVu({ m, idx }: { m: Morceau; idx: IndexFiches }) {
  if (m.k === 'texte') return <>{m.t}</>
  if (m.k === 'joueur') {
    const fiche = idx.ficheDe(m.id) ?? m.id
    return (
      <Link to={`/joueurs/${fiche}`} className="font-bold text-inherit underline decoration-neutral-300 underline-offset-2 print:no-underline" title={m.code}>
        {m.nom}
      </Link>
    )
  }
  const why = m.raison === 'inconnu' ? 'code hors des fiches de cet appareil' : m.raison === 'partage' ? `code partagé par ${m.fiches} fiches : à vérifier` : 'code mal recopié (signe de contrôle faux)'
  return (
    <span className="rounded bg-neutral-100 px-1 font-mono text-[0.92em] text-neutral-700 print:bg-transparent" title={why}>
      {m.code}
      {m.raison !== 'inconnu' && <span className="ml-0.5 text-amber-700">{m.raison === 'partage' ? ` (${m.fiches} fiches)` : ' ?'}</span>}
    </span>
  )
}

function InlineVu({ c, idx }: { c: Inline[]; idx: IndexFiches }): ReactNode {
  return c.map((x, i) => {
    if (x.k === 't') return remplacerCodes(x.t, idx.index, idx.nomDe).map((m, j) => <MorceauVu key={`${i}-${j}`} m={m} idx={idx} />)
    if (x.k === 'b') return <strong key={i}>{InlineVu({ c: x.c, idx })}</strong>
    if (x.k === 'i') return <em key={i}>{InlineVu({ c: x.c, idx })}</em>
    if (x.k === 'code')
      return (
        <code key={i} className="rounded bg-neutral-100 px-1 font-mono text-[0.92em]">
          {x.t}
        </code>
      )
    return (
      <a key={i} href={x.href} target="_blank" rel="noopener noreferrer" className="underline">
        {InlineVu({ c: x.c, idx })}
      </a>
    )
  })
}

function BlocVu({ b, idx }: { b: Bloc; idx: IndexFiches }) {
  switch (b.k) {
    case 'h': {
      const cls = ['mt-1 text-xl font-extrabold leading-tight', 'mt-4 border-b border-neutral-300 pb-1 text-base font-extrabold', 'mt-3 text-sm font-extrabold', 'mt-2 text-[13px] font-bold'][b.level - 1]
      const Tag = (['h2', 'h3', 'h4', 'h5'] as const)[b.level - 1]
      return <Tag className={`${cls} break-after-avoid`}>{InlineVu({ c: b.c, idx })}</Tag>
    }
    case 'p':
      return <p className="leading-relaxed">{InlineVu({ c: b.c, idx })}</p>
    case 'quote':
      return <blockquote className="border-l-4 border-neutral-300 pl-3 text-neutral-700 italic">{InlineVu({ c: b.c, idx })}</blockquote>
    case 'hr':
      return <hr className="border-neutral-300" />
    case 'code':
      return <pre className="overflow-x-auto rounded bg-neutral-100 p-2 font-mono text-[11px] whitespace-pre-wrap">{b.t}</pre>
    case 'ul':
    case 'ol': {
      const Tag = b.k
      return (
        <Tag className={`flex flex-col gap-0.5 pl-5 ${b.k === 'ul' ? 'list-disc' : 'list-decimal'}`} start={b.k === 'ol' ? b.start : undefined}>
          {b.items.map((it, i) => (
            <li key={i} className={it.depth ? 'ml-5' : ''}>
              {InlineVu({ c: it.c, idx })}
            </li>
          ))}
        </Tag>
      )
    }
    case 'table':
      return (
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {b.head.map((h, i) => (
                  <th key={i} className="border-b border-neutral-500 px-1.5 py-1 text-left align-bottom font-bold">
                    {InlineVu({ c: h, idx })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i} className="break-inside-avoid">
                  {r.map((cell, j) => (
                    <td key={j} className="border-b border-neutral-200 px-1.5 py-1 align-top">
                      {InlineVu({ c: cell, idx })}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

const dateLongue = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

const MESSAGES: Record<Exclude<Lecture['etat'], 'ok'>, string> = {
  introuvable: 'Ce rapport est introuvable : il a expiré (30 jours), a été retiré, ou il appartient à un autre compte.',
  absent: 'Les rapports ne sont pas encore installés sur le serveur (script 068) : rien à afficher pour l’instant.',
  'hors-ligne': 'Pas de réseau : le rapport se lit sur le serveur. Réessaie une fois connecté.',
  'sans-serveur': 'Les rapports préparés avec Claude demandent la version connectée de l’appli (avec un compte).',
  erreur: 'Le rapport n’a pas pu être lu.',
}

export default function RapportPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const [lecture, setLecture] = useState<Lecture | null>(null)
  const idx = useNomsParCode()
  useEffect(() => {
    let alive = true
    setLecture(null)
    void lireRapport(id).then((l) => alive && setLecture(l))
    return () => {
      alive = false
    }
  }, [id])
  const blocs = useMemo(() => (lecture?.etat === 'ok' ? parseMarkdown(lecture.rapport.contenu) : []), [lecture])
  const compte = useMemo(() => (idx && blocs.length ? compter(blocs, idx) : null), [blocs, idx])
  const titre = lecture?.etat === 'ok' ? lecture.rapport.titre : 'Rapport'
  useEffect(() => {
    const before = document.title
    document.title = `${titre} · ${appName()}`
    return () => {
      document.title = before
    }
  }, [titre])

  const retirer = async () => {
    if (lecture?.etat !== 'ok') return
    if (!(await ask(`Retirer « ${lecture.rapport.titre} » ? Le lien donné à Claude ne mènera plus à rien.`, { ok: 'Retirer', focusCancel: true }))) return
    const err = await retirerRapport(lecture.rapport.id)
    if (err) flash(`Pas retiré : ${err}`)
    else {
      flash('Rapport retiré.')
      nav('/parametres', { replace: true })
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <div className="no-print flex flex-col gap-3">
        <BackButton fallback="/" label="ACCUEIL" className="self-start" />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <h1 className="min-w-0 flex-1 text-lg font-extrabold break-words">{titre}</h1>
          {lecture?.etat === 'ok' && (
            <div className="flex gap-2">
              <button type="button" className="btn-primary min-h-11 flex-1 px-4 text-xs sm:flex-none" onClick={() => window.print()}>
                Imprimer / PDF
              </button>
              <button type="button" className="btn-ghost min-h-11 px-4 text-xs" onClick={() => void retirer()}>
                Retirer
              </button>
            </div>
          )}
        </div>
        {lecture?.etat === 'ok' && (
          <p className="text-[11px] text-muted">
            Rédigé par Claude avec des codes ; les noms ont été remis par cet appareil, à partir de ses fiches
            {compte ? ` : ${plural(compte.noms, 'joueur retrouvé', 'joueurs retrouvés')}` : ''}
            {compte?.inconnus ? `, ${plural(compte.inconnus, 'code hors des fiches de cet appareil', 'codes hors des fiches de cet appareil')}` : ''}
            {compte?.partages ? `, ${plural(compte.partages, 'code partagé', 'codes partagés')} (à vérifier)` : ''}
            {compte?.invalides ? `, ${plural(compte.invalides, 'code mal recopié', 'codes mal recopiés')}` : ''}. Rien n’est envoyé : pour un PDF, choisis « Enregistrer au format PDF »
            comme imprimante. Gardé jusqu’au {dateLongue(lecture.rapport.expires_at)}.
          </p>
        )}
      </div>

      {!lecture || (lecture.etat === 'ok' && !idx) ? (
        <p className="py-16 text-center text-sm text-muted">Chargement…</p>
      ) : lecture.etat !== 'ok' ? (
        <div className="card flex flex-col items-start gap-2 p-4">
          <p className="text-sm">{MESSAGES[lecture.etat]}</p>
          {lecture.etat === 'erreur' && <p className="text-[11px] text-muted">{lecture.message}</p>}
          <Link to="/" className="btn-ghost min-h-11 text-xs">
            Retour à l’accueil
          </Link>
        </div>
      ) : (
        <article className="rapport-mcp flex flex-col gap-2.5 rounded-lg bg-white p-4 text-[13px] text-neutral-900 shadow sm:p-8 print:rounded-none print:p-0 print:shadow-none">
          <header className="mb-1 border-b-2 border-neutral-900 pb-2">
            <div className="text-[11px] font-bold tracking-wide text-neutral-500 uppercase">{appName()}</div>
            {!(blocs[0]?.k === 'h' && blocs[0].level === 1 && inlineText(blocs[0].c).trim() === titre.trim()) && <h2 className="mt-0.5 text-xl font-extrabold leading-tight">{titre}</h2>}
            <div className="mt-0.5 text-[11px] text-neutral-500">Préparé avec Claude le {dateLongue(lecture.rapport.created_at)}</div>
          </header>
          {blocs.map((b, i) => (
            <BlocVu key={i} b={b} idx={idx!} />
          ))}
        </article>
      )}
    </div>
  )
}
