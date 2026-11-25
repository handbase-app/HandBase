// Test des préférences liées au compte (src/preferencesCore.ts) : thème, style personnel, filtre Garçons / Filles ; valeur
// du compte illisible ou partielle, thème ou style disparus de l'appli, ce qui part au serveur.
//
//   npx jiti tools/test-preferences.ts
import assert from 'node:assert/strict'
import { DEFAULT_PREFERENCES, parsePreferences, parseSex, PREF_STORAGE, preferencesPayload, samePreferences } from '../src/preferencesCore'

const known = { themes: ['auto', 'nuit', 'ocean', 'clair'], styles: ['actuel', 'stade'] }

// Clés de l'appareil inchangées (rien ne se perd à la mise à jour).
assert.deepEqual(PREF_STORAGE, { theme: 'handbase.theme', style: 'handbase.style', sexe: 'handbase.sexFilter' })

// Rien d'utilisable : null (l'appareil envoie alors ses choix).
for (const v of [null, undefined, 0, 'nuit', [], {}, { autre: 1 }]) assert.equal(parsePreferences(v, known), null, JSON.stringify(v))

// Valeur complète.
assert.deepEqual(parsePreferences({ theme: 'ocean', style: 'stade', sexe: 'F' }, known), { theme: 'ocean', style: 'stade', sexe: 'F' })
// Partielle, ou thème / style retirés de l'appli, sexe inconnu : défaut pour la clé en cause seulement.
assert.deepEqual(parsePreferences({ theme: 'nuit' }, known), { theme: 'nuit', style: null, sexe: 'all' })
assert.deepEqual(parsePreferences({ theme: 'disparu', style: 'vieux', sexe: 'X' }, known), DEFAULT_PREFERENCES)
assert.deepEqual(parsePreferences({ sexe: 'M', style: null }, known), { theme: 'auto', style: null, sexe: 'M' })

// Ce qui part au serveur : les trois clés, ordre fixe ; comparaison indépendante de l'ordre.
assert.deepEqual(Object.keys(preferencesPayload({ sexe: 'M', style: null, theme: 'clair' } as never)), ['theme', 'style', 'sexe'])
assert.ok(samePreferences({ theme: 'clair', style: null, sexe: 'M' }, { sexe: 'M', theme: 'clair', style: null } as never))
assert.ok(!samePreferences({ theme: 'clair', style: null, sexe: 'M' }, { theme: 'clair', style: null, sexe: 'F' }))

// Filtre de l'appareil.
assert.equal(parseSex('M'), 'M')
assert.equal(parseSex('F'), 'F')
for (const v of [null, '', 'all', 'm', 'garcons']) assert.equal(parseSex(v), 'all')

console.log('preferences : OK')
