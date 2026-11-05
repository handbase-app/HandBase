import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { OAuthGrant } from '@supabase/supabase-js'
import { appName } from '../appBrand'
import { DEMO, TRIAL } from '../db'
import { listerRapports, rapportsPossibles, type Rapport } from '../rapports'
import { supabase } from '../sync'
import { ask } from './Confirm'
import { flash } from './ItemMenu'
import { Icon, SectionTitle } from './ui'

/*
 * Réglages → « Applications connectées » (projet « Serveur MCP Nextar ») : brancher Nextar dans Claude (adresse du serveur
 * MCP à copier, mode d'emploi court), les autorisations données (API auth.oauth de supabase-js : listGrants, revokeGrant) avec
 * « Révoquer », et les rapports gardés 30 jours (supabase/068_rapports.sql) qui s'ouvrent dans /rapport/:id.
 * Rien n'est envoyé à une IA par l'appli : c'est le coach qui branche son Claude, avec son compte.
 */

/** Adresse du serveur MCP (fonction Supabase « mcp ») de cette installation ; vide sans serveur. */
const mcpUrl = () => {
  const u = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/+$/, '')
  return u ? `${u}/functions/v1/mcp` : ''
}

const jour = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

async function copier(texte: string) {
  try {
    await navigator.clipboard.writeText(texte)
    flash('Adresse copiée.')
  } catch {
    flash('Copie impossible : sélectionne l’adresse et copie-la à la main.')
  }
}

export function ConnectedApps() {
  const url = mcpUrl()
  const possible = !!supabase && !TRIAL && !DEMO && !!url
  const [grants, setGrants] = useState<OAuthGrant[] | null | 'off'>(null)
  const [rapports, setRapports] = useState<Omit<Rapport, 'contenu'>[] | null>(null)

  const relire = useCallback(async () => {
    if (!possible) return
    const { data, error } = await supabase!.auth.oauth.listGrants()
    setGrants(error ? 'off' : (data ?? []))
    if (rapportsPossibles()) setRapports(await listerRapports())
  }, [possible])

  useEffect(() => {
    void relire()
  }, [relire])

  const revoquer = async (g: OAuthGrant) => {
    if (!(await ask(`Révoquer l’accès de « ${g.client.name || 'cette application'} » à ${appName()} ? Elle ne pourra plus rien lire ni déposer ; pour la rebrancher, il faudra l’autoriser à nouveau.`, { ok: 'Révoquer', focusCancel: true })))
      return
    const { error } = await supabase!.auth.oauth.revokeGrant({ clientId: g.client.id })
    flash(error ? `Pas révoqué : ${error.message}` : 'Accès révoqué.')
    void relire()
  }

  if (!possible)
    return (
      <section className="card p-4 text-xs text-muted">
        Brancher {appName()} dans Claude demande la version connectée de l’appli (avec un compte et un serveur).
      </section>
    )

  return (
    <>
      <section className="card flex flex-col gap-2 p-4">
        <SectionTitle info={`Claude lit tes joueurs EN CODES (jamais un nom, un club ni un commentaire), dépose des mesures dans ta boîte « À valider » (rien n’est enregistré sans toi) et garde des rapports en codes ; ton appareil y remet les noms. Toujours avec tes droits.`}>
          Brancher {appName()} dans Claude
        </SectionTitle>
        <div className="flex items-stretch gap-2">
          <input className="field min-w-0 flex-1 font-mono text-[11px]" readOnly value={url} aria-label="Adresse du serveur MCP" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn-primary min-h-11 shrink-0 px-4 text-xs" onClick={() => void copier(url)}>
            <Icon name="copy" className="h-4 w-4" />
            Copier
          </button>
        </div>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-xs">
          <li>Dans Claude (offre payante) : Réglages → Connecteurs → « Ajouter un connecteur personnalisé ».</li>
          <li>Nom : {appName()} ; adresse : celle ci-dessus (bouton Copier).</li>
          <li>« Se connecter » : {appName()} s’ouvre, connecte-toi si besoin, puis « Autoriser ».</li>
          <li>Dans une conversation, active {appName()} dans les outils, puis demande par exemple : « rentre ces résultats dans Nextar » (avec la photo de ta feuille) ou « fais-moi un rapport sur les 2011 vus cette saison ».</li>
        </ol>
        <p className="text-[11px] text-muted">Les propositions arrivent dans « À valider » (« depuis Claude ») ; les rapports s’ouvrent ici, dans l’appli, avec les noms.</p>
      </section>

      <section className="card flex flex-col gap-2 p-4">
        <SectionTitle info="Les applications que tu as autorisées avec ton compte. « Révoquer » coupe l’accès tout de suite (sessions et jetons de cette application).">Autorisations données</SectionTitle>
        {grants === null ? (
          <p className="text-xs text-muted">Chargement…</p>
        ) : grants === 'off' ? (
          <p className="text-xs text-muted">Les connexions d’applications ne sont pas encore activées sur ce serveur.</p>
        ) : grants.length === 0 ? (
          <p className="text-xs text-muted">Aucune application branchée pour l’instant.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {grants.map((g) => (
              <li key={g.client.id} className="flex min-h-11 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                  <Icon name="key" className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold break-words">{g.client.name || 'Application'}</span>
                  <span className="block text-[11px] text-muted">Autorisée le {jour(g.granted_at)}</span>
                </span>
                <button type="button" className="btn-ghost min-h-11 shrink-0 px-3 text-xs" onClick={() => void revoquer(g)}>
                  Révoquer
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {rapports && rapports.length > 0 && (
        <section className="card flex flex-col gap-2 p-4">
          <SectionTitle info="Rapports écrits par Claude avec les codes des joueurs, gardés 30 jours pour toi seul. En les ouvrant, ton appareil remet les noms.">Rapports préparés avec Claude</SectionTitle>
          <ul className="flex flex-col">
            {rapports.map((r) => (
              <li key={r.id}>
                <Link to={`/rapport/${r.id}`} className="flex min-h-11 items-center gap-2 border-b border-line py-1 text-sm last:border-0 hover:text-accent">
                  <Icon name="printer" className="h-4 w-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate font-bold">{r.titre}</span>
                  <span className="shrink-0 text-[11px] text-muted">{jour(r.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
