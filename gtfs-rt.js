// Minimal GTFS-Realtime reader (protobuf wire format), enough for vehicle positions and trip updates (delays).
// Field numbers from the GTFS-RT specification: FeedMessage.entity = 2; FeedEntity.trip_update = 3, .vehicle = 4 ...
function fields(buf, start = 0, end = buf.length) {  // -> [[fieldNumber, wireType, value]]
  const out = [];
  let i = start;
  const varint = () => { let v = 0, m = 1, b; do { b = buf[i++]; v += (b & 0x7f) * m; m *= 128; } while (b & 0x80); return v; };
  while (i < end) {
    const key = varint(), f = Math.floor(key / 8), w = key & 7;
    if (w === 0) out.push([f, 0, varint()]);
    else if (w === 1) { out.push([f, 1, buf.readDoubleLE(i)]); i += 8; }
    else if (w === 2) { const n = varint(); out.push([f, 2, [i, i + n]]); i += n; }
    else if (w === 5) { out.push([f, 5, buf.readFloatLE(i)]); i += 4; }
    else throw new Error('protobuf: wire type ' + w);
  }
  return out;
}
const msg = (buf, [a, b]) => fields(buf, a, b);
const str = (buf, [a, b]) => buf.toString('utf8', a, b);
const get = (fs, n) => fs.find(x => x[0] === n)?.[2];
const signed = v => v > 0x7fffffff ? v - 0x100000000 : v;  // int32 delays are sent as two's complement varints

function trip(buf, r) { const t = msg(buf, r); return { tripId: get(t, 1) && str(buf, get(t, 1)), routeId: get(t, 5) && str(buf, get(t, 5)) }; }
function decode(buf) {
  const vehicles = [], updates = [];
  let timestamp = 0;
  for (const [f, , v] of fields(buf)) {
    if (f === 1) timestamp = get(msg(buf, v), 3) || 0;
    if (f !== 2) continue;
    const e = msg(buf, v);
    const vp = get(e, 4), tu = get(e, 3);
    if (vp) {
      const p = msg(buf, vp), pos = get(p, 2) && msg(buf, get(p, 2)), veh = get(p, 8) && msg(buf, get(p, 8));
      vehicles.push({ ...(get(p, 1) ? trip(buf, get(p, 1)) : {}), lat: pos && get(pos, 1), lon: pos && get(pos, 2), stopId: get(p, 7) && str(buf, get(p, 7)),
        status: get(p, 4) ?? 2, timestamp: get(p, 5) || 0, label: veh && (get(veh, 2) ? str(buf, get(veh, 2)) : get(veh, 1) && str(buf, get(veh, 1))) });
    }
    if (tu) {
      const u = msg(buf, tu), stops = u.filter(x => x[0] === 2).map(x => {
        const s = msg(buf, x[2]), ev = n => { const r = get(s, n); if (!r) return null; const m = msg(buf, r); return { delay: get(m, 1) != null ? signed(get(m, 1)) : null, time: get(m, 2) || null }; };
        return { seq: get(s, 1), stopId: get(s, 4) && str(buf, get(s, 4)), arrival: ev(2), departure: ev(3) };
      });
      updates.push({ ...(get(u, 1) ? trip(buf, get(u, 1)) : {}), delay: get(u, 5) != null ? signed(get(u, 5)) : null, stops });
    }
  }
  return { timestamp, vehicles, updates };
}
module.exports = { decode, fields };
