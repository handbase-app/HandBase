#!/usr/bin/env python3
"""
Génère le script SQL d'import des tests physiques (fichiers Excel du préparateur physique).

    python3 tools/import_tests_physiques.py fichier1.xlsx [fichier2.xlsx…] --shirado-date AAAA-MM-JJ > import.sql

Le script produit contient des noms d'enfants : il ne doit PAS être enregistré dans le dépôt.
Il rapproche chaque joueur de sa fiche (nom + prénom + date de naissance) et ajoute les mesures ;
il peut être relancé sans créer de doublons. Rien n'est inventé : les joueurs introuvables sont listés.

Dépend de openpyxl (pip install openpyxl).
"""
import argparse
import datetime as dt
import hashlib
import json
import re
import sys
import unicodedata

import openpyxl
from openpyxl.utils import get_column_letter

# Dates d'en-tête manifestement fausses dans les fichiers (validé avec le staff).
DATE_FIXES = {dt.date(2026, 12, 16): dt.date(2025, 12, 16), dt.date(2025, 1, 28): dt.date(2026, 1, 28)}

AUTHOR = 'Tests physiques (Excel)'

# Colonnes de mesures sans date d'en-tête (« nv saison ») : date de la campagne correspondante.
MISSING_DATES = {('Rotary_Stability', 'H'): dt.date(2026, 8, 27), ('Rotary_Stability', 'I'): dt.date(2026, 8, 27)}

# Préférence motrice : critères créés dans l'appli (leurs identifiants sont retrouvés par leur nom).
LABEL_CRITERIA = {'@aerien': 'aérien%', '@oeil': '_eil directeur%'}


def fold(s):
    return unicodedata.normalize('NFD', str(s)).encode('ascii', 'ignore').decode().lower()


def key(nom, prenom):
    return re.sub(r'[^a-z]', '', fold(nom)) + '|' + re.sub(r'[^a-z]', '', fold(prenom))


def as_date(v):
    if isinstance(v, dt.datetime):
        d = v.date()
    elif isinstance(v, str) and re.fullmatch(r'\s*\d{2}/\d{2}/\d{4}\s*', v):
        d = dt.datetime.strptime(v.strip(), '%d/%m/%Y').date()
    else:
        return None
    return DATE_FIXES.get(d, d)


def parse_value(v):
    """(valeur, commentaire) : nombre si possible (« 12 (entorse) » → 12 + « entorse »), sinon le texte tel quel."""
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return (round(float(v), 4), None)
    s = str(v).strip()
    if not s or s.upper() in ('X', '??', '?') or s.startswith('#'):
        return None
    m = re.fullmatch(r'(-?\d+(?:[.,]\d+)?)\s*(?:\((.*)\)|\s+(.*))?', s)
    if m:
        note = (m.group(2) or m.group(3) or '').strip() or None
        return (float(m.group(1).replace(',', '.')), note)
    return (s, None)  # texte brut (ex. « 0-1 (d<g) ») : gardé tel quel


def criterion_for(sheet, block, label):
    """Critère de l'appli pour une colonne (feuille, titre du bloc, sous-titre de colonne)."""
    s, b, l = fold(sheet), fold(block), fold(label or '')
    if s == 'poids':
        return 'poids'
    if s.startswith('taille'):
        return 'taille_assise' if 'assis' in b else 'taille'
    if s == 'empan':
        return 'empan'
    if s == 'envergure':
        return 'envergure'
    if s.startswith('30-15'):
        return 'vift'
    if s == 't-test':
        return 't_test'
    if s == 'sprint':
        return 'sprint_30' if '30' in b else 'sprint_10'
    if s.startswith('lance'):
        return 'medball_conc' if l.startswith('concentrique') else 'medball_plio' if l.startswith('pliometrique') else None
    if s == 'broad_jump':
        return 'saut_largeur_g' if 'gauche' in b else 'saut_largeur_d' if 'droite' in b else 'saut_bilateral'
    if s == 'cheville':
        return 'dorsi_g' if l.startswith('g') else 'dorsi_d' if l.startswith('d') else None
    if s == 'epaule_re-ri':
        if 'en haut' in l:  # 2025 : score 0-3 par côté
            return 'epaule_g' if l.startswith('g') else 'epaule_d'
        return None  # 2026 (degrés) : traité à part
    if s.startswith('chaine'):
        return 'chaine_post_g' if l.startswith('g') else 'chaine_post_d' if l.startswith('d') else None
    if s == 'oh_squat':
        return 'ohs' if l.startswith('score') else None
    if s.startswith('trunk'):
        return 'trunk_pu' if l.startswith('score') else None
    if s.startswith('rotary'):
        return 'stab_rot' if l.startswith('score') else None
    if s.startswith('adducteur'):
        return 'adducteur' if l.startswith('score') else None
    if s.startswith('ri-re'):
        return 'hanche_ri' if l.startswith('ri') else 'hanche_re' if l.startswith('re') else None
    if s == 'sj-cmj':
        if b == 'eur':
            return 'eur'
        p = 'cmj' if b == 'cmj' else 'sj'
        if l.startswith('hauteur'):
            return f'{p}_hauteur'
        if l.startswith('peak power'):
            return f'{p}_puissance'
        if p == 'cmj' and l.startswith('rsi'):
            return 'cmj_rsi'
        return None
    if s == '6rm':
        for k, c in (('squat', 'rm6_squat'), ('bench', 'rm6_bench'), ('dl', 'rm6_dl'), ('clean', 'rm1_clean'),
                     ('traction', 'rm6_traction'), ('hip', 'rm6_hipthrust')):
            if l.startswith(k):
                return c
        return None
    if s.startswith('shirado'):
        if 'ratio' in l:
            return None
        return 'shirado' if 'shirado' in l else 'sorensen' if 'sorensen' in l else None
    if s.startswith('preference'):
        return '@aerien' if l.startswith('aerien') else '@oeil' if 'directeur' in l else None
    return None


def is_note(sheet, label):
    l = fold(label or '')
    return l.startswith('notes')


def is_player(r):
    a, b = r[0], (r[1] if len(r) > 1 else None)
    return bool(a and b and isinstance(b, str) and str(a).strip() != 'Nom' and not re.match(r'^\s*\d\s*:', str(a)))


def player_rows(ws):
    """Lignes de joueurs : nom et prénom remplis, hors en-têtes et légendes."""
    for i, r in enumerate(ws.iter_rows(values_only=True), 1):
        if is_player(r):
            yield i, r


def row_title(r):
    """Titre d'une ligne d'en-tête : 1er texte en colonne C ou plus loin, sinon en A (« EUR »)."""
    t = next((str(c) for c in r[2:] if isinstance(c, str) and c.strip() and not as_date(c)), None)
    if t is None and r[0] and str(r[0]).strip() != 'Nom':
        t = str(r[0])
    return t.strip() if t else None


def blocks(ws):
    """Découpe une feuille en blocs : chaque ligne de dates ouvre un bloc, titré par la ligne au-dessus."""
    rows = list(ws.iter_rows(values_only=True))
    date_rows = [i for i, r in enumerate(rows, 1) if not is_player(r) and any(as_date(c) for c in r[2:])]
    if not date_rows:  # pas de date dans le fichier (Shirado-Sorensen)
        return [(1, len(rows), ws.title)]
    starts = []
    for dr in date_rows:
        # Titre : 1 ou 2 lignes au-dessus (bloc « EUR » : titre fusionné sur 2 lignes).
        st = next((j for j in (dr - 1, dr - 2) if j >= 1 and row_title(rows[j - 1])), dr)
        if starts and st <= starts[-1]:
            continue
        starts.append(st)
    out = []
    for n, st in enumerate(starts):
        end = starts[n + 1] - 1 if n + 1 < len(starts) else len(rows)
        out.append((st, end, row_title(rows[st - 1]) or ws.title))
    return out


def date_map(ws, header_rows):
    """Date de chaque colonne : cellule d'en-tête datée, ou cellule fusionnée qui la couvre."""
    dates = {}
    for hr in header_rows:
        for col in range(3, ws.max_column + 1):
            d = as_date(ws.cell(hr, col).value)
            if d:
                dates[col] = d
        for m in ws.merged_cells.ranges:
            if m.min_row <= hr <= m.max_row:
                d = as_date(ws.cell(m.min_row, m.min_col).value)
                if d:
                    for col in range(m.min_col, m.max_col + 1):
                        dates[col] = d
    return dates


def labels(ws, header_rows):
    """Sous-titres de chaque colonne, de haut en bas (lignes d'en-tête sous le titre du bloc)."""
    lab = {}
    for hr in header_rows:
        for col in range(3, ws.max_column + 1):
            v = ws.cell(hr, col).value
            if isinstance(v, str) and v.strip() and not as_date(v):
                lab.setdefault(col, []).append(v.strip())
    return lab


def read_file(path, shirado_date, report):
    wb = openpyxl.load_workbook(path, data_only=True)
    out = []
    # Identité (date de naissance) et infos de fiche.
    info = {}
    ws = wb['Info_joueurs']
    for _, r in player_rows(ws):
        k = key(r[0], r[1])
        born = r[3].date() if isinstance(r[3], dt.datetime) else None
        info.setdefault(k, {'nom': str(r[0]).strip(), 'prenom': str(r[1]).strip(), 'naissance': born,
                            'poste': r[4], 'main': r[5], 'categorie': r[6], 'internat': r[7], 'lacunes': r[9]})
        if born and not info[k]['naissance']:
            info[k]['naissance'] = born
    for ws in wb.worksheets[1:]:
        if fold(ws.title) == 'rsa':
            continue  # colonnes vides (captures d'écran)
        for st, end, title in blocks(ws):
            # En-têtes : du titre jusqu'à la 1re ligne de joueur.
            players = [(i, r) for i, r in player_rows(ws) if st <= i <= end]
            if not players:
                continue
            header_rows = list(range(st, players[0][0]))
            dates = date_map(ws, header_rows)
            labs = labels(ws, header_rows[1:])  # sous le titre du bloc
            special_shoulder = fold(ws.title) == 'epaule_re-ri' and any(fold(t) in ('ri', 're') for v in labs.values() for t in v)
            for i, r in players:
                k = key(r[0], r[1])
                if k not in info:
                    report['inconnus'].add(f'{ws.title}')
                    continue
                cols = {}
                for col in range(3, len(r) + 1):
                    v = r[col - 1]
                    if v is None:
                        continue
                    date = dates.get(col) or MISSING_DATES.get((ws.title, get_column_letter(col)))
                    if fold(ws.title).startswith('shirado'):
                        date = date or shirado_date
                    if not date:
                        continue
                    texts = labs.get(col, [])
                    lab = ' '.join(texts)
                    if special_shoulder:
                        # 2026 : ligne « RI / RE » (fusionnée) + ligne « D / G ».
                        top = None
                        for m in ws.merged_cells.ranges:
                            if m.min_row in header_rows and m.min_col <= col <= m.max_col and fold(ws.cell(m.min_row, m.min_col).value or '') in ('ri', 're'):
                                top = fold(ws.cell(m.min_row, m.min_col).value)
                        side = fold(texts[-1])[:1] if texts else ''
                        crit = f'epaule_{top}_{side}' if top and side in ('d', 'g') else None
                    else:
                        crit = criterion_for(ws.title, title, lab)
                    if crit:
                        cols[col] = (crit, date, v)
                    elif is_note(ws.title, texts[-1] if texts else '') and (col - 1) in cols:
                        crit0, date0, v0 = cols[col - 1]
                        cols[col - 1] = (crit0, date0, v0, str(v).strip())
                for col, t in sorted(cols.items()):
                    crit, date, v = t[:3]
                    pv = parse_value(v)
                    if pv is None:
                        continue
                    value, note = pv
                    extra = t[3] if len(t) > 3 else None
                    note = ' · '.join(x for x in (note, extra) if x) or None
                    out.append((k, crit, date, value, note))
    return info, out


def sql_str(v):
    return 'null' if v is None else "'" + str(v).replace("'", "''") + "'"


POSTES = [('ald', 'AD'), ('arrd', 'ARD'), ('ard', 'ARD'), ('alg', 'AG'), ('arg', 'ARG'), ('dc', 'DC'), ('piv', 'PIV'), ('p', 'PIV'), ('g', 'GB')]


def one_position(txt):
    f = re.sub(r'[^a-z]', '', fold(txt))
    for pre, pos in POSTES:
        if f == pre or (len(pre) > 1 and f.startswith(pre)):
            return pos
    return None


def positions(v):
    """« ArG / DC / P » → ['ARG', 'DC', 'PIV'] (le premier est le poste principal)."""
    out = []
    for part in re.split(r'/', str(v or '')):
        pos = one_position(part)
        if pos and pos not in out:
            out.append(pos)
    return out


def first_position(v):
    ps = positions(v)
    return ps[0] if ps else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('--shirado-date', required=True, help='date des tests Shirado-Sorensen (absente du fichier)')
    a = ap.parse_args()
    shirado = dt.date.fromisoformat(a.shirado_date)
    report = {'inconnus': set()}
    infos, rows = {}, {}
    differ = 0
    for path in a.files:  # le fichier le plus récent en dernier : il l'emporte
        info, data = read_file(path, shirado, report)
        for k, v in info.items():
            cur = infos.setdefault(k, {})
            cur.update({kk: vv for kk, vv in v.items() if vv not in (None, '')})
        for k, crit, date, value, note in data:
            kk = (k, crit, date)
            if kk in rows and rows[kk][0] != value:
                differ += 1
            rows[kk] = (value, note)
    print(f'-- {len(infos)} joueurs, {len(rows)} mesures ; {differ} valeur(s) différente(s) entre fichiers (la plus récente gardée).', file=sys.stderr)

    w = sys.stdout.write
    w(open(__file__.replace('import_tests_physiques.py', 'import_tests_physiques.sql.head'), encoding='utf-8').read())
    w('\ninsert into _xl_joueurs (k, nom, prenom, naissance, poste, secondaires, lateralite, categorie, internat, lacunes) values\n')
    vals = []
    for k, v in sorted(infos.items()):
        lat = {'d': 'droitier', 'g': 'gaucher'}.get(fold(v.get('main') or '')[:1])
        internat = {'oui': 'true', 'non': 'false'}.get(fold(v.get('internat') or '').strip(), 'null')
        vals.append(f"({sql_str(k)}, {sql_str(v.get('nom'))}, {sql_str(v.get('prenom'))}, {sql_str(v.get('naissance'))}, "
                    f"{sql_str(first_position(v.get('poste')))}, {sql_str(json.dumps(positions(v.get('poste'))[1:]) if len(positions(v.get('poste'))) > 1 else None)}::jsonb, {sql_str(lat)}, {sql_str((str(v.get('categorie')).strip() if v.get('categorie') else None))}, "
                    f"{internat}, {sql_str((str(v.get('lacunes')).strip() if v.get('lacunes') else None))})")
    w(',\n'.join(vals) + ';\n')
    w('\ninsert into _xl_mesures (id, k, critere, date, valeur, note) values\n')
    vals = []
    for (k, crit, date), (value, note) in sorted(rows.items(), key=lambda x: (x[0][0], x[0][1], x[0][2])):
        mid = 'xl-' + hashlib.md5(f'{k}|{crit}|{date}'.encode()).hexdigest()[:20]
        vals.append(f"({sql_str(mid)}, {sql_str(k)}, {sql_str(crit)}, {sql_str(date)}, {sql_str(json.dumps(value, ensure_ascii=False))}::jsonb, {sql_str(note)})")
    w(',\n'.join(vals) + ';\n')
    w(open(__file__.replace('import_tests_physiques.py', 'import_tests_physiques.sql.tail'), encoding='utf-8').read())


if __name__ == '__main__':
    main()
