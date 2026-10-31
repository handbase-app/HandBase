// Miroir de supabase/061_registre_changements.sql (lancer.sh) : l'appareil (src/registre.ts) applique une VRAIE réponse du
// registre. Les lignes reçues en direct (ici : celles que le comité relit, notées « à confirmer ») dont l'empreinte calculée
// par l'appareil (src/filet.ts, rowHash) est celle du serveur sont confirmées sans relecture ; une ligne au contenu changé
// (forgée) et une ligne que l'appareil n'a pas sont relues par identifiant.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ledgerNote, rowHash, suaMicros, type Ledger } from '../../src/filet'
import { lireRegistre, planRegistre } from '../../src/registre'

type Ligne = { t: string; id: string; data: Record<string, unknown>; server_updated_at: string }
const line = readFileSync(process.argv[2], 'utf8').split('\n').find((l) => l.trim().startsWith('{'))
assert.ok(line, 'réponse absente')
const { reponse, lignes } = JSON.parse(line!) as { reponse: unknown; lignes: Ligne[] }
const rep = lireRegistre(reponse)
assert.ok(rep && rep.complet, 'réponse illisible ou pas complète')
const mesures = lignes.filter((l) => l.t === 'measurements')
const joueurs = lignes.filter((l) => l.t === 'players')
assert.ok(mesures.length >= 6 && joueurs.length >= 1, `lignes citées : ${mesures.length} mesures, ${joueurs.length} joueurs`)
// L'appareil tient toutes les mesures citées sauf la dernière, et la première est forgée (contenu changé).
let ledger: Ledger = {}
const tenues = mesures.slice(0, -1)
for (const [i, l] of tenues.entries()) {
  const us = suaMicros(l.server_updated_at)!
  const data = i === 0 ? { ...l.data, value: 999 } : l.data
  ledger = ledgerNote(ledger, 'measurements', [{ id: l.id, us, h: await rowHash(l.id, us, data) }])
}
const prov = new Set(tenues.map((l) => l.id))
const plan = planRegistre(rep!, ['measurements', 'players'], ledger, (t) => (t === 'measurements' ? prov : new Set()))
const m = plan.measurements
assert.ok(m, 'mesures pas planifiées')
assert.deepEqual(new Set(m.confirmer), new Set(tenues.slice(1).map((l) => l.id)), 'confirmées : les lignes tenues, même empreinte')
assert.deepEqual(new Set(m.lire), new Set([mesures[0].id, mesures[mesures.length - 1].id]), 'relues : la forgée et la manquante')
assert.ok(plan.players?.lire.includes('j-0027'), 'joueur changé, pas sur l’appareil : relu')
console.log(`  ${m.confirmer.length} lignes reçues en direct confirmées par l'empreinte du serveur (même calcul, octet pour octet), ${m.lire.length} relues (forgée, manquante), joueur changé relu`)
console.log('miroir : ok')
