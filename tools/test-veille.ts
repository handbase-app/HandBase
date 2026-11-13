// Test de la fonction « veille » (supabase/functions/veille/veille.ts, partie pure) : jour et heure de Paris, fenêtre
// d'envoi, regroupement par personne (un seul envoi par personne, même avec plusieurs événements), contenu du message
// (signal minimal : aucune donnée de joueur), créneau « ne pas déranger », envois en parallèle. Comptes et événements fictifs.
//
//   npx jiti tools/test-veille.ts
import assert from 'node:assert/strict'
import {
  abonnementPerdu,
  dansFenetre,
  enCalme,
  entier,
  jourValide,
  MAX_EVENTS,
  MAX_NOM,
  MAX_OCTETS,
  nomCourt,
  paquets,
  parallele,
  parisParts,
  parPersonne,
  payloadIsMinimal,
  veillePayload,
  type VeilleRow,
} from '../supabase/functions/veille/veille'

let n = 0
const t = async (name: string, f: () => void | Promise<void>) => {
  await f()
  n++
  console.log(`ok ${n} - ${name}`)
}

const U1 = '00000000-0000-0000-0000-0000000000a1'
const U2 = '00000000-0000-0000-0000-0000000000b2'

await t('jour et heure de Paris : été, hiver, minuit, changement d’heure', () => {
  assert.deepEqual(parisParts(new Date('2026-07-01T16:00:00Z')), { jour: '2026-07-01', heure: 18 }) // été : UTC+2
  assert.deepEqual(parisParts(new Date('2026-12-01T17:00:00Z')), { jour: '2026-12-01', heure: 18 }) // hiver : UTC+1
  assert.deepEqual(parisParts(new Date('2026-11-13T23:30:00Z')), { jour: '2026-11-14', heure: 0 }) // déjà demain à Paris
  assert.deepEqual(parisParts(new Date('2026-10-25T16:00:00Z')), { jour: '2026-10-25', heure: 17 }) // jour du passage à l'hiver
})

await t('fenêtre d’envoi 18 h – 22 h ; créneaux de la tâche (16-20 h UTC) l’été et l’hiver', () => {
  assert.equal(dansFenetre(17), false)
  assert.equal(dansFenetre(18), true)
  assert.equal(dansFenetre(21), true)
  assert.equal(dansFenetre(22), false)
  assert.equal(dansFenetre(23, 22, 2), true) // fenêtre qui passe minuit
  assert.equal(dansFenetre(1, 22, 2), true)
  assert.equal(dansFenetre(3, 22, 2), false)
  // Toutes les 5 minutes de 16 h à 20 h 55 UTC : les heures de Paris couvertes, été comme hiver, vont de 18 h à 21 h 55.
  for (const [mois, decalage] of [['07', 2], ['12', 1]] as const) {
    const actifs = new Set<number>()
    for (let h = 16; h <= 20; h++) {
      const p = parisParts(new Date(`2026-${mois}-10T${String(h).padStart(2, '0')}:30:00Z`))
      assert.equal(p.heure, (h + decalage) % 24)
      if (dansFenetre(p.heure)) actifs.add(p.heure)
    }
    assert.deepEqual([...actifs].sort((a, b) => a - b), [18, 19, 20, 21], `mois ${mois}`)
  }
})

await t('réglages bornés (lot, heures) et jour valide', () => {
  assert.equal(entier('300', 1, 1, 5000), 300)
  assert.equal(entier(undefined, 300, 1, 5000), 300)
  assert.equal(entier('0', 300, 1, 5000), 300)
  assert.equal(entier('1e9', 300, 1, 5000), 300)
  assert.equal(entier('12.5', 300, 1, 5000), 300)
  assert.equal(entier(50, 300, 1, 5000), 50)
  assert.equal(jourValide('2026-11-13'), true)
  assert.equal(jourValide('2026-02-30'), false)
  assert.equal(jourValide('13/11/2026'), false)
  assert.equal(jourValide(20261113), false)
})

const rows: VeilleRow[] = [
  { user_id: U1, event_id: 'e2', nom: 'Stage gardiens', heure: '14:00', notif: { quiet: false } },
  { user_id: U1, event_id: 'e1', nom: 'Détection U13', heure: '09:30', notif: { quiet: false } },
  { user_id: U1, event_id: 'e1', nom: 'Détection U13', heure: '09:30', notif: { quiet: false } }, // doublon
  { user_id: U1, event_id: 'e3', nom: 'Tournoi', heure: null, notif: { quiet: false } },
  { user_id: U2, event_id: 'e1', nom: 'Détection U13', heure: '09:30', notif: {} },
]

await t('regroupement : un seul envoi par personne, événements par heure, sans doublon', () => {
  const g = parPersonne(rows)
  assert.deepEqual([...g.keys()], [U1, U2])
  assert.deepEqual(
    g.get(U1)!.events.map((e) => e.id),
    ['e1', 'e2', 'e3'],
  )
  assert.equal(g.get(U1)!.events[2].h, undefined)
  assert.deepEqual(g.get(U2)!.events, [{ id: 'e1', nom: 'Détection U13', h: '09:30' }])
  // Lignes illisibles ignorées.
  assert.equal(parPersonne([{ user_id: U1, event_id: '', nom: 'x', heure: null }, null as unknown as VeilleRow]).size, 0)
})

await t('nom court : 40 caractères, contrôles retirés, nom vide', () => {
  assert.equal(nomCourt('  Détection\n\tU13  '), 'Détection U13')
  assert.equal(nomCourt(''), 'Événement')
  assert.equal(nomCourt(null), 'Événement')
  const long = nomCourt('Stage de perfectionnement des gardiens de but de la ligue')
  assert.ok(long.length <= MAX_NOM && long.length > 30)
  assert.ok(long.endsWith('…'))
})

await t('message : signal minimal, aucune donnée de joueur ni autre champ', () => {
  const g = parPersonne(rows)
  const p = veillePayload('2026-11-13', g.get(U1)!.events)
  assert.deepEqual(p, {
    type: 'veille',
    v: 1,
    jour: '2026-11-13',
    ev: [
      { id: 'e1', nom: 'Détection U13', h: '09:30' },
      { id: 'e2', nom: 'Stage gardiens', h: '14:00' },
      { id: 'e3', nom: 'Tournoi' },
    ],
  })
  assert.equal(payloadIsMinimal(p), true)
  // Champs en trop venus d'une ligne (joueurs, lieu, avis…) : jamais recopiés dans le message.
  const sale = veillePayload('2026-11-13', [
    { id: 'e1', nom: 'Détection', h: '09:30', playerIds: ['j-1'], lieu: 'Gymnase', avis: 'très bon' } as unknown as { id: string; nom: string },
  ])
  assert.deepEqual(Object.keys(sale.ev[0]).sort(), ['h', 'id', 'nom'])
  const json = JSON.stringify(sale)
  for (const mot of ['playerIds', 'j-1', 'Gymnase', 'très bon']) assert.ok(!json.includes(mot), mot)
  // Le contrôle refuse tout message qui sort du signal minimal.
  assert.equal(payloadIsMinimal({ ...p, joueurs: ['Dupont'] }), false)
  assert.equal(payloadIsMinimal({ ...p, ev: [{ id: 'e1', nom: 'x', mesure: 12 }] }), false)
  assert.equal(payloadIsMinimal({ ...p, ev: [{ id: 'e1', nom: 'x', h: '9h' }] }), false)
  assert.equal(payloadIsMinimal({ ...p, type: 'autre' }), false)
  assert.equal(payloadIsMinimal({ ...p, jour: 'demain' }), false)
})

await t('message : au plus 5 événements détaillés, les autres comptés ; taille bornée', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `e${i}`, nom: `Événement ${i}`, h: '10:00' }))
  const p = veillePayload('2026-11-13', many)
  assert.equal(p.ev.length, MAX_EVENTS)
  assert.equal(p.plus, 3)
  assert.equal(payloadIsMinimal(p), true)
  const huge = Array.from({ length: 5 }, (_, i) => ({ id: 'x'.repeat(100) + i, nom: 'É'.repeat(40) }))
  const q = veillePayload('2026-11-13', huge)
  assert.ok(new TextEncoder().encode(JSON.stringify(q)).length <= MAX_OCTETS)
  assert.equal(payloadIsMinimal(q), true)
})

await t('ne pas déranger : par défaut 21 h – 8 h, coupé, créneau choisi ; message « calme » sans son', () => {
  assert.equal(enCalme({}, 18), false)
  assert.equal(enCalme({}, 21), true)
  assert.equal(enCalme(null, 7), true)
  assert.equal(enCalme({ quiet: false }, 23), false)
  assert.equal(enCalme({ quietFrom: 17, quietTo: 7 }, 18), true)
  assert.equal(enCalme({ quietFrom: 12, quietTo: 12 }, 12), false)
  const p = veillePayload('2026-11-13', [{ id: 'e1', nom: 'Détection' }], { calme: true })
  assert.equal(p.calme, true)
  assert.equal(payloadIsMinimal(p), true)
})

await t('abonnements perdus (404, 410) ; paquets ; envois en parallèle bornés, ordre gardé', async () => {
  assert.equal(abonnementPerdu(410), true)
  assert.equal(abonnementPerdu(404), true)
  assert.equal(abonnementPerdu(429), false)
  assert.equal(abonnementPerdu(undefined), false)
  assert.deepEqual(paquets([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  let running = 0
  let peak = 0
  const out = await parallele(
    Array.from({ length: 30 }, (_, i) => async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 1 + (i % 3)))
      running--
      return i
    }),
    4,
  )
  assert.deepEqual(out, Array.from({ length: 30 }, (_, i) => i))
  assert.ok(peak <= 4 && peak > 1)
  assert.deepEqual(await parallele([]), [])
})

console.log(`\n${n} essais réussis`)
