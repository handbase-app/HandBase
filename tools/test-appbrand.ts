// Test de l'identité de l'appli (src/appBrandCore.ts) : réglage absent ou invalide → Nextar ; nom nettoyé ; logos vérifiés
// comme le logo de l'organisation (SVG sûr, taille limitée) ; images par défaut ; nom pour les fichiers.
//
//   npx jiti tools/test-appbrand.ts
import assert from 'node:assert/strict'
import { APP_KEY, APP_NAME_MAX, appImagesOf, appNameOf, appSlugOf, cleanAppBrand, DEFAULT_APP_NAME, isDefaultAppBrand, resolveAppBrand } from '../src/appBrandCore'
import { LOGO_MAX_CHARS, svgDataUrl } from '../src/uiStyle'

const png = 'data:image/png;base64,iVBORw0KGgo='
const svgOk = svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#123"/></svg>')
const svgBad = svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle r="4"/></svg>')
const svgExt = svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://exemple.test/x.png"/></svg>')

// Absent, vide, illisible : Nextar.
assert.equal(DEFAULT_APP_NAME, 'Nextar')
assert.equal(APP_KEY, 'appli')
for (const v of [undefined, null, 0, 'Nextar', [], [1], true]) assert.deepEqual(cleanAppBrand(v), {}, `valeur invalide : ${JSON.stringify(v)}`)
assert.deepEqual(resolveAppBrand(), {})
assert.deepEqual(resolveAppBrand([]), {})
assert.equal(appNameOf(resolveAppBrand([])), 'Nextar')
assert.ok(isDefaultAppBrand({}))

// Nom : espaces nettoyés, coupé à APP_NAME_MAX, vide → Nextar ; type faux ignoré.
assert.deepEqual(cleanAppBrand({ name: '  Talent   Scope ' }), { name: 'Talent Scope' })
assert.equal(cleanAppBrand({ name: 'x'.repeat(80) }).name?.length, APP_NAME_MAX)
assert.equal(appNameOf(cleanAppBrand({ name: '   ' })), 'Nextar')
assert.equal(appNameOf(cleanAppBrand({ name: 42 })), 'Nextar')

// Logos : PNG et SVG sûr gardés ; SVG piégé, lien externe, adresse, trop lourd, mauvais type : ignorés (les autres champs restent).
assert.deepEqual(cleanAppBrand({ logo: png, mark: svgOk }), { logo: png, mark: svgOk })
assert.deepEqual(cleanAppBrand({ name: 'A', logo: svgBad }), { name: 'A' }, 'SVG piégé refusé')
assert.deepEqual(cleanAppBrand({ mark: svgExt }), {}, 'SVG avec image externe refusé')
assert.deepEqual(cleanAppBrand({ logo: 'https://exemple.test/logo.png' }), {}, 'adresse refusée')
assert.deepEqual(cleanAppBrand({ logo: 'javascript:alert(1)' }), {}, 'javascript: refusé')
assert.deepEqual(cleanAppBrand({ mark: 'data:image/png;base64,' + 'A'.repeat(LOGO_MAX_CHARS) }), {}, 'trop lourd')
assert.deepEqual(cleanAppBrand({ logo: 12, mark: {} }), {})

// Lecture dans hb_config : la clé « appli », pas une autre ; ligne supprimée ignorée ; clé portée par id ou key.
const rows = [
  { id: 'apparence', key: 'apparence', value: { style: 'officiel', name: 'Fédération (fictive)' } },
  { id: 'appli', key: 'appli', value: { name: 'Autre Nom', mark: png } },
]
assert.deepEqual(resolveAppBrand(rows), { name: 'Autre Nom', mark: png })
assert.deepEqual(resolveAppBrand([{ ...rows[1], deleted: true }]), {})
assert.deepEqual(resolveAppBrand([{ id: 'appli', value: { name: 'Par id' } }]), { name: 'Par id' })
assert.deepEqual(resolveAppBrand([{ id: 'appli', value: 'texte' }]), {})

// Images : défauts Nextar ; pictogramme = le sien, sinon le logo réglé ; logo complet portant « Nextar » (l'icône de l'appli,
// celle du sport de la construction) seulement si l'appli s'appelle encore Nextar.
assert.deepEqual(appImagesOf({}, '/B/'), { logo: '/B/icon.svg', mark: '/B/brand/nextar-pictogramme.svg' })
assert.deepEqual(appImagesOf({ name: 'NEXTAR' }, '/'), { logo: '/icon.svg', mark: '/brand/nextar-pictogramme.svg' })
assert.deepEqual(appImagesOf({ name: 'Autre' }, '/'), { logo: '/brand/nextar-pictogramme.svg', mark: '/brand/nextar-pictogramme.svg' })
assert.deepEqual(appImagesOf({ logo: png }, '/'), { logo: png, mark: png })
assert.deepEqual(appImagesOf({ mark: svgOk }, '/'), { logo: svgOk, mark: svgOk })
assert.deepEqual(appImagesOf({ logo: png, mark: svgOk }, '/'), { logo: png, mark: svgOk })

// Nom pour les fichiers.
assert.equal(appSlugOf({}), 'nextar')
assert.equal(appSlugOf({ name: 'Détection Élite 2' }), 'detection-elite-2')
assert.equal(appSlugOf({ name: '***' }), 'nextar')

console.log('✓ identité de l’appli : défauts Nextar, nom, logos vérifiés, lecture de la configuration, images, nom de fichier')
