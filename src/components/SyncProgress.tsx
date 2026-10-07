import { useSyncState } from '../sync'
import { percent, progressLabel, showProgress } from '../syncProgress'

/** Gros téléchargement (premier chargement) : barre fine sous l'en-tête, avec le compte des éléments reçus. */
export function SyncProgressBar() {
  const { state, progress } = useSyncState()
  if (state !== 'syncing' || !showProgress(progress)) return null
  return (
    <div className="absolute inset-x-0 top-full border-b border-line bg-bg/95 backdrop-blur" role="status">
      <div className="h-1 bg-line">
        <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${percent(progress)}%` }} />
      </div>
      <p className="truncate px-4 py-1 text-[10px] font-bold text-muted">{progressLabel(progress)}…</p>
    </div>
  )
}
