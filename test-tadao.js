// Recherche d'arrêts : node test-tadao.js (sans Electron : on ne teste que le classement)
const Module = require('module'), orig = Module._load; Module._load = function (r, ...a) { if (r === 'electron') return { app: {}, ipcMain: {}, dialog: {}, shell: {} }; return orig.call(this, r, ...a); };
const { tadaoRank } = require('./main.js');
const S = ['Gare de Lens|Lens', 'Gare|Liévin', 'Saint-Paul|Lens', 'Médiathèque|Lens', 'Bellevue|Loison-sous-Lens', 'Gare 2|Loison-sous-Lens', "Stade Léo Lagrange|Lens", 'Rue Léon Duhamel|Liévin', 'Hôtel de Ville|Hénin-Beaumont'].map(x => { const [name, town] = x.split('|'); return { name, town, key: name + town, ids: [1] }; });
const first = q => tadaoRank(S, q)[0]?.name, has = (q, n) => tadaoRank(S, q).some(s => s.name === n);
const checks = [
  ['gare lens', first('gare lens') === 'Gare de Lens'], ['lens gare (autre ordre)', first('lens gare') === 'Gare de Lens'], ['st paul', first('st paul') === 'Saint-Paul'],
  ['mediatheque (sans accent)', first('mediatheque') === 'Médiathèque'], ['belevue (faute)', first('belevue') === 'Bellevue'], ['mediatheuqe (lettres échangées)', has('mediatheuqe', 'Médiathèque')],
  ['regex ga.*lens', has('ga.*lens', 'Gare de Lens')], ['regex ^gare', has('^gare', 'Gare')], ['stade lagrange (mot manquant au milieu)', first('stade lagrange') === 'Stade Léo Lagrange'],
  ['hotel ville', first('hotel ville') === 'Hôtel de Ville'], ['duhamel', first('duhamel') === 'Rue Léon Duhamel'], ['rien ne correspond', tadaoRank(S, 'zzzzqq').length === 0], ['regex invalide ne plante pas', Array.isArray(tadaoRank(S, '[gare'))],
];
let bad = 0; for (const [n, ok] of checks) { console.log((ok ? 'ok     ' : 'ÉCHEC  ') + n); if (!ok) bad++; }
console.log(bad ? bad + ' échec(s)' : checks.length + ' vérifications ok'); process.exit(bad ? 1 : 0);
