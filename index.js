// Transports : ton appli d'origine (HTML et code inchangés), livrée en plugin.
// Ses données sont dans le dossier du plugin, que NeoBase sauvegarde (synchro cloud et sauvegardes) ; à la première ouverture elle reprend ce que tu avais dans NeoBase.
// Elle demande l'accès complet pour utiliser les outils d'interface de NeoBase. NeoBase ne l'ouvre que si elle est signée.
const HTML = "<div class=\"appWrap\">\n      <div class=\"agHead\"><span class=\"label\">Transports · Tadao</span></div>\n      <div id=\"tpFavs\" class=\"setBg\"></div>\n      <div class=\"sysCard px\"><input class=\"f\" id=\"tpSearch\" placeholder=\"Chercher un arrêt (ex : Gare de Lens, Bollaert…)\" spellcheck=\"false\"><div id=\"tpResults\"></div></div>\n      <div class=\"sysCard px\" id=\"tpBoard\"><div class=\"hint\">Choisis un arrêt pour voir les prochains passages.</div></div>\n    </div>";
export default async function (ctx) {
  const view = ctx.view;
  if (!ctx.host) { view.textContent = "Ce plugin doit être approuvé par NeoBase pour s'ouvrir."; return; }
  const { el, toast, sfx, ask, newTab, pixIcon, PIX, WX } = ctx.host;
  const folder = ctx.folder, legacy = ctx.legacy || {};
  view.innerHTML = HTML;
  const $ = id => id === "busApp" ? view : view.querySelector('#' + id);  // les identifiants de ta vue, sans toucher à ceux du reste de NeoBase
  const doc = async n => { try { return await folder.read(n); } catch { return null; } };
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  let prefs = await doc('prefs');
  if (prefs == null) {  // première ouverture : tu retrouves tes réglages d'avant
    prefs = {}; const old = legacy.settings ? await legacy.settings().catch(() => ({})) : {};
    for (const k of ["tadaoStops"]) if (old[k] !== undefined && old[k] !== '' && !(Array.isArray(old[k]) && !old[k].length)) prefs[k] = old[k];
    if (Object.keys(prefs).length) await folder.write('prefs', prefs);
  }
  const neo = Object.assign({}, ctx.neo || {}, { win: a => ctx.host.win?.(a), getSettings: async () => prefs, setSettings: async s => { Object.assign(prefs, s); await folder.write('prefs', prefs); return prefs; } });
  // ---- ton code d'origine ----
  /* ---------- Transports app: Tadao (Lens-Liévin-Hénin-Carvin), next departures from the timetables + where the buses are now ---------- */
  let tpStop = null, tpTimer = null, tpTrip = null;
  const tpFavs = () => prefs.tadaoStops || [];
  function tpChips() {
    $('tpFavs').replaceChildren(...(tpFavs().length ? tpFavs().map(s => { const b = el('button', 'tab px' + (tpStop?.key === s.key ? ' on' : ''), s.name); b.title = s.town; b.onclick = () => tpShow(s); return b; }) : [el('span', 'hint', 'Cherche un arrêt puis clique sur ☆ pour le garder ici.')]));
  }
  async function tpOpen() { tpChips(); if (!tpStop && tpFavs()[0]) tpShow(tpFavs()[0]); else if (tpStop) tpShow(tpStop); }
  $('tpSearch').oninput = async e => {
    const q = e.target.value.trim(); if (q.length < 2) return $('tpResults').replaceChildren();
    $('tpResults').replaceChildren(el('div', 'hint', 'Recherche… (la première fois, NeoBase télécharge les horaires Tadao, environ 20 Mo)'));
    try {
      const r = await neo.tadaoSearch(q);
      if (e.target.value.trim() !== q) return;
      $('tpResults').replaceChildren(...(r.length ? r.map(s => { const b = el('button', 'tpResult'); b.append(el('b', '', s.name), el('span', '', s.town + (s.quays > 1 ? ' · ' + s.quays + ' quais' : ''))); b.onclick = () => { $('tpSearch').value = ''; $('tpResults').replaceChildren(); tpShow(s); }; return b; }) : [el('div', 'hint', 'Aucun arrêt trouvé.')]));
    } catch (err) { $('tpResults').replaceChildren(el('div', 'hint', 'Horaires indisponibles : ' + err.message.replace(/^.*Error: /, ''))); }
  };
  async function tpShow(s) {
    clearTimeout(tpTimer); tpStop = s; tpChips();
    if (!view.classList.contains('on')) return;
    tpTimer = setTimeout(() => tpShow(s), 30000);
    const fav = tpFavs().some(f => f.key === s.key), star = el('button', 'nbaStar' + (fav ? ' on' : ''), fav ? '★' : '☆');
    star.title = fav ? 'Retirer de mes arrêts' : 'Garder cet arrêt'; star.onclick = async () => { prefs = await neo.setSettings({tadaoStops: fav ? tpFavs().filter(f => f.key !== s.key) : [...tpFavs(), {key: s.key, name: s.name, town: s.town}]}); tpShow(s); };
    const head = el('div', 'tpHead'); head.append(el('span', 'tpName', s.name), el('span', 'hint', s.town), star);
    $('tpBoard').replaceChildren(head, el('div', 'hint', 'Chargement…'));
    try {
      const r = await neo.tadaoNext(s.key);
      const rows = r.departures.map(d => {
        const row = el('div', 'tpRow'), line = el('span', 'tpLine', d.route?.name || '?'), mins = Math.round((d.time + (d.delay || 0) * 60 - r.now) / 60);
        line.style.background = d.route?.color; line.style.color = d.route?.text;
        const when = el('span', 'tpWhen' + (mins <= 1 ? ' now' : ''), mins <= 0 ? 'à quai' : mins < 60 ? mins + ' min' : String(Math.floor(d.time / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor(d.time % 3600 / 60)).padStart(2, '0'));
        const info = el('div', 'tn'); info.append(d.headsign, el('small', '', (d.live ? '● en circulation' + (d.away != null ? ' · à ' + d.away + ' arrêt' + (d.away > 1 ? 's' : '') + (d.where ? ' (' + d.where + ')' : '') : '') + (d.delay > 1 ? ' · retard estimé ' + d.delay + ' min' : d.delay != null && d.delay < -1 ? ' · en avance' : '') : 'horaire prévu ' + String(Math.floor(d.time / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor(d.time % 3600 / 60)).padStart(2, '0'))));
        if (d.live) row.classList.add('live');
        row.append(line, info, when);
        const stops = el('div', 'tpStops');  // a click on a bus: all its stops, with their times
        const fill = async () => { const l = await neo.tadaoTrip(d.trip); stops.replaceChildren(...l.map(p => { const at = p.time - (d.shift || 0) + (d.delay || 0) * 60, e = el('div', 'tpStop' + (at < r.now ? ' past' : p.name === s.name ? ' here' : '')); e.append(el('span', '', p.name), el('b', '', String(Math.floor(at / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor(at % 3600 / 60)).padStart(2, '0'))); return e; })); };
        row.onclick = () => { const on = tpTrip === d.trip; tpTrip = on ? null : d.trip; view.querySelectorAll('.tpStops').forEach(x => x.replaceChildren()); if (!on) fill().catch(e => toast(e.message, true)); };
        if (tpTrip === d.trip) fill().catch(() => {});
        return [row, stops];
      }).flat();
      $('tpBoard').replaceChildren(head, ...(rows.length ? rows : [el('div', 'hint', 'Plus de passage dans les 3 prochaines heures.')]),
        el('div', 'hint', 'Horaires Tadao (transport.data.gouv.fr) · ' + r.buses + ' bus suivis en direct' + (r.liveAt ? ', position du ' + new Date(r.liveAt * 1000).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'}) : '') + ' · le retard est estimé d\'après la position du bus.'));
    } catch (err) { $('tpBoard').replaceChildren(head, el('div', 'hint', 'Horaires indisponibles : ' + err.message.replace(/^.*Error: /, ''))); }
  }
  // ---- fin ----
  ctx.onOpen(() => { tpOpen(); });
  ctx.onClose(() => { clearTimeout(tpTimer); });
}
