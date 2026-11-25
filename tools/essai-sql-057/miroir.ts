// Comparaison du miroir de l'appli (src/syncLive.ts, rowChannels) avec hb_canaux_ligne sur le jeu fictif de essais.sql.
// Seule différence admise : hb:joueur:… (fiche d'un jeune qui a un compte), que l'appareil du staff ne connaît pas et
// n'écoute jamais.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { rowChannels, type SentRow } from '../../src/syncLive'
import { unitTerritory } from '../../src/eventOrganizer'

const j = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const players = new Map((j.joueurs as SentRow[]).map((p) => [p.id, p]))
const units = j.unites as never[]
const teams = j.staffs as { id: string; members?: string[] }[]
const look = {
  player: (id: string) => players.get(id) as never,
  territory: (id: string) => ((units as { id: string }[]).some((u) => u.id === id) ? unitTerritory(units, id) : undefined),
  teamMembers: (ids: readonly string[]) => teams.filter((t) => ids.includes(t.id)).flatMap((t) => t.members ?? []),
}
let n = 0
let joueur = 0
for (const l of j.lignes as { table: never; data: SentRow; canaux: string[] }[]) {
  const server = l.canaux.filter((c) => !c.startsWith('hb:joueur:'))
  joueur += l.canaux.length - server.length
  assert.deepEqual(rowChannels(l.table, l.data, look), [...server].sort(), `${l.table} ${l.data.id}`)
  n++
}
assert.equal(joueur, 1, 'hb:joueur:p1 côté serveur (compte joueur relié)')
console.log(`miroir : ${n} lignes, mêmes canaux que hb_canaux_ligne (hb:joueur:p1 seulement côté serveur)`)
