// Vyhľadávanie v úryvkoch VPP: BM25 + jednoduché skracovanie slov + slovník synoným.
// Beží v prehliadači (a rovnako v Node na testovanie). Slovník SYN si môžeš dopĺňať.

const STOP = new Set(("pre aby ako ale alebo ked ktory ktora ktore ktorych tiez som sme sa je si na do po od pri bez ani uz tam len " +
  "tomu tento tato toto tieto moze mozu mat byt ich jeho jej nie aky aka ake aku aj kde kedy preco co mi ma maju ze to tu aky " +
  "poistene poistenie poisteny poistena poistna poistne poistnej").split(" "));

// Poisťovne – ak ich otázka spomenie ("v kooperatíve"), hľadá sa len v nich.
export const INSURERS = ["Generali", "Union", "Allianz", "Kooperativa"];
const ALIAS = { generali: "Generali", domino: "Generali", union: "Union", unidom: "Union", allianz: "Allianz", kooperativ: "Kooperativa" };

// Synonymá a príbuzné pojmy (kľúč = základ slova bez diakritiky). Hodnota = pridané hľadané výrazy.
const SYN = {
  dron: ["bezpilotne lietadlo", "lietajuce zariadenie", "lietadlo", "padlo lietadla", "dronov", "drony"],
  kradez: ["odcudzenie", "vlamanie", "lupez"],
  odcud: ["kradez", "vlamanie", "lupez"],
  vlama: ["kradez", "odcudzenie", "zabezpecenie"],
  povod: ["zaplava", "povoden", "cakacia doba"],
  zaplav: ["povoden", "cakacia doba"],
  voda: ["vodovodne zariadenie", "unik vody", "prasknute potrubie"],
  potru: ["vodovodne zariadenie", "unik vody", "voda z vodovodneho zariadenia"],
  zvier: ["domace zviera", "poskodenie zvieratom", "pes macka"],
  pes: ["domace zviera", "zodpovednost za skodu", "zviera"],
  macka: ["domace zviera", "zviera"],
  bicyk: ["ostatne zvlastne vozidlo", "vozidlo", "kolobezka", "zodpovednost za skodu"],
  kolob: ["ostatne zvlastne vozidlo", "vozidlo", "elektrokolobezka"],
  podni: ["zarobkova cinnost", "podnikatelska cinnost", "podnikanie"],
  airbn: ["prenajom", "ubytovanie", "najomca", "kratkodoby prenajom"],
  prena: ["najomca", "ubytovanie", "airbnb", "prenajom"],
  solar: ["fotovolticke zariadenie", "solarne panely", "strecha"],
  fotov: ["solarne panely", "fotovolticke zariadenie"],
  cennost: ["sperky", "umelecke diela", "cenne papiere", "limit plnenia"],
  sperk: ["cennosti", "drahe kovy", "limit plnenia"],
  zemet: ["zemetrasenie", "stupen EMS", "zivel"],
  cakac: ["cakacia doba", "po uplynuti", "dni po uzavreti"],
  vypad: ["vypadok elektrickej energie", "skazenie potravin", "chladnicka"],
  elekt: ["prepatie", "skrat", "elektrospotrebice"],
  sprej: ["vandalizmus", "sprejerstvo"],
  stahov: ["sahovanie", "nove miesto poistenia", "60 dni"],
};

export const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function stem(t) { return t.startsWith("dron") ? "dron" : t.length > 5 ? t.slice(0, 5) : t; }
function tokens(s) {
  return norm(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t)).map(stem);
}

export function buildIndex(chunks) {
  const df = new Map(), docs = [];
  let total = 0;
  for (const c of chunks) {
    const tf = new Map();
    for (const t of tokens((c.h || "") + " " + c.t)) tf.set(t, (tf.get(t) || 0) + 1);
    const len = [...tf.values()].reduce((a, b) => a + b, 0);
    total += len;
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    docs.push({ c, tf, len });
  }
  return { docs, df, N: docs.length, avg: total / docs.length };
}

export function parseQuery(q) {
  const n = norm(q);
  const found = new Set();
  for (const [k, v] of Object.entries(ALIAS)) if (n.includes(k)) found.add(v);
  const base = tokens(q).filter((t) => !Object.keys(ALIAS).some((a) => a.startsWith(t) || t.startsWith(a.slice(0, 5))));
  const weights = new Map();
  for (const t of base) weights.set(t, 1);
  for (const t of base) for (const [k, list] of Object.entries(SYN))
    if (t === k || t.startsWith(k)) for (const phrase of list) for (const s of tokens(phrase)) if (!weights.has(s)) weights.set(s, 0.5);
  return { insurers: [...found], weights };
}

// Vráti najlepšie úryvky pre každú poisťovňu zvlášť (aby sa dali porovnať všetky).
// Generali má 4 dokumenty, preto dostane viac miesta.
const CAP = (name) => (name === "Generali" ? 7 : 5);
export function search(index, query, { insurers = null } = {}) {
  const { insurers: mentioned, weights } = parseQuery(query);
  const allowed = new Set(insurers && insurers.length ? insurers : mentioned.length ? mentioned : INSURERS);
  const k1 = 1.4, b = 0.75, scored = [];
  for (const d of index.docs) {
    if (!allowed.has(d.c.insurer)) continue;
    let s = 0;
    for (const [t, w] of weights) {
      const f = d.tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (index.N - (index.df.get(t) || 0) + 0.5) / ((index.df.get(t) || 0) + 0.5));
      s += w * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / index.avg)));
    }
    if (s > 0) scored.push({ chunk: d.c, score: s });
  }
  scored.sort((a, b2) => b2.score - a.score);
  const per = new Map(), out = [];
  for (const r of scored) {
    const n = per.get(r.chunk.insurer) || 0;
    if (n < CAP(r.chunk.insurer)) { per.set(r.chunk.insurer, n + 1); out.push(r); }
  }
  return { results: out, searched: [...allowed], mentioned };
}
