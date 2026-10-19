// Test de l'espace joueur (src/playerSpace.ts, règles reprises par supabase/051_espace_joueur.sql) : nettoyage de ce que le
// joueur écrit (tailles, lignes vides, années de clubs, postes inconnus), âge minimum (réglage de l'installation), code
// d'invitation (alphabet sans O / 0 / I / 1, mise en forme, texte prêt à envoyer), messages d'erreur, ce qu'un compte
// joueur voit (sans fiche reliée : rien), tables reçues par sa synchronisation. Données fictives seulement.
//
//   npx jiti tools/test-espace-joueur.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ageAt,
  claimErrorText,
  cleanLines,
  cleanSelf,
  cleanYear,
  clubYears,
  DEFAULT_PLAYER_MIN_AGE,
  formatInviteCode,
  INVITE_ALPHABET,
  INVITE_LENGTH,
  inviteMessage,
  isInviteCode,
  letterQuestions,
  normalizeInviteCode,
  PLAYER_SPACE_KEY,
  PLAYER_TABLES,
  playerAccess,
  playerAgeCheck,
  playerMinAgeOf,
  playerMinAgeOk,
  playerReadsTable,
  sameSelf,
  SELF_LIMITS,
  selfIsEmpty,
} from '../src/playerSpace'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

const TODAY = '2026-10-19'
const POS = ['GB', 'AG', 'ARG', 'DC', 'ARD', 'AD', 'PIV']

// ---------- Ce que le joueur écrit ----------

t('lettre : textes coupés, vides retirés, caractères de contrôle enlevés', () => {
  const r = cleanSelf({ letter: { why: '  Le plaisir\u0000 de jouer \r\n ensemble ', proud: '   ', work: 'x'.repeat(SELF_LIMITS.text + 50), free: 7 } }, POS, TODAY)
  assert.equal(r.self?.letter?.why, 'Le plaisir de jouer \n ensemble')
  assert.equal(r.self?.letter?.proud, undefined)
  assert.equal(r.self?.letter?.work?.length, SELF_LIMITS.text)
  assert.equal(r.self?.letter?.free, undefined)
  assert.ok(r.notes.some((x) => x.includes('coupée')))
  assert.equal(r.self?.path, undefined)
  assert.ok(r.size > 0 && r.size === JSON.stringify(r.self).length)
})
t('parcours : clubs sans nom écartés, années invalides retirées, années inversées remises dans l’ordre, limite de clubs', () => {
  const r = cleanSelf(
    {
      path: {
        clubs: [
          { name: ' HBC fictif ', from: '2019', to: '2022' },
          { name: '', from: '2000' },
          { name: 'Entente fictive', from: '2024', to: '2021' },
          { name: 'Club trois', from: 'abcd', to: 2025 },
          { name: 'Club futur', from: '2099' },
          ...Array.from({ length: 30 }, (_, i) => ({ name: `Club ${i}` })),
        ],
      },
    },
    POS,
    TODAY,
  )
  const clubs = r.self?.path?.clubs ?? []
  assert.equal(clubs.length, SELF_LIMITS.clubs)
  assert.deepEqual(clubs[0], { name: 'HBC fictif', from: '2019', to: '2022' })
  assert.deepEqual(clubs[1], { name: 'Entente fictive', from: '2021', to: '2024' })
  assert.deepEqual(clubs[2], { name: 'Club trois', to: '2025' })
  assert.deepEqual(clubs[3], { name: 'Club futur' })
  assert.ok(r.notes.some((x) => x.includes('ordre')))
  assert.ok(r.notes.some((x) => x.includes('non reconnue')))
})
t('parcours : postes inconnus écartés, doublons retirés ; sélections et palmarès une ligne par entrée', () => {
  const r = cleanSelf({ path: { positions: ['DC', 'XX', 'DC', 'PIV'], selections: 'Comité fictif 2024\n\n  Ligue fictive 2025 \nComité fictif 2024', honours: ['', '  '] } }, POS, TODAY)
  assert.deepEqual(r.self?.path?.positions, ['DC', 'PIV'])
  assert.deepEqual(r.self?.path?.selections, ['Comité fictif 2024', 'Ligue fictive 2025'])
  assert.equal(r.self?.path?.honours, undefined)
  assert.ok(r.notes.some((x) => x.includes('Poste inconnu')))
})
t('rien d’écrit : rien d’enregistré', () => {
  const r = cleanSelf({ letter: { why: ' ' }, path: { clubs: [{ name: '' }], positions: ['ZZ'], selections: '\n\n' } }, POS, TODAY)
  assert.equal(r.self, undefined)
  assert.equal(r.size, 0)
  assert.equal(selfIsEmpty(r.self), true)
  assert.equal(selfIsEmpty({ letter: {}, path: { clubs: [] } }), true)
  assert.equal(selfIsEmpty({ letter: { why: 'oui' } }), false)
  assert.equal(cleanSelf(null, POS, TODAY).self, undefined)
  assert.equal(cleanSelf('texte', POS, TODAY).self, undefined)
})
t('lignes : vides retirées, doublons retirés, longueur et nombre limités', () => {
  assert.deepEqual(cleanLines(' a \n\nb\na', 10, 5), ['a', 'b'])
  assert.deepEqual(cleanLines('abcdefgh', 10, 5), ['abcde'])
  assert.equal(cleanLines(Array.from({ length: 50 }, (_, i) => `l${i}`)).length, SELF_LIMITS.lines)
  assert.deepEqual(cleanLines(42), [])
})
t('année : quatre chiffres entre 1950 et l’an prochain', () => {
  assert.equal(cleanYear('2020', TODAY), '2020')
  assert.equal(cleanYear(2027, TODAY), '2027')
  assert.equal(cleanYear('2028', TODAY), undefined)
  assert.equal(cleanYear('1949', TODAY), undefined)
  assert.equal(cleanYear('20', TODAY), undefined)
  assert.equal(clubYears({ from: '2019', to: '2022' }), '2019 – 2022')
  assert.equal(clubYears({ from: '2022', to: '2022' }), '2022')
  assert.equal(clubYears({ from: '2022' }), 'depuis 2022')
  assert.equal(clubYears({ to: '2020' }), 'jusqu’en 2020')
  assert.equal(clubYears({}), '')
})
t('même saisie ou non (updatedAt ignoré)', () => {
  assert.equal(sameSelf({ letter: { why: 'a' }, updatedAt: '1' }, { letter: { why: 'a' }, updatedAt: '2' }), true)
  assert.equal(sameSelf({ letter: { why: 'a' } }, { letter: { why: 'b' } }), false)
  assert.equal(sameSelf(undefined, {}), true)
})
t('questions de la lettre : accord au féminin seulement quand la fiche dit F', () => {
  assert.equal(letterQuestions('F')[1].label, 'Un moment dont tu es fière')
  assert.equal(letterQuestions('M')[1].label, 'Un moment dont tu es fier')
  assert.equal(letterQuestions(undefined)[1].label, 'Un moment dont tu es fier')
  assert.deepEqual(
    letterQuestions().map((q) => q.key),
    ['why', 'proud', 'work', 'free'],
  )
})

// ---------- Âge minimum ----------

t('âge révolu à une date', () => {
  assert.equal(ageAt('2016-10-19', TODAY), 10)
  assert.equal(ageAt('2016-10-20', TODAY), 9)
  assert.equal(ageAt('2016-01-01', TODAY), 10)
  assert.equal(ageAt(undefined, TODAY), null)
  assert.equal(ageAt('2016', TODAY), null)
  assert.equal(ageAt('2016-13-01', TODAY), null)
})
t('relier un compte : date manquante, trop jeune, ou ok', () => {
  assert.equal(playerAgeCheck(undefined, 10, TODAY), 'missing')
  assert.equal(playerAgeCheck('2016-10-20', 10, TODAY), 'young')
  assert.equal(playerAgeCheck('2016-10-19', 10, TODAY), 'ok')
  assert.equal(playerMinAgeOk('2016-10-19', 10, TODAY), true)
  assert.equal(playerMinAgeOk('2016-10-19', 11, TODAY), false)
  assert.equal(playerMinAgeOk('', 10, TODAY), false)
})
t('âge minimum lu dans la configuration (défaut 10 ; entre 6 et 18)', () => {
  assert.equal(DEFAULT_PLAYER_MIN_AGE, 10)
  assert.equal(playerMinAgeOf([]), 10)
  assert.equal(playerMinAgeOf([{ id: PLAYER_SPACE_KEY, value: { playerMinAge: 12 } }]), 12)
  assert.equal(playerMinAgeOf([{ id: 'x', key: PLAYER_SPACE_KEY, value: { playerMinAge: 8 } }]), 8)
  assert.equal(playerMinAgeOf([{ id: PLAYER_SPACE_KEY, value: { playerMinAge: 25 } }]), 10)
  assert.equal(playerMinAgeOf([{ id: PLAYER_SPACE_KEY, value: { playerMinAge: '12' } }]), 10)
  assert.equal(playerMinAgeOf([{ id: PLAYER_SPACE_KEY, value: { playerMinAge: 12 }, deleted: true }]), 10)
})

// ---------- Code d'invitation ----------

t('alphabet du code : 32 caractères, sans O, 0, I ni 1', () => {
  assert.equal(INVITE_ALPHABET.length, 32)
  for (const c of 'O0I1') assert.ok(!INVITE_ALPHABET.includes(c), c)
  assert.equal(new Set(INVITE_ALPHABET).size, 32)
  assert.equal(INVITE_LENGTH, 8)
})
t('code : mise en forme et validité', () => {
  assert.equal(normalizeInviteCode(' ab cd-ef gh '), 'ABCDEFGH')
  assert.equal(isInviteCode('abcd efgh'), true)
  assert.equal(isInviteCode('ABCDEFG'), false)
  assert.equal(isInviteCode('ABCDEFGO'), false) // O interdit
  assert.equal(isInviteCode('ABCDEFG1'), false) // 1 interdit
  assert.equal(isInviteCode('ABCD EFG2'), true)
  assert.equal(formatInviteCode('abcdefgh'), 'ABCD EFGH')
  assert.equal(formatInviteCode('abc'), 'ABC')
})
t('texte prêt à envoyer', () => {
  assert.equal(inviteMessage('abcd efgh'), 'Ton code Nextar : ABCDEFGH, valable 30 jours')
  assert.equal(inviteMessage('ABCDEFGH', 'MonAppli', 7), 'Ton code MonAppli : ABCDEFGH, valable 7 jours')
})
t('messages d’erreur du serveur, en clair', () => {
  assert.ok(claimErrorText('code_expire').includes('expiré'))
  assert.ok(claimErrorText('trop_jeune').includes('encadrant'))
  assert.ok(claimErrorText('naissance_manquante').includes('encadrant'))
  assert.ok(claimErrorText('code_inconnu').includes('8 caractères'))
  assert.ok(claimErrorText('autre chose').includes('autre chose'))
  assert.ok(claimErrorText(undefined).includes('internet'))
})
t('même alphabet et mêmes codes d’erreur que le serveur (051)', () => {
  const sql = readFileSync(new URL('../supabase/051_espace_joueur.sql', import.meta.url), 'utf8')
  assert.ok(sql.includes(`'${INVITE_ALPHABET}'`), 'alphabet du code')
  for (const k of ['code_inconnu', 'code_expire', 'code_utilise', 'naissance_manquante', 'trop_jeune', 'fiche_introuvable', 'pas_joueur', 'deja_relie'])
    assert.ok(sql.includes(`'${k}'`), k)
  assert.ok(sql.includes(`'${PLAYER_SPACE_KEY}'`), 'clé de configuration')
  assert.ok(sql.includes(String(SELF_LIMITS.total)), 'taille maximale')
  assert.ok(sql.includes(`interval '30 days'`), 'validité du code')
})

// ---------- Ce qu'un compte joueur voit ----------

t('compte joueur sans fiche reliée : rien (« Entre ton code ») ; avec fiche : sa page ; staff : l’appli', () => {
  assert.equal(playerAccess('joueur', null), 'claim')
  assert.equal(playerAccess('joueur', ''), 'claim')
  assert.equal(playerAccess('joueur', 'p1'), 'page')
  assert.equal(playerAccess('observateur', 'p1'), 'staff')
  assert.equal(playerAccess('admin', null), 'staff')
  assert.equal(playerAccess(null, null), 'staff')
})
t('synchronisation d’un compte joueur : sa fiche, la configuration et les listes, rien d’autre', () => {
  assert.deepEqual([...PLAYER_TABLES], ['players', 'config', 'lists'])
  for (const x of ['evaluations', 'measurements', 'events', 'groups', 'seen', 'rewatch', 'videos', 'follows', 'teams', 'alerts', 'criteria', 'question_log', 'levels', 'units', 'assignments'])
    assert.equal(playerReadsTable(x), false, x)
  assert.equal(playerReadsTable('players'), true)
})

console.log(`\n${n} tests ok`)
