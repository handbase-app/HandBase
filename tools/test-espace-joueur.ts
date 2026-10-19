// Test de l'espace joueur (src/playerSpace.ts, règles reprises par supabase/051_espace_joueur.sql) : nettoyage de ce que le
// joueur écrit (tailles, lignes vides, années de clubs, postes inconnus), âge minimum (réglage de l'installation), code
// d'invitation (alphabet sans O / 0 / I / 1, mise en forme, texte prêt à envoyer), messages d'erreur, ce qu'un compte
// joueur voit (sans fiche reliée : rien), tables reçues par sa synchronisation. 052 : « Mes repères », versions précédentes de
// la lettre (enregistrement sur l'appareil, même règle que le serveur), « Mon journal du hand » (humeurs, notes, partage,
// tendance pour le staff sans texte, dates), « J'ai besoin d'en parler », création du compte depuis la fiche, « Télécharger
// mes données », cohérence avec supabase/052_journal_joueur.sql. Données fictives seulement.
//
//   npx jiti tools/test-espace-joueur.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  accountErrorText,
  accountMessage,
  ACCOUNT_ERRORS,
  ageAt,
  cleanMood,
  HELP_CONTACTS,
  isEmail,
  JOURNAL_ERRORS,
  JOURNAL_MOODS,
  journalAdd,
  journalDay,
  journalDelete,
  journalEdit,
  journalErrorText,
  journalShare,
  markFields,
  moodCounts,
  moodLabel,
  moodTrend,
  moodTrendSummary,
  myDataExport,
  myDataFileName,
  newNoteId,
  playerContactOf,
  provisionalPassword,
  saveSelfLocal,
  withNote,
  type JournalNote,
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


// ---------- 052 : repères, versions de la lettre ----------

t('repères : une ligne, 80 caractères, clés inconnues et nombres ignorés ; comptent pour « rien d’écrit » et « même saisie »', () => {
  const r = cleanSelf({ marks: { favPlayer: '  Une joueuse\n fictive ', favTeam: 'e'.repeat(100), dreamPosition: 12, memorableMatch: ' ', hack: 'x' } }, POS, TODAY)
  assert.deepEqual(r.self?.marks, { favPlayer: 'Une joueuse fictive', favTeam: 'e'.repeat(SELF_LIMITS.mark) })
  assert.equal(SELF_LIMITS.mark, 80)
  assert.equal(selfIsEmpty({ marks: { favTeam: 'Équipe fictive' } }), false)
  assert.equal(selfIsEmpty({ letterHistory: [{ at: '2026-01-01T00:00:00Z', letter: { why: 'a' } }] }), false)
  assert.equal(sameSelf({ marks: { favTeam: 'a' } }, { marks: { favTeam: 'b' } }), false)
  assert.equal(sameSelf({ marks: { favTeam: 'a' }, letterHistory: [] }, { marks: { favTeam: 'a' } }), true)
})
t('repères : libellés accordés (« Ma joueuse préférée » seulement pour une fiche F)', () => {
  assert.equal(markFields('F')[0].label, 'Ma joueuse préférée')
  assert.equal(markFields('M')[0].label, 'Mon joueur préféré')
  assert.equal(markFields(undefined)[0].short, 'Joueur préféré')
  assert.deepEqual(markFields().map((m) => m.key), ['favPlayer', 'favTeam', 'dreamPosition', 'memorableMatch'])
})
t('versions de la lettre (appareil, même règle que le serveur) : seulement quand la lettre change, datées, 20 au plus', () => {
  const T1 = '2026-10-01T10:00:00.000Z'
  const T2 = '2026-10-02T10:00:00.000Z'
  const T3 = '2026-10-03T10:00:00.000Z'
  const a = saveSelfLocal(undefined, { letter: { why: 'A' }, marks: { favTeam: 'X' } }, T1)!
  assert.equal(a.letterAt, T1)
  assert.equal(a.letterHistory, undefined)
  // Même lettre, repères changés : rien dans l'historique, date de la lettre gardée.
  const b = saveSelfLocal(a, { letter: { why: 'A' }, marks: { favTeam: 'Y' } }, T2)!
  assert.equal(b.letterHistory, undefined)
  assert.equal(b.letterAt, T1)
  // Lettre changée : l'ancienne part, datée de son écriture.
  const c = saveSelfLocal(b, { letter: { why: 'B' } }, T3)!
  assert.deepEqual(c.letterHistory, [{ at: T1, letter: { why: 'A' } }])
  assert.equal(c.letterAt, T3)
  assert.equal(c.marks, undefined)
  // Tout effacé : l'historique reste.
  const d = saveSelfLocal(c, undefined, T3)!
  assert.equal(d.letter, undefined)
  assert.equal(d.letterHistory?.length, 2)
  // 25 lettres : 20 versions.
  let s: ReturnType<typeof saveSelfLocal> = undefined
  for (let i = 1; i <= 25; i++) s = saveSelfLocal(s, { letter: { why: `V${i}` } }, `2026-10-${String(i).padStart(2, '0')}T10:00:00.000Z`)
  assert.equal(s?.letterHistory?.length, SELF_LIMITS.letterVersions)
  assert.equal(s?.letterHistory?.[0].letter.why, 'V24')
  assert.equal(s?.letterHistory?.[19].letter.why, 'V5')
  assert.equal(s?.letter?.why, 'V25')
})

// ---------- 052 : journal du hand ----------

t('humeurs : liste fermée de 8, positives ou neutres, accordées (« motivée », « déçue », « fatiguée » pour une fiche F)', () => {
  assert.deepEqual(JOURNAL_MOODS.map((m) => m.id), ['motive', 'content', 'fier', 'concentre', 'serein', 'pensif', 'decu', 'fatigue'])
  assert.equal(moodLabel('motive', 'F'), 'motivée')
  assert.equal(moodLabel('fier', 'F'), 'fière')
  assert.equal(moodLabel('pensif', 'F'), 'pensive')
  assert.equal(moodLabel('decu', 'F'), 'déçue')
  assert.equal(moodLabel('fatigue', 'M'), 'fatigué')
  assert.equal(moodLabel('serein', undefined), 'serein')
  assert.equal(moodLabel('triste', 'F'), '')
  assert.equal(cleanMood('triste'), undefined)
  assert.equal(cleanMood('content'), 'content')
  for (const m of JOURNAL_MOODS) assert.ok(m.emoji.length >= 1)
})
const NOW = '2026-10-20T08:00:00.000Z'
t('note : texte nettoyé, vide refusé, 1 000 caractères, humeur hors liste ignorée, privée, en tête', () => {
  let r = journalAdd([], '  Super match\r\n ce week-end \u0001 ', 'fier', NOW, 'n1')
  assert.ok(r.ok)
  assert.deepEqual(r.ok && r.note, { id: 'n1', at: NOW, text: 'Super match\n ce week-end', mood: 'fier', shared: false })
  assert.equal(journalAdd([], '   ', 'fier', NOW).ok, false)
  assert.equal((journalAdd([], '  ', null, NOW) as { error: string }).error, 'note_vide')
  r = journalAdd([], 'x'.repeat(1500), 'triste', NOW, 'n2')
  assert.ok(r.ok && r.note!.text.length === SELF_LIMITS.note && r.note!.mood === undefined)
  const older: JournalNote = { id: 'old', at: '2026-10-01T08:00:00.000Z', text: 'avant' }
  r = journalAdd([older], 'après', null, NOW, 'n3')
  assert.deepEqual(r.ok && r.notes.map((n) => n.id), ['n3', 'old'])
  assert.match(newNoteId(), /^n[A-Za-z0-9]{10}$/)
})
t('200 notes au plus : les plus anciennes ne sont plus gardées', () => {
  let notes: JournalNote[] = []
  for (let i = 1; i <= 205; i++) {
    const r = journalAdd(notes, `Note ${i}`, null, new Date(Date.UTC(2026, 0, 1) + i * 3600_000).toISOString(), `n${i}`)
    if (r.ok) notes = r.notes
  }
  assert.equal(notes.length, SELF_LIMITS.notes)
  assert.equal(notes[0].text, 'Note 205')
  assert.equal(notes[199].text, 'Note 6')
})
t('correction (date gardée, editedAt, partage gardé), partage, suppression ; note inconnue refusée', () => {
  const base: JournalNote[] = [{ id: 'a', at: '2026-10-01T08:00:00.000Z', text: 'Avant', mood: 'pensif', shared: true }]
  const r = journalEdit(base, 'a', ' Après ', 'colère', NOW)
  assert.ok(r.ok)
  assert.deepEqual(r.ok && r.note, { id: 'a', at: '2026-10-01T08:00:00.000Z', text: 'Après', shared: true, editedAt: NOW })
  assert.equal((journalEdit(base, 'zz', 'x', null, NOW) as { error: string }).error, 'note_introuvable')
  assert.equal((journalEdit(base, 'a', ' ', null, NOW) as { error: string }).error, 'note_vide')
  const s = journalShare(base, 'a', false)
  assert.ok(s.ok && s.note!.shared === false)
  assert.deepEqual(journalDelete(base, 'a'), [])
  assert.deepEqual(journalDelete(base, 'zz'), base)
  assert.deepEqual(withNote(base, { ...base[0], text: 'Remplacée' }).map((n) => n.text), ['Remplacée'])
  assert.deepEqual(withNote(base, { id: 'b', at: NOW, text: 'Nouvelle' }).map((n) => n.id), ['b', 'a'])
})
t('messages clairs pour les refus du serveur', () => {
  for (const k of ['note_vide', 'note_introuvable', 'self_trop_long']) assert.ok(JOURNAL_ERRORS[k] && journalErrorText(k) === JOURNAL_ERRORS[k], k)
  assert.ok(journalErrorText('x', 'PGRST202').includes('pas encore ouvert'))
  assert.ok(journalErrorText(undefined).includes('internet'))
})
t('dates du journal : « lundi 19 octobre », l’année en plus si ce n’est pas l’année en cours', () => {
  const now = new Date('2026-10-20T12:00:00')
  assert.equal(journalDay('2026-10-19T12:00:00', now), 'lundi 19 octobre')
  assert.equal(journalDay('2025-10-20T12:00:00', now), 'lundi 20 octobre 2025')
  assert.equal(journalDay('pas une date', now), '')
})
t('tendance (staff) : 8 semaines du lundi, nombre de notes et d’humeurs, jamais de texte ; phrase accordée', () => {
  const now = new Date('2026-10-21T12:00:00') // mercredi
  const notes: JournalNote[] = [
    { id: '1', at: '2026-10-20T09:00:00', text: 'secret 1', mood: 'motive' },
    { id: '2', at: '2026-10-19T09:00:00', text: 'secret 2', mood: 'motive' },
    { id: '3', at: '2026-10-14T09:00:00', text: 'secret 3', mood: 'pensif' },
    { id: '4', at: '2026-10-13T09:00:00', text: 'secret 4' },
    { id: '5', at: '2026-08-01T09:00:00', text: 'trop vieux', mood: 'decu' },
  ]
  const tr = moodTrend(notes, now)
  assert.equal(tr.weeks.length, 8)
  assert.equal(tr.weeks[7].from, '2026-10-19')
  assert.equal(tr.weeks[0].from, '2026-08-31')
  assert.deepEqual(tr.weeks[7], { from: '2026-10-19', notes: 2, moods: { motive: 2 } })
  assert.deepEqual(tr.weeks[6], { from: '2026-10-12', notes: 2, moods: { pensif: 1 } })
  assert.equal(tr.weeks.reduce((s, w) => s + w.notes, 0), 4)
  assert.ok(!JSON.stringify(tr).includes('secret'))
  assert.deepEqual(moodCounts(tr), [{ mood: 'motive', n: 2 }, { mood: 'pensif', n: 1 }])
  assert.equal(moodTrendSummary(tr, 'F'), 'surtout motivée, un peu pensive')
  assert.equal(moodTrendSummary(tr, 'M'), 'surtout motivé, un peu pensif')
  assert.equal(moodTrendSummary(moodTrend([notes[0]], now), 'F'), 'motivée')
  assert.equal(moodTrendSummary(moodTrend([notes[3]], now)), null)
  assert.equal(moodTrendSummary(null), null)
})

// ---------- 052 : aide, compte, copie ----------

t('« J’ai besoin d’en parler » : numéros officiels en liens tel: / mailto:, personne à contacter de l’installation', () => {
  const all = HELP_CONTACTS.map((c) => c.href).join(' ')
  for (const x of ['tel:3018', 'tel:119', 'tel:3114', 'tel:0800235236', 'mailto:signal-sports@sports.gouv.fr']) assert.ok(all.includes(x), x)
  for (const c of HELP_CONTACTS) assert.match(c.href, /^(tel:\d+|mailto:[^@\s]+@[^@\s]+)$/)
  assert.equal(playerContactOf([]), '')
  assert.equal(playerContactOf([{ id: PLAYER_SPACE_KEY, value: { playerMinAge: 12, contact: '  Responsable fictif\n06 00 00 00 00 ' } }]), 'Responsable fictif · 06 00 00 00 00')
  assert.equal(playerMinAgeOf([{ id: PLAYER_SPACE_KEY, value: { contact: 'x' } }]), DEFAULT_PLAYER_MIN_AGE)
})
t('compte créé depuis la fiche : message prêt à envoyer, mot de passe provisoire, refus en clair', () => {
  assert.equal(accountMessage(' Jeune@Exemple.fr ', 'abcd-efgh-jk'), 'Ton compte Nextar : jeune@exemple.fr, mot de passe provisoire abcd-efgh-jk, à changer à la première connexion.')
  const pw = provisionalPassword()
  assert.match(pw, /^[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{2}$/)
  assert.ok(pw.length >= 8)
  assert.equal(isEmail('a@b.fr'), true)
  assert.equal(isEmail('a@b'), false)
  assert.ok(accountErrorText('trop_jeune').includes('âge minimum'))
  assert.ok(accountErrorText('adresse_utilisee').includes('existe déjà'))
  assert.equal(accountErrorText('Réservé aux administrateurs et aux encadrants de cette fiche'), 'Réservé aux administrateurs et aux encadrants de cette fiche')
})
t('« Télécharger mes données » : tout ce que le jeune a écrit, notes privées comprises', () => {
  const notes: JournalNote[] = [
    { id: 'a', at: '2026-10-01T08:00:00.000Z', text: 'Privée', mood: 'serein' },
    { id: 'b', at: '2026-10-02T08:00:00.000Z', text: 'Partagée', shared: true, editedAt: NOW },
  ]
  const d = myDataExport({ prenom: 'Alix', nom: 'Fictif', club: undefined }, { letter: { why: 'Le plaisir' }, marks: { favTeam: 'X' }, letterHistory: [{ at: NOW, letter: { why: 'Avant' } }] }, notes, NOW)
  assert.deepEqual(d.identite, { prenom: 'Alix', nom: 'Fictif' })
  assert.equal(d.journal.length, 2)
  assert.deepEqual(d.journal[0], { date: '2026-10-02T08:00:00.000Z', humeur: null, texte: 'Partagée', partageeAvecMonEncadrant: true, corrigeeLe: NOW })
  assert.equal(d.journal[1].partageeAvecMonEncadrant, false)
  assert.equal(d.versionsPrecedentesDeLaLettre.length, 1)
  assert.equal(myDataFileName('nextar', '2026-10-20'), 'mes-donnees-nextar-2026-10-20.json')
})
t('mêmes humeurs, limites et codes d’erreur que le serveur (052)', () => {
  const sql = readFileSync(new URL('../supabase/052_journal_joueur.sql', import.meta.url), 'utf8')
  const list = sql.match(/p in \(([^)]*)\) then p end/)
  assert.ok(list, 'liste des humeurs dans hb_self_mood')
  assert.deepEqual(list![1].split(',').map((x) => x.trim().replace(/'/g, '')), JOURNAL_MOODS.map((m) => m.id))
  assert.ok(sql.includes('offset 200'), '200 notes')
  assert.ok(sql.includes('> 20 loop'), '20 versions')
  assert.ok(sql.includes(', 1000)'), '1 000 caractères')
  assert.ok(sql.includes(`, ${SELF_LIMITS.mark});`), 'repères')
  assert.ok(sql.includes(String(SELF_LIMITS.selfTotal)), 'taille de self')
  for (const k of [...Object.keys(JOURNAL_ERRORS).filter((k) => !['pas_joueur', 'sans_fiche', 'fiche_introuvable', 'trop_long'].includes(k)), ...Object.keys(ACCOUNT_ERRORS)])
    assert.ok(sql.includes(`'${k}'`), k)
  for (const f of ['hb_player_journal_add', 'hb_player_journal_edit', 'hb_player_journal_share', 'hb_player_journal_delete', 'hb_player_mood_trend', 'hb_create_player_account'])
    assert.ok(sql.includes(`grant execute on function public.${f}(`), f)
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
