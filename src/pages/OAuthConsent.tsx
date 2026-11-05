import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { OAuthAuthorizationDetails } from '@supabase/supabase-js'
import { Icon } from '../components/ui'
import { DEMO, TRIAL } from '../db'
import { isPlayerRole, useRole } from '../roles'
import { supabase } from '../sync'
import { appName } from '../appBrand'

/*
 * Page d'AUTORISATION OAuth (/oauth/consent?authorization_id=…), exigée par le serveur OAuth 2.1 de Supabase Auth quand le
 * coach branche Nextar dans Claude (connecteur personnalisé, serveur MCP supabase/functions/mcp). Le coach est déjà connecté
 * à l'appli (AuthGate) ; la page montre QUI demande (nom du client, son site, où il sera renvoyé), avec QUEL compte, et ce
 * que l'application pourra faire, puis « Refuser » ou « Autoriser ». API de supabase-js (2.109, auth.oauth) :
 * getAuthorizationDetails, approveAuthorization, denyAuthorization. Déjà autorisé : renvoi direct vers le client.
 * Compte joueur : seulement « Refuser » (le serveur MCP ne lui donnerait rien). Fenêtre au fond flouté (scrim).
 * Réglage du tableau de bord Supabase : Authentication → OAuth Server → « Authorization path » = /oauth/consent (sous
 * l'adresse du site, base comprise : /HandBase/oauth/consent sur GitHub Pages).
 */

type Etat =
  | { k: 'chargement' }
  | { k: 'details'; d: OAuthAuthorizationDetails }
  | { k: 'renvoi'; url: string }
  | { k: 'erreur'; message: string }

const hote = (u?: string) => {
  try {
    return u ? new URL(u).host : ''
  } catch {
    return ''
  }
}

/** Le renvoi vers le client doit être une adresse web (jamais javascript: ou autre). */
const sur = (u: string) => /^https?:\/\//i.test(u) || (/^[a-z][a-z0-9+.-]*:\/\/[^/]/i.test(u) && !/^(javascript|data|vbscript):/i.test(u))

export default function OAuthConsent() {
  const loc = useLocation()
  const role = useRole()
  const authId = new URLSearchParams(loc.search).get('authorization_id') ?? ''
  const [etat, setEtat] = useState<Etat>(() =>
    !supabase || TRIAL || DEMO
      ? { k: 'erreur', message: 'Brancher une application demande la version connectée de l’appli (avec un compte).' }
      : !authId
        ? { k: 'erreur', message: 'Demande d’autorisation incomplète (identifiant absent). Recommence depuis Claude.' }
        : { k: 'chargement' },
  )
  const [occupe, setOccupe] = useState<'' | 'oui' | 'non'>('')
  const joueur = isPlayerRole(role)

  useEffect(() => {
    if (!supabase || TRIAL || DEMO || !authId) return
    let alive = true
    void supabase.auth.oauth.getAuthorizationDetails(authId).then(({ data, error }) => {
      if (!alive) return
      if (error || !data) return setEtat({ k: 'erreur', message: error?.message ? `Demande refusée par le serveur : ${error.message}` : 'Demande introuvable ou expirée. Recommence depuis Claude.' })
      if ('redirect_url' in data && !('authorization_id' in data)) {
        // Déjà autorisé : retour direct vers l'application.
        if (sur(data.redirect_url)) {
          setEtat({ k: 'renvoi', url: data.redirect_url })
          window.location.assign(data.redirect_url)
        } else setEtat({ k: 'erreur', message: 'Adresse de retour invalide.' })
        return
      }
      setEtat({ k: 'details', d: data as OAuthAuthorizationDetails })
    })
    return () => {
      alive = false
    }
  }, [authId])

  const decider = async (oui: boolean) => {
    if (!supabase || etat.k !== 'details' || occupe) return
    setOccupe(oui ? 'oui' : 'non')
    const r = oui && !joueur ? await supabase.auth.oauth.approveAuthorization(authId, { skipBrowserRedirect: true }) : await supabase.auth.oauth.denyAuthorization(authId, { skipBrowserRedirect: true })
    if (r.error || !r.data?.redirect_url || !sur(r.data.redirect_url)) {
      setOccupe('')
      setEtat({ k: 'erreur', message: r.error?.message ? `Le serveur a refusé : ${r.error.message}` : 'Réponse inattendue du serveur. Recommence depuis Claude.' })
      return
    }
    setEtat({ k: 'renvoi', url: r.data.redirect_url })
    window.location.assign(r.data.redirect_url)
  }

  const d = etat.k === 'details' ? etat.d : null
  const client = d?.client.name?.trim() || 'Une application'
  const site = hote(d?.client.uri)
  const retour = hote(d?.redirect_uri)

  return (
    <div className="scrim fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="oauth-titre">
      <div className="flex max-h-full w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-2xl border border-line bg-panel p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl">
        <div className="flex items-center gap-3">
          {d?.client.logo_uri && /^https:\/\//.test(d.client.logo_uri) ? (
            <img src={d.client.logo_uri} alt="" className="h-11 w-11 shrink-0 rounded-xl border border-line bg-white object-contain p-1" referrerPolicy="no-referrer" />
          ) : (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <Icon name="key" className="h-6 w-6" />
            </span>
          )}
          <h1 id="oauth-titre" className="min-w-0 flex-1 text-base leading-snug font-extrabold">
            {etat.k === 'details' ? `Autoriser ${client} à accéder à ${appName()} ?` : etat.k === 'renvoi' ? `Retour vers l’application…` : etat.k === 'erreur' ? 'Autorisation impossible' : 'Autorisation…'}
          </h1>
        </div>

        {etat.k === 'chargement' && <p className="py-6 text-center text-sm text-muted">Lecture de la demande…</p>}
        {etat.k === 'renvoi' && <p className="text-sm text-muted">Tu vas être renvoyé vers l’application{hote(etat.url) ? ` (${hote(etat.url)})` : ''}. Tu peux fermer cette page ensuite.</p>}
        {etat.k === 'erreur' && <p className="text-sm">{etat.message}</p>}

        {d && (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted">Application</dt>
              <dd className="font-bold break-words">
                {client}
                {site ? <span className="font-normal text-muted"> · {site}</span> : null}
              </dd>
              <dt className="text-muted">Compte</dt>
              <dd className="break-words">{d.user.email}</dd>
              {retour && (
                <>
                  <dt className="text-muted">Retour vers</dt>
                  <dd className="break-words">{retour}</dd>
                </>
              )}
            </dl>
            {joueur ? (
              <p className="rounded-xl bg-panel-2 p-3 text-xs">Un compte joueur ne peut pas brancher d’application sur {appName()}. Refuse la demande.</p>
            ) : (
              <div className="flex flex-col gap-2 text-xs">
                <p className="font-bold">Avec tes droits (ton périmètre, ton rôle), {client} pourra :</p>
                <ul className="flex flex-col gap-1.5">
                  {[
                    ['eye', 'lire tes joueurs EN CODES (J-…) : poste, année, sexe, département, mesures, moyennes d’avis, nombre de « vus » ; jamais un nom, un club, une date de naissance ni un commentaire'],
                    ['check', 'déposer des mesures dans ta boîte « À valider » : rien n’est enregistré avant que tu valides'],
                    ['printer', 'garder 30 jours des rapports écrits avec les codes : ton appareil y remet les noms'],
                  ].map(([icon, txt]) => (
                    <li key={icon} className="flex gap-2">
                      <Icon name={icon as 'eye'} className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      <span>{txt}</span>
                    </li>
                  ))}
                  <li className="flex gap-2">
                    <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                    <span>
                      Jamais modifier ni supprimer une fiche, une mesure ou un avis. Révocable à tout moment : Réglages → Applications connectées.
                    </span>
                  </li>
                </ul>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button type="button" className="btn-ghost min-h-11 flex-1" disabled={!!occupe} onClick={() => void decider(false)}>
                {occupe === 'non' ? 'Refus…' : 'Refuser'}
              </button>
              {!joueur && (
                <button type="button" className="btn-primary min-h-11 flex-1" disabled={!!occupe} onClick={() => void decider(true)}>
                  {occupe === 'oui' ? 'Autorisation…' : 'Autoriser'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
