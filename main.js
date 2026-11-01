// Transports (Tadao) : le côté système du plugin, chargé par NeoBase une fois le plugin signé et l'accès complet accordé.
const { app } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// ---------- Transports: Tadao timetables (GTFS, refreshed weekly) + bus positions (GTFS-RT) from transport.data.gouv.fr ----------
const TADAO_GTFS = 'https://www.data.gouv.fr/api/1/datasets/r/47a5e290-7883-4a40-bdcf-b693f64087b0', TADAO_RT = 'https://www.data.gouv.fr/api/1/datasets/r/c4563dcc-f547-489a-b63a-efb4dbb37262';
const TADAO_DIR = () => path.join(app.getPath('userData'), 'tadao'), GTFS_FILES = ['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'calendar.txt', 'calendar_dates.txt'];
let gtfs = null, gtfsLoading = null, rt = { at: 0, data: null };
function csv(file, onRow) {  // header line + rows, quotes handled
  const text = fs.readFileSync(file, 'utf8').replace(/^\ufeff/, ''), lines = text.split(/\r?\n/), head = lines[0].split(',');
  const cell = l => { if (!l.includes('"')) return l.split(','); const o = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (c === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (c === ',' && !q) { o.push(cur); cur = ''; } else cur += c; } o.push(cur); return o; };
  for (let i = 1; i < lines.length; i++) if (lines[i]) { const v = cell(lines[i]), r = {}; head.forEach((h, k) => r[h] = v[k]); onRow(r); }
}
const secs = t => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + (s || 0); };
const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
async function loadGtfs() {
  const dir = TADAO_DIR(), stamp = path.join(dir, 'stops.txt');
  let fresh = false; try { fresh = Date.now() - fs.statSync(stamp).mtimeMs < 7 * 864e5; } catch {}
  if (!fresh) {
    fs.mkdirSync(dir, { recursive: true });
    const r = await fetch(TADAO_GTFS); if (!r.ok) throw new Error('horaires Tadao indisponibles (' + r.status + ')');
    const zip = path.join(dir, 'gtfs.zip'); fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
    await new Promise((ok, ko) => execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', dir, ...GTFS_FILES], { windowsHide: true }, e => e ? ko(new Error('archive Tadao illisible')) : ok()));
    fs.rmSync(zip, { force: true });
    for (const f of GTFS_FILES) try { fs.utimesSync(path.join(dir, f), new Date(), new Date()); } catch {}
  }
  const g = { stops: new Map(), groups: new Map(), routes: new Map(), trips: new Map(), byStop: new Map(), byTrip: new Map(), cal: new Map(), dates: new Map() };
  csv(path.join(dir, 'stops.txt'), r => {
    if (r.location_type === '1') return;
    // the quays of a hub ("Béhal-Jean Zay - Quai 4") are one stop for the traveller
    const name = r.stop_name.replace(/\s*-\s*Quai\s*\d+\s*$/i, ''), town = (/\d{5}\s+(.+)$/.exec(r.stop_desc || '') || [])[1] || '', key = norm(name) + '|' + norm(town);
    g.stops.set(r.stop_id, { name, quay: r.stop_name, town, key, lat: +r.stop_lat, lon: +r.stop_lon });
    if (!g.groups.has(key)) g.groups.set(key, { key, name, town, ids: [], lat: +r.stop_lat, lon: +r.stop_lon });
    g.groups.get(key).ids.push(r.stop_id);
  });
  csv(path.join(dir, 'routes.txt'), r => g.routes.set(r.route_id, { name: r.route_short_name || r.route_long_name, long: r.route_long_name, color: '#' + (r.route_color || '8a5cf0'), text: '#' + (r.route_text_color || 'ffffff') }));
  csv(path.join(dir, 'trips.txt'), r => g.trips.set(r.trip_id, { route: r.route_id, service: r.service_id, headsign: r.trip_headsign }));
  csv(path.join(dir, 'stop_times.txt'), r => {
    const t = secs(r.departure_time || r.arrival_time), seq = +r.stop_sequence;
    if (!g.byStop.has(r.stop_id)) g.byStop.set(r.stop_id, []); g.byStop.get(r.stop_id).push([r.trip_id, t, seq]);
    if (!g.byTrip.has(r.trip_id)) g.byTrip.set(r.trip_id, []); g.byTrip.get(r.trip_id).push([seq, r.stop_id, t]);
  });
  for (const l of g.byTrip.values()) l.sort((a, b) => a[0] - b[0]);
  csv(path.join(dir, 'calendar.txt'), r => g.cal.set(r.service_id, r));
  csv(path.join(dir, 'calendar_dates.txt'), r => { if (!g.dates.has(r.date)) g.dates.set(r.date, new Map()); g.dates.get(r.date).set(r.service_id, r.exception_type); });
  return g;
}
const getGtfs = () => gtfs ? Promise.resolve(gtfs) : (gtfsLoading ??= loadGtfs().then(g => (gtfs = g), e => { gtfsLoading = null; throw e; }));
const ymdC = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
function running(g, service, day) {  // calendar + exceptions (1 = added, 2 = removed that day)
  const ex = g.dates.get(ymdC(day))?.get(service);
  if (ex === '1') return true; if (ex === '2') return false;
  const c = g.cal.get(service); if (!c) return false;
  const d = ymdC(day), wd = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][day.getDay()];
  return c[wd] === '1' && d >= c.start_date && d <= c.end_date;
}
async function realtime() {
  if (Date.now() - rt.at < 20000) return rt.data;
  try { const r = await fetch(TADAO_RT); rt = { at: Date.now(), data: require('./gtfs-rt').decode(Buffer.from(await r.arrayBuffer())) }; } catch { rt = { at: Date.now(), data: null }; }
  return rt.data;
}
async function departures(key, max = 30, at = Date.now()) {  // at: another moment (the self-test checks a Monday morning)
  const g = await getGtfs(), grp = g.groups.get(key); if (!grp) throw new Error('arrêt inconnu');
  const now = new Date(at), nowS = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds(), out = [];
  const live = await realtime(), fresh = new Map((live?.vehicles || []).filter(v => v.tripId && live.timestamp - v.timestamp < 600).map(v => [v.tripId, v]));
  const today = new Date(now), yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  for (const id of grp.ids) for (const [tripId, t, seq] of g.byStop.get(id) || []) {
    const trip = g.trips.get(tripId); if (!trip) continue;
    // a time after 24:00 belongs to the previous day's service
    for (const [day, shift] of [[today, 0], [yesterday, 86400]]) {
      const at = t - shift; if (at < nowS - 60 || at > nowS + 3 * 3600 || !running(g, trip.service, day)) continue;
      const stops = g.byTrip.get(tripId), last = stops[stops.length - 1];
      if (last[0] === seq || g.stops.get(last[1])?.key === key) continue;  // ends here (maybe at another quay of this hub): nobody boards it
      const v = fresh.get(tripId); let delay = null, away = null, where = '';
      if (v) {  // estimated delay: where the bus is now compared with its timetable there
        const cur = stops.find(s => s[1] === v.stopId);
        if (cur) { delay = Math.round(Math.max(-120, nowS - (cur[2] - shift)) / 60); away = stops.filter(s => s[0] > cur[0] && s[0] <= seq).length; where = g.stops.get(v.stopId)?.name || ''; if (cur[0] > seq) continue; }  // already gone past
      }
      out.push({ trip: tripId, shift, route: g.routes.get(trip.route), headsign: trip.headsign, time: at, delay, away, where, live: !!v, quay: id });
    }
  }
  out.sort((a, b) => (a.time + (a.delay || 0) * 60) - (b.time + (b.delay || 0) * 60));
  return { stop: { name: grp.name, town: grp.town }, now: nowS, departures: out.slice(0, max), liveAt: live?.timestamp || 0, buses: fresh.size };
}

// le classement des arrêts pour une saisie : score bas = meilleur résultat, null = ne correspond pas
const T_STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'a', 'au', 'aux', 'et', 'arret', 'station']), T_ALIAS = { st: 'saint', ste: 'sainte' };
const tWords = s => norm(s).split(' ').filter(Boolean).map(w => T_ALIAS[w] || w);
function lev1(a, b) {  // vrai si a et b diffèrent d'une seule lettre (ajoutée, retirée, changée ou deux lettres échangées)
  if (a === b) return true; if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}
function tadaoRank(stops, q) {
  const n = norm(q || ''); if (!n) return [];
  const scored = [];
  let re = null; if (/[.*+?^$|\[\](){}]/.test(q || '')) { try { re = new RegExp(String(q).normalize('NFD').replace(/[\u0300-\u036f]/g, ''), 'i'); } catch {} }
  const qw = tWords(q).filter(w => !T_STOP.has(w)); const tokens = qw.length ? qw : tWords(q);
  for (const s of stops) {
    const name = norm(s.name), nameW = tWords(s.name), townW = tWords(s.town), all = nameW.concat(townW);
    let score = null;
    if (re && re.test(norm(s.name + ' ' + s.town) + ' ' + s.name.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) score = 0.5;
    else if (name === n) score = 0; else if (name.startsWith(n)) score = 1;
    else {
      let total = 0;
      for (const t of tokens) {
        let best = Infinity;
        all.forEach((w, i) => { const pen = i < nameW.length ? 0 : .5;  /* un mot qui n'est que dans la ville compte un peu moins */ let c = Infinity; if (w === t) c = 0; else if (w.startsWith(t)) c = 1; else if (w.includes(t)) c = 2; else if (t.length >= 4 && (lev1(w.slice(0, t.length + 1), t) || lev1(w, t))) c = 3; best = Math.min(best, c + pen); });
        if (best === Infinity) { total = null; break; } total += best;
      }
      if (total !== null) score = 2 + total / tokens.length + nameW.length * .01;  // à égalité, le nom le plus court
    }
    if (score !== null) scored.push([score, s]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name, 'fr')).map(x => x[1]);
}

module.exports = ({ ipcMain }) => {
  ipcMain.handle('tadao:search', async (_, q) => {
    const g = await getGtfs();
    return tadaoRank([...g.groups.values()], q).slice(0, 20).map(s => ({ key: s.key, name: s.name, town: s.town, quays: s.ids.length }));
  });
  ipcMain.handle('tadao:trip', async (_, id) => { const g = await getGtfs(); return (g.byTrip.get(id) || []).map(([, stop, time]) => ({ name: g.stops.get(stop)?.name || '', time })); });
  ipcMain.handle('tadao:next', (_, key, at) => departures(key, 30, typeof at === 'number' ? at : Date.now()));
};
module.exports.tadaoRank = tadaoRank;
