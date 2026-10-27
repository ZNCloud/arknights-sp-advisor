// advisor-dev/redact-demo.mjs 鈥?de-identify a .spdemo before it goes into the repo.
//
//   node advisor-dev/redact-demo.mjs <in .json|.spdemo> <out .spdemo|.json>
//
// Same boundary as advisor/redact.mjs (tools/redact-matches.mjs): every nickname 鈫?`搴т綅<seat>`, every account id
// (`p_鈥) 鈫?`seat<seat>`, including ids embedded in other strings (a battleId ends with `n:p_<id>`). Fail-loud: an id
// that no result row puts on a seat throws, and a survivor is an error 鈥?a half-redacted demo is never written.
import fs from 'node:fs';
import zlib from 'node:zlib';

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) throw new Error('usage: redact-demo.mjs <in> <out>');

const readAny = (f) => {
  const buf = fs.readFileSync(f);
  const text = f.endsWith('.spdemo') || (buf[0] === 0x1f && buf[1] === 0x8b) ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  return JSON.parse(text);
};

const demo = readAny(inFile);
const PLAYER_ID = /p_[0-9a-f]{6,}/g;

// seat table: result.players is the authority; m.public players carry the same ids
const idToSeat = new Map();
const nameToSeat = new Map();
const put = (pid, name, seat) => {
  if (pid != null && seat != null) idToSeat.set(String(pid), seat);
  if (name != null && seat != null) nameToSeat.set(String(name), seat);
};
for (const p of (demo.result && demo.result.players) || []) put(p.playerId, p.name, p.seat);
for (const f of demo.frames || []) {
  if (f.type === 'm.public' && f.data && Array.isArray(f.data.players)) for (const p of f.data.players) put(p.playerId, p.name, p.seat);
}

const ids = [...idToSeat.keys()];
const names = [...nameToSeat.keys()];
if (!ids.length) throw new Error('no player ids found in result.players 鈥?refusing to write');

let replacedIds = 0;
let replacedNames = 0;
const walk = (v) => {
  if (typeof v === 'string') {
    let s = v;
    for (const [pid, seat] of idToSeat) {
      if (s.includes(pid)) { s = s.split(pid).join(`seat${seat}`); replacedIds++; }
    }
    for (const name of names) {
      if (name && s.includes(name)) { s = s.split(name).join(`搴т綅${nameToSeat.get(name)}`); replacedNames++; }
    }
    return s;
  }
  if (Array.isArray(v)) return v.map(walk);
  if (v && typeof v === 'object') {
    const o = {};
    // keys too: a private view may be keyed by player id
    for (const [k, x] of Object.entries(v)) o[walk(k)] = walk(x);
    return o;
  }
  return v;
};
const out = walk(demo);

// fail-loud: nothing of the originals may survive anywhere
const flat = JSON.stringify(out);
for (const pid of ids) if (flat.includes(pid)) throw new Error('an account id survived the redaction');
for (const name of names) if (name && flat.includes(name)) throw new Error('a nickname survived the redaction');
if (PLAYER_ID.test(flat)) throw new Error('a p_鈥?id of unknown seat survived the redaction');

const json = JSON.stringify(out);
if (outFile.endsWith('.spdemo')) fs.writeFileSync(outFile, zlib.gzipSync(Buffer.from(json), { level: 9 }));
else fs.writeFileSync(outFile, json);
console.log(`${ids.length} ids + ${names.length} names 鈫?seats; ${replacedIds} id / ${replacedNames} name occurrences; ${(json.length / 1024).toFixed(0)} KiB JSON 鈫?${outFile}`);

