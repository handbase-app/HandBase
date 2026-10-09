import { useEffect, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { BackButton } from '../backNav'

/*
 * Confidentialité (information des joueurs et de leurs familles) et charte d'utilisation (staff).
 * Changer la charte sur le fond : augmenter CHARTER_VERSION, chacun devra l'accepter de nouveau.
 */

export const CHARTER_VERSION = 1

function H({ children }: { children: ReactNode }) {
  return <h3 className="mt-3 text-xs font-extrabold">{children}</h3>
}

export function PrivacyText() {
  return (
    <div className="flex flex-col gap-1.5 text-[12px] leading-relaxed">
      <p>
        HandBase est l’outil du staff de détection pour suivre les jeunes joueuses et joueurs de handball : tests physiques, avis
        des observateurs, participation aux rassemblements. Cette page explique quelles données sont enregistrées, pourquoi, qui
        les voit et comment exercer vos droits (Règlement général sur la protection des données, RGPD).
      </p>

      <H>Pourquoi ces données ?</H>
      <p>
        Uniquement pour repérer et suivre les jeunes dans le cadre de la détection et des sélections, et organiser les
        rassemblements. Elles ne sont ni vendues, ni utilisées pour de la publicité, ni transmises en dehors du staff.
      </p>

      <H>Quelles données ?</H>
      <ul className="ml-4 list-disc">
        <li>Identité et licence : nom, prénom, sexe, date de naissance, nationalité, club, numéro et état de licence (issus de Gest’Hand, la base de la Fédération).</li>
        <li>Profil sportif : poste(s), latéralité, groupes, rassemblements suivis.</li>
        <li>Mesures et tests physiques : taille, poids, envergure, tests de vitesse, de saut, de force… et, si elles sont données, les tailles des parents (pour estimer la taille adulte).</li>
        <li>Avis des observateurs : notes et commentaires sur le jeu, signés par leur auteur.</li>
      </ul>
      <p>
        Aucune donnée de santé (blessures, maladies, traitements) n’est enregistrée, ni aucune information sur les origines, la
        religion ou la situation familiale. Aucune coordonnée des parents n’est enregistrée (seule leur taille peut l’être, sans leur nom).
      </p>

      <H>Qui les voit ?</H>
      <p>
        Seuls les membres du staff qui ont un compte personnel : administrateurs, encadrants et observateurs, chacun selon son
        rôle. Chaque création ou modification est enregistrée avec son auteur. Chaque membre du staff a accepté la charte
        d’utilisation ci-dessous. Les administrateurs voient aussi quand chaque membre du staff utilise l’application (heures
        de connexion et type d’appareil, sans adresse IP) : gardé 6 mois. Les groupes privés (« Moi seul ») ou « Mon staff » d’un
        membre ne sont visibles que de lui et de ses participants ; un administrateur peut y accéder en cas de besoin (départ,
        réattribution), et chaque accès est noté dans le journal d’activité.
      </p>

      <H>Où sont-elles stockées ?</H>
      <p>
        Sur un serveur sécurisé (Supabase), accessible uniquement aux comptes du staff, et sur les appareils du staff pour que
        l’application fonctionne sans connexion.
      </p>

      <H>Combien de temps ?</H>
      <p>
        Le temps du suivi du joueur dans le parcours de détection. Une fiche proposée par un observateur et jamais validée est
        effacée automatiquement au bout de 12 mois.
      </p>

      <H>Vos droits</H>
      <p>
        Le joueur ou ses parents peuvent demander à tout moment une copie de toutes les données le concernant, leur correction,
        leur effacement, ou s’opposer à leur utilisation. Il suffit de le demander à un encadrant ou à un administrateur, qui y
        répond dans un délai d’un mois. En cas de désaccord, il est possible de saisir la CNIL (cnil.fr).
      </p>
    </div>
  )
}

export function CharterText() {
  return (
    <div className="flex flex-col gap-1.5 text-[12px] leading-relaxed">
      <p>HandBase contient des informations sur des mineurs. En utilisant l’application, je m’engage à :</p>

      <H>1. Ne rien écrire sur la santé</H>
      <p>
        Pas de blessure, maladie, traitement, handicap, état psychologique, ni rien sur les origines, la religion, la vie
        familiale ou sociale. Si un test n’a pas pu être fait, j’écris seulement « non réalisé ». Une information médicale utile
        passe par le médecin ou le kiné, en dehors de l’application.
      </p>

      <H>2. Rester factuel et respectueux</H>
      <p>
        Je décris ce que j’ai vu sur le terrain (le jeu, les gestes, les choix), pas la personne. Pas de moquerie, de surnom ni de
        jugement blessant. J’écris comme si le joueur ou ses parents allaient le lire : ils peuvent demander une copie de tout ce
        qui le concerne, avis compris.
      </p>

      <H>3. N’écrire que ce que je sais</H>
      <p>Mes avis portent sur ce que j’ai observé moi-même. Si je me suis trompé, je corrige.</p>

      <H>4. Garder les données dans l’application</H>
      <p>
        Je ne copie, n’envoie ni ne publie aucune information (captures d’écran, exports, messages) en dehors du staff, et je ne
        les utilise que pour la détection.
      </p>

      <H>5. Protéger mon compte</H>
      <p>
        Mon compte est personnel : je ne le prête pas et je garde mon mot de passe pour moi. Mon téléphone est verrouillé. Je
        préviens un administrateur si je le perds.
      </p>

      <H>6. Transmettre les demandes</H>
      <p>Si un joueur ou un parent demande ses données, une correction ou un effacement, je transmets à un administrateur.</p>

      <p className="mt-2 text-muted">Le non-respect de cette charte peut entraîner le retrait de l’accès.</p>
    </div>
  )
}

/** Page Réglages → Confidentialité. */
export default function Privacy() {
  const { hash } = useLocation()
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView()
  }, [hash])
  return (
    <div className="flex flex-col gap-4">
      <BackButton fallback="/parametres" label="RÉGLAGES" className="self-start" />
      <section className="card p-4">
        <div className="section-title">Confidentialité</div>
        <PrivacyText />
      </section>
      <section id="charte" className="card scroll-mt-16 p-4">
        <div className="section-title">Charte d’utilisation du staff</div>
        <CharterText />
      </section>
    </div>
  )
}
