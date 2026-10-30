// Test de l'onglet gardé d'un élément à l'autre (src/tabQuery.ts) : fiche d'un joueur (?onglet=…, ?fiche=… sous
// /bilan/joueurs où `onglet` est celui du bilan), onglet par défaut sans paramètre, onglet inconnu => défaut,
// autres paramètres (état de la liste d'origine) gardés.
//
//   npx jiti tools/test-onglets.ts
import assert from 'node:assert/strict'
import { keepPlayerTab, keepTab, playerTabParam, PLAYER_TABS, radarViewOf, tabOf, withRadarView, withTab } from '../src/tabQuery'

// Lecture
assert.equal(tabOf('?onglet=croissance', PLAYER_TABS, 'profil'), 'croissance')
assert.equal(tabOf('', PLAYER_TABS, 'profil'), 'profil')
assert.equal(tabOf('?onglet=video', PLAYER_TABS, 'profil'), 'profil')
assert.equal(tabOf('?onglet=videos', PLAYER_TABS, 'profil'), 'videos')
assert.equal(tabOf('?onglet=compte', PLAYER_TABS, 'profil'), 'compte')
assert.equal(tabOf('?onglet=vus&fiche=tests', PLAYER_TABS, 'profil', 'fiche'), 'tests')

// Écriture : défaut et inconnu sans paramètre, les autres paramètres restent
assert.equal(withTab('', 'avis', PLAYER_TABS, 'profil'), '?onglet=avis')
assert.equal(withTab('?onglet=avis', 'profil', PLAYER_TABS, 'profil'), '')
assert.equal(withTab('', 'classement', PLAYER_TABS, 'profil'), '')
assert.equal(withTab('?r=abc', 'tests', PLAYER_TABS, 'profil'), '?r=abc&onglet=tests')
assert.equal(withTab('?onglet=vus&s=all', 'croissance', PLAYER_TABS, 'profil', 'fiche'), '?onglet=vus&s=all&fiche=croissance')

// D'un élément à l'autre (onglet absent chez l'autre type : retour à l'onglet par défaut)
assert.equal(keepTab('', '?onglet=video', ['joueurs', 'classement', 'video'], 'joueurs'), '?onglet=video')
assert.equal(keepTab('', '?onglet=croissance', ['joueurs', 'classement', 'video'], 'joueurs'), '')
assert.equal(keepPlayerTab('', '/joueurs', '?onglet=croissance'), '?onglet=croissance')
assert.equal(keepPlayerTab('', '/joueurs', ''), '')
assert.equal(keepPlayerTab('', '/evenements/e1/joueurs', '?onglet=tests'), '?onglet=tests')
// Bilan : l'onglet du bilan reste celui de la liste, celui de la fiche suit
assert.equal(playerTabParam('/bilan/joueurs'), 'fiche')
assert.equal(playerTabParam('/bilan/question/joueurs'), 'onglet')
assert.equal(keepPlayerTab('?onglet=licencies&s=all', '/bilan/joueurs', '?onglet=licencies&s=all&fiche=croissance'), '?onglet=licencies&s=all&fiche=croissance')
assert.equal(keepPlayerTab('?onglet=licencies', '/bilan/joueurs', '?onglet=licencies'), '?onglet=licencies')
// Réponse à une question : ses paramètres, plus l'onglet
assert.equal(keepPlayerTab('?r=xyz', '/bilan/question/joueurs', '?r=xyz&onglet=avis'), '?r=xyz&onglet=avis')

// Vue du radar de la comparaison : défaut selon l'écran, choix toujours écrit, a= b= c= gardés
assert.equal(radarViewOf('?a=1&b=2', false), 'complet')
assert.equal(radarViewOf('?a=1&b=2', true), 'familles')
assert.equal(radarViewOf('?a=1&radar=complet', true), 'complet')
assert.equal(radarViewOf('?radar=zzz', false), 'complet')
assert.equal(withRadarView('?a=1&b=2&c=3', 'familles'), '?a=1&b=2&c=3&radar=familles')
assert.equal(withRadarView('?a=1&radar=familles&evenement=e', 'complet'), '?a=1&evenement=e&radar=complet')

// Fiche d'un joueur : la vue du radar suit d'un joueur à l'autre, avec l'onglet, sans écraser la liste d'origine
assert.equal(keepPlayerTab('', '/joueurs', '?onglet=avis&radar=familles'), '?onglet=avis&radar=familles')
assert.equal(keepPlayerTab('?onglet=licencies&club=x', '/bilan/joueurs', '?onglet=licencies&club=x&fiche=avis&radar=complet'), '?onglet=licencies&club=x&fiche=avis&radar=complet')
assert.equal(keepPlayerTab('?r=xyz', '/bilan/question/joueurs', '?r=xyz&onglet=avis&radar=zzz'), '?r=xyz&onglet=avis')
assert.equal(keepPlayerTab('', '/joueurs', '?radar=familles'), '?radar=familles')

console.log('onglets : ok')
