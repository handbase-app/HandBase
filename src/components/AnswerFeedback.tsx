import { useState } from 'react'
import { canLogQuestion, hasAvis, logAvis } from '../questionLog'
import { MAX_COMMENT, VERDICT_LABEL, VERDICTS, type Verdict } from '../questionLogCore'

/*
 * Avis sur une réponse (phase de test) : sous chaque réponse à une question (« Poser une question », barres « Filtrer ou poser
 * une question… », « Filtrer » à la voix au bilan), une petite barre discrète « Cette réponse : Super · Mauvaise · Pas de
 * réponse ». Après un clic : un commentaire facultatif (« ce que je voulais ») et « Envoyer » ; puis « Merci, c'est noté ».
 * Une seule fois par question (retenu sur l'appareil). L'avis est une NOUVELLE ligne du journal des questions, anonymisée
 * comme la phrase (src/questionLog.ts, logAvis) ; hors ligne, il attend dans la file d'envoi.
 * Rien ne s'affiche si la question n'a pas été notée (pas d'identifiant : « Voir comme… », rôle sans question).
 */

const SHORT: Record<Verdict, string> = { super: 'Super', mauvaise: 'Mauvaise', sans_reponse: 'Pas de réponse' }

export function AnswerFeedback({ questionId, page, className = '' }: { questionId?: string; page?: string; className?: string }) {
  // Remis à zéro à chaque nouvelle question.
  return questionId && canLogQuestion() ? <Bar key={questionId} questionId={questionId} page={page} className={className} /> : null
}

function Bar({ questionId, page, className }: { questionId: string; page?: string; className: string }) {
  const [done, setDone] = useState(() => hasAvis(questionId))
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const box = `flex flex-col gap-1.5 rounded-md border border-line px-2 py-1.5 text-[11px] ${className}`

  if (done)
    return (
      <p className={`text-[11px] text-muted ${className}`} role="status">
        Merci, c’est noté.
      </p>
    )

  async function send() {
    if (!verdict || sending) return
    setSending(true)
    const ok = await logAvis({ questionId, verdict, comment, page })
    setSending(false)
    if (ok) setDone(true)
    else setFailed(true)
  }

  return (
    <div className={box} role="group" aria-label="Votre avis sur cette réponse">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-bold text-muted">Cette réponse :</span>
        {VERDICTS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={verdict === v}
            title={VERDICT_LABEL[v]}
            className={`min-h-8 rounded-full border px-2.5 font-bold ${verdict === v ? 'border-accent bg-accent text-white' : 'border-line text-fg hover:border-accent'}`}
            onClick={() => setVerdict(v)}
          >
            {SHORT[v]}
          </button>
        ))}
      </div>
      {verdict && (
        <form
          className="flex flex-col gap-1.5 sm:flex-row sm:items-start"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <textarea
            className="field min-h-11 min-w-0 flex-1 text-xs"
            rows={2}
            maxLength={MAX_COMMENT}
            placeholder={verdict === 'super' ? 'Un commentaire ? (facultatif)' : 'Ce que je voulais (facultatif)'}
            aria-label="Commentaire facultatif"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button type="submit" className="btn-primary min-h-11 shrink-0 self-start px-3 text-xs" disabled={sending}>
            Envoyer
          </button>
        </form>
      )}
      {failed && (
        <span className="text-red-300" role="alert">
          Avis non enregistré sur cet appareil.
        </span>
      )}
      <span className="text-[10px] text-muted">Phase de test : enregistré (sans nom de joueur) pour améliorer les réponses.</span>
    </div>
  )
}
