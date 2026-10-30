import { useSyncState } from '../sync'
import { BUSY_LABEL, percent, progressLabel, showProgress } from '../syncProgress'

/**
 * Gros téléchargement (premier chargement, entré dès les premiers joueurs reçus ; gros retard) : barre fine sous l'en-tête,
 * avec le compte des éléments reçus. Serveur très demandé (requête qui attend son tour, src/retry.ts) : une ligne discrète.
 */
export function SyncProgressBar() {
  const { state, progress, busy } = useSyncState()
  const bar = showProgress(progress)
  if (state !== 'syncing' || (!bar && !busy)) return null
  return (
    <div className="absolute inset-x-0 top-full border-b border-line bg-bg/95 backdrop-blur" role="status">
      {bar && (
        <div className="h-1 bg-line">
          <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${percent(progress)}%` }} />
        </div>
      )}
      <p className="truncate px-4 py-1 text-[10px] font-bold text-muted">{busy ? `${BUSY_LABEL}…` : bar ? `${progressLabel(progress)}…` : ''}</p>
    </div>
  )
}
