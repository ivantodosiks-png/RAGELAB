import fs from 'fs';

const buf = fs.readFileSync(process.argv[2] || 'assets/map cs/_2000/2000.bsp');
const entOff = buf.readInt32LE(4);
const entLen = buf.readInt32LE(8);
const text = buf.slice(entOff, entOff + entLen).toString('latin1');
const ents = [];
let cur = null;
for (const line of text.split(/\r?\n/)) {
  const t = line.trim();
  if (t === '{') {
    cur = {};
    continue;
  }
  if (t === '}') {
    if (cur) ents.push(cur);
    cur = null;
    continue;
  }
  const m = t.match(/^"([^"]+)"\s+"([^"]*)"$/);
  if (m && cur) cur[m[1]] = m[2];
}
const interesting = ents.filter((e) =>
  /info_player|info_terrorist|info_ct|weapon_|armoury|func_buy|hostage/i.test(e.classname || ''),
);
console.log('entity count', ents.length, 'interesting', interesting.length);
for (const e of interesting) {
  console.log(JSON.stringify({ classname: e.classname, origin: e.origin, angles: e.angles || e.angle }));
}
