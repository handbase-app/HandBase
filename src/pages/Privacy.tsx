import { useEffect, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useSportProfile } from '../installation'
import { BackButton } from '../backNav'
import { appName } from '../appBrand'

/*
 * Confidentialité (information des joueurs et de leurs familles) et charte d'utilisation (staff).
 * Changer la charte sur le fond : augmenter CHARTER_VERSION, chacun devra l'accepter de nouveau.
 */

export const CHARTER_VERSION = 1
/** Charte de l'espace joueur (src/components/AuthGate.tsx, clé player_charter_version du compte) : même mécanisme, clé distincte. */
export const PLAYER_CHARTER_VERSION = 2

function H({ children }: { children: ReactNode }) {
  return <h3 className="mt-3 text-xs font-extrabold">{children}</h3>
}

export function PrivacyText() {
  // Sport de l'installation (src/sportConfig.ts) : « le hand », « le volley » ; Gest'Hand : handball seulement.
  const sport = useSportProfile()
  const gestHand = sport.features.includes('licencesGestHand')
  return (
    <div className="flex flex-col gap-1.5 text-[12px] leading-relaxed">
      <p>
        {appName()} est l’outil du staff de détection pour suivre les jeunes joueuses et joueurs de {sport.config.sportName.toLowerCase()} : tests physiques, avis
        du staff, participation aux rassemblements. Cette page explique quelles données sont enregistrées, pourquoi, qui
        les voit et comment exercer vos droits (Règlement général sur la protection des données, RGPD).
      </p>

      <H>Pourquoi ces données ?</H>
      <p>
        Uniquement pour repérer et suivre les jeunes dans le cadre de la détection et des sélections, et organiser les
        rassemblements. Elles ne sont ni vendues, ni utilisées pour de la publicité, ni transmises en dehors du staff.
      </p>

      <H>Quelles données ?</H>
      <ul className="ml-4 list-disc">
        <li>Identité et licence : nom, prénom, sexe, date de naissance, nationalité, club, numéro et état de licence ({gestHand ? 'issus de Gest’Hand, la base de la Fédération' : 'issus de la base des licences de la Fédération'}).</li>
        <li>Profil sportif : poste(s), latéralité, groupes, rassemblements suivis.</li>
        <li>Mesures et tests physiques : taille, poids, envergure, tests de vitesse, de saut, de force… et, si elles sont données, les tailles des parents (pour estimer la taille adulte).</li>
        <li>Avis du staff : notes et commentaires sur le jeu, signés par leur auteur.</li>
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
        de connexion et type d’appareil, sans adresse IP) : gardé 6 mois. Les groupes privés (« Moi seul ») ou « Mes groupes de travail » d’un
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
        répond dans un délai d’un mois. Avec un espace joueur, le jeune télécharge aussi lui-même, depuis sa page, la copie
        complète de ce qu’il a écrit (« Télécharger mes données »). En cas de désaccord, il est possible de saisir la CNIL (cnil.fr).
      </p>

      <H>Espace joueur</H>
      <p>
        Un jeune (ou sa famille) peut recevoir un accès personnel à {appName()}, relié à sa seule fiche : son encadrant (ou un
        administrateur) crée son compte depuis la fiche, ou lui remet un code s’il a déjà un compte. Il y voit son identité (nom,
        année de naissance, club, poste) et ses passages en pôle, tels que le staff les tient, et rien d’autre : ni avis, ni
        mesures, ni classement, ni aucun autre joueur. Il y écrit lui-même, s’il le souhaite, « Ma lettre » (ce que le {sport.word} lui
        apporte, un moment dont il est fier, ce qu’il veut travailler ; les 20 versions précédentes sont gardées pour voir le
        chemin parcouru), « Mes repères » (le joueur ou la joueuse qu’il préfère, son équipe préférée, son poste rêvé, un match marquant) et « Mon parcours »
        (clubs, postes joués, sélections, palmarès) : c’est lu par les encadrants et administrateurs qui voient sa fiche, et par
        personne d’autre ; il peut le modifier ou l’effacer à tout moment.
      </p>
      <p>
        « Mon journal du {sport.word} » : des notes datées sur ce que le {sport.word} lui fait vivre (un match, un entraînement, une envie), avec
        une humeur s’il le veut ; c’est le ressenti sportif, pas la santé ni la vie privée. Le journal est PRIVÉ : seul le jeune
        le lit. Il choisit, note par note, celles qu’il partage avec son encadrant, et peut reprendre ce partage, corriger ou
        supprimer une note à tout moment (une note supprimée est effacée tout de suite). Le staff qui suit sa fiche voit en plus
        la tendance de ses humeurs (combien de notes par humeur et par semaine, sur 8 semaines), jamais le texte, sans aucune IA.
        Les 200 notes les plus récentes sont gardées. Le journal n’entre dans aucun export du staff ; la copie demandée au staff
        ne contient que les notes partagées.
      </p>
      <p>
        Un bouton « J’ai besoin d’en parler », toujours visible sur sa page, donne la personne à contacter choisie par
        l’administrateur et les numéros officiels gratuits et anonymes (3018, 119, 3114, Fil Santé Jeunes, Signal-sports) : rien
        n’est envoyé ni détecté automatiquement, c’est le jeune qui choisit d’appeler. Il télécharge lui-même, depuis sa page, la
        copie complète de ce qu’il a écrit (notes privées comprises). L’accès peut être retiré par son encadrant. L’accord des
        familles : au pôle, il est signé à l’inscription ; sinon, il est demandé au moment de créer le compte ou de remettre le
        code. Durée de conservation : celle de la fiche (fiche effacée : tout ce qu’il a écrit, journal compris, part avec elle).
      </p>
    </div>
  )
}

/** Charte de l'espace joueur : en mots simples, acceptée une fois par le jeune (ou sa famille) à la première connexion. */
export function PlayerCharterText() {
  const sport = useSportProfile()
  return (
    <div className="flex flex-col gap-1.5 text-[12px] leading-relaxed">
      <p>Bienvenue sur ta page {appName()}. Avant de commencer, voici comment ça marche.</p>

      <H>Ce que tu vois</H>
      <p>
        Ta fiche seulement : ton nom, ton année de naissance, ton club, ton poste et tes passages en pôle. Ces informations sont tenues
        par ton encadrant ; si quelque chose est faux, dis-le-lui.
      </p>

      <H>Ce que tu écris</H>
      <p>
        « Ma lettre », « Mes repères », « Mon parcours » et « Mon journal du {sport.word} » : c’est toi qui écris, quand tu veux, ce que tu
        veux. Tu peux changer ou effacer tes réponses et tes notes à tout moment. Rien n’est obligatoire.
      </p>

      <H>Ce que ton encadrant voit</H>
      <p>
        Ta lettre (et ses versions précédentes), tes repères et ton parcours, sur ta fiche, pour mieux te connaître et t’accompagner.
        Ton journal est privé : ton encadrant voit seulement la tendance de tes humeurs (jamais le texte) et les notes que tu choisis
        de partager. Personne d’autre ne lit ce que tu écris.
      </p>

      <H>Si ça ne va pas</H>
      <p>
        Le bouton « J’ai besoin d’en parler », en bas de ta page, te donne à qui parler et des numéros gratuits et anonymes. Tu peux
        aussi télécharger tout ce que tu as écrit (« Télécharger mes données »).
      </p>

      <H>Ce qu’on ne fait jamais</H>
      <p>
        Pas de classement, pas de jugement, pas de comparaison avec les autres. Tu ne vois pas les avis ni les mesures du staff, et tu
        ne vois aucun autre joueur ni aucune autre joueuse.
      </p>

      <H>Ton compte</H>
      <p>Il est à toi (ou à ta famille) : garde ton mot de passe pour toi. Si tu as une question, demande à ton encadrant.</p>
    </div>
  )
}

export function CharterText() {
  return (
    <div className="flex flex-col gap-1.5 text-[12px] leading-relaxed">
      <p>{appName()} contient des informations sur des mineurs. En utilisant l’application, je m’engage à :</p>

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

/** « Poser une question » au bilan : ce qui est gardé des questions du staff (src/questionLog.ts, supabase/043_journal_questions.sql). */
export function QuestionsText() {
  return (
    <div className="flex flex-col gap-1.5 text-[12px] leading-relaxed">
      <p>
        Pendant la phase de développement, les questions posées à {appName()} (« Poser une question » au bilan de détection, champs
        « Filtrer ou poser une question… » des listes, « Filtrer » à la voix) peuvent être enregistrées pour améliorer {appName()}, avec
        l’avis donné sur la réponse.
      </p>
      <H>Quoi ?</H>
      <p>
        La phrase de la question, rendue anonyme sur l’appareil avant tout envoi : les prénoms et noms de joueurs deviennent
        [prénom] et [nom], les numéros de licence [licence]. S’y ajoutent le résultat du traitement (question comprise en
        entier, en partie ou pas comprise ; réponse du mode avancé obtenue ou non, avec la requête écrite par l’assistant, elle
        aussi rendue anonyme), l’écran où elle a été posée, le moment et l’auteur de la question (son compte). Jamais la réponse
        elle-même ni aucune donnée de joueur.
      </p>
      <p>
        Si vous donnez votre avis sur une réponse (« Super », « Mauvaise réponse » ou « Pas de réponse »), cet avis et votre
        commentaire facultatif (« ce que je voulais ») sont enregistrés avec la question, eux aussi rendus anonymes de la même façon
        (prénoms, noms et licences remplacés), avec le moment et l’auteur. Donner un avis est facultatif.
      </p>
      <p>
        Évaluations vocales (« Avis vocal » de l’écran de notation) : la phrase dictée, rendue anonyme de la même façon (sans nom),
        les notes proposées critère par critère et ce que l’entraîneur en a gardé (acceptée, modifiée et la note mise à la place,
        ignorée), et son appréciation facultative sur la proposition (« Cohérente », « En partie », « Pas cohérente », avec un
        commentaire lui aussi rendu anonyme), avec le moment et l’auteur. Jamais l’identité du joueur évalué : ni son nom, ni sa
        date de naissance, ni son club, ni rien de sa fiche.
      </p>
      <H>Pourquoi ?</H>
      <p>Uniquement pour améliorer les réponses : repérer les questions mal comprises et apprendre à l’appli à y répondre.</p>
      <H>Qui les voit ?</H>
      <p>Les administrateurs seulement. Celui qui pose une question ne relit pas ce journal, pas même ses propres questions.</p>
      <H>Combien de temps ?</H>
      <p>12 mois au plus : chaque question et chaque avis sont effacés automatiquement au bout de 12 mois ; un administrateur peut aussi vider le journal à tout moment.</p>
      <H>Mes questions et mes filtres enregistrés</H>
      <p>
        Ce n’est pas ce journal. « Enregistrer cette question » (bilan) et « Enregistrer ce filtre » (liste des joueurs) gardent
        un nom, les filtres ou la requête et la phrase d’origine, pour les relancer sans rien envoyer à l’assistant. Ils sont
        gardés sur votre compte, pour les retrouver sur tous vos appareils, et ne sont visibles que de vous : aucun autre
        compte, administrateurs compris. Avant leur mise en place sur le serveur (et dans la démonstration), ils restent
        seulement sur l’appareil. Supprimer une question l’efface de tous vos appareils (le serveur n’en garde que
        l’identifiant) ; supprimer le compte les efface toutes.
      </p>
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
      <section id="charte-joueur" className="card scroll-mt-16 p-4">
        <div className="section-title">Charte de l’espace joueur</div>
        <PlayerCharterText />
      </section>
      <section id="questions" className="card scroll-mt-16 p-4">
        <div className="section-title">Questions posées (phase de développement)</div>
        <QuestionsText />
      </section>
    </div>
  )
}
