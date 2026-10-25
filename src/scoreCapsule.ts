/*
 * Notes en capsule segmentée (écran d'avis, CriterionInput de src/components/ui.tsx) : logique pure, sans React.
 *  - un segment par note de l'échelle du critère (score5 : 1 à 5, score3 : 0 à 3, score2 : 0 à 2) ;
 *  - état d'un segment : vide (neutre), retenu (la note saisie, plein blanc / couleur du texte du thème clair) ou proposé
 *    (note proposée par l'« avis vocal », pas encore validée : plein menthe, capsule entière au liseré menthe) ;
 *  - un toucher : la note choisie ; toucher la note retenue la retire ; toucher la note proposée la valide (même si une autre
 *    note était déjà retenue). La décision « acceptée / modifiée / ignorée » du journal reste faite par l'écran (decide()).
 */

export type SegmentState = 'vide' | 'retenu' | 'propose'

/** Une proposition de l'avis vocal reste à valider pour ce critère (note proposée différente de la note saisie). */
export const hasPendingProposal = (value: number | string | undefined, suggested: number | undefined): suggested is number =>
  suggested !== undefined && suggested !== value

/** État d'un segment de la capsule. La note retenue passe avant la proposition (elles ne coïncident jamais : voir plus haut). */
export function segmentState(n: number, value: number | string | undefined, suggested: number | undefined): SegmentState {
  if (value === n) return 'retenu'
  if (hasPendingProposal(value, suggested) && n === suggested) return 'propose'
  return 'vide'
}

/** Valeur après un toucher sur le segment `n` : la note retenue se retire, toute autre (dont la proposée) est choisie. */
export function scoreAfterTap(n: number, value: number | string | undefined, suggested: number | undefined): number | undefined {
  return segmentState(n, value, suggested) === 'retenu' ? undefined : n
}

/** Notes d'une échelle, de la plus basse à la plus haute. */
export const scaleSteps = (min: number, max: number): number[] => Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i)

/** Nom accessible d'un segment : « 4 sur 5 », « 4 sur 5, proposé par l'avis vocal : toucher pour valider ». */
export function segmentLabel(n: number, max: number, state: SegmentState): string {
  const base = `${n} sur ${max}`
  if (state === 'propose') return `${base}, proposé par l’avis vocal : toucher pour valider`
  if (state === 'retenu') return `${base}, note retenue : toucher pour la retirer`
  return base
}
