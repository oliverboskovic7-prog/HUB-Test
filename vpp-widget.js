// VPP asistent – vkladateľný blok do hubu.
// Použitie v HTML:  <div data-vpp data-endpoint="https://<projekt>.supabase.co/functions/v1/vpp-ask" data-key="sb_publishable_..."></div>
//                   <script type="module" src="vpp/vpp-widget.js"></script>
// Farba sa preberá z CSS premennej --vpp-accent (alebo --accent z hubu); pozadie a text z okolia (funguje aj v tmavom režime).
import { buildIndex, search, INSURERS } from "./search.js";

const CSS = `
.vpp{--a:var(--vpp-accent,var(--accent,#d6246e));--bd:rgba(128,128,128,.35);--bg2:rgba(128,128,128,.08);color:inherit;font:inherit;line-height:1.5}
.vpp *{box-sizing:border-box}
.vpp .vpp-box{border:1px solid var(--bd);border-radius:12px;padding:14px;background:var(--bg2)}
.vpp textarea{width:100%;min-height:70px;resize:vertical;border:1px solid var(--bd);border-radius:8px;padding:10px;font:inherit;background:transparent;color:inherit}
.vpp .vpp-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
.vpp button{font:inherit;cursor:pointer;border-radius:8px;border:1px solid var(--bd);background:transparent;color:inherit;padding:7px 12px}
.vpp button.vpp-pri{background:var(--a);border-color:var(--a);color:#fff;font-weight:600}
.vpp button:disabled{opacity:.5;cursor:default}
.vpp .vpp-chip[aria-pressed=true]{border-color:var(--a);color:var(--a);font-weight:600}
.vpp .vpp-ex button{font-size:.85rem;opacity:.8}
.vpp .vpp-lbl{font-size:.85rem;opacity:.7}
.vpp .vpp-chips{display:contents}
.vpp .vpp-answer{margin-top:14px}
.vpp .vpp-answer h4{margin:.9em 0 .2em}
.vpp .vpp-answer ul{margin:.3em 0 .6em;padding-left:1.2em}
.vpp .vpp-cite{opacity:.65;font-size:.85em}
.vpp .vpp-note{background:rgba(255,190,0,.15);border-radius:8px;padding:8px 10px;font-size:.88rem;margin-top:10px}
.vpp .vpp-err{background:rgba(220,40,40,.12);border-radius:8px;padding:8px 10px;margin-top:10px}
.vpp h3{font-size:1.05rem;margin:22px 0 8px}
.vpp details.vpp-s{border:1px solid var(--bd);border-radius:10px;margin:8px 0}
.vpp details.vpp-s summary{cursor:pointer;padding:9px 12px;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.vpp .vpp-badge{font-size:.78rem;font-weight:700;padding:1px 8px;border-radius:99px;border:1px solid var(--a);color:var(--a)}
.vpp details.vpp-s pre{white-space:pre-wrap;word-wrap:break-word;margin:0;padding:0 12px 12px;font:inherit;font-size:.9rem;opacity:.8}
.vpp .vpp-foot{margin-top:20px;font-size:.8rem;opacity:.65}
.vpp .vpp-spin{display:inline-block;width:14px;height:14px;border:2px solid var(--bd);border-top-color:var(--a);border-radius:50%;animation:vppspin .8s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes vppspin{to{transform:rotate(360deg)}}
`;
const EXAMPLES = ["Je poistený dron v kooperatíve?", "Aká je čakacia doba pri povodni a záplave?", "Je kryté zemetrasenie?", "Kryje poistenie škodu spôsobenú psom?", "Aké zabezpečenie treba pre krádež vlámaním?"];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function md(src) {
  const out = []; let inList = false;
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\(([^()]*?str\.[^()]*?)\)/g, '<span class="vpp-cite">($1)</span>');
  for (const line of src.split("\n")) {
    const li = line.match(/^\s*[-*•]\s+(.*)$/), h = line.match(/^#{1,4}\s+(.*)$/);
    if (li) { if (!inList) { out.push("<ul>"); inList = true; } out.push("<li>" + inline(li[1]) + "</li>"); continue; }
    if (inList) { out.push("</ul>"); inList = false; }
    if (h) out.push("<h4>" + inline(h[1]) + "</h4>"); else if (line.trim()) out.push("<p>" + inline(line) + "</p>");
  }
  if (inList) out.push("</ul>");
  return out.join("");
}

let dataPromise = null;
function loadData() {
  dataPromise ||= fetch(new URL("chunks.json", import.meta.url)).then((r) => r.json()).then((chunks) => ({ chunks, index: buildIndex(chunks) }));
  return dataPromise;
}

export async function mountVpp(el) {
  if (el.dataset.vppMounted) return;
  el.dataset.vppMounted = "1";
  if (!document.getElementById("vpp-css")) { const st = document.createElement("style"); st.id = "vpp-css"; st.textContent = CSS; document.head.append(st); }
  const endpoint = el.dataset.endpoint, key = el.dataset.key || "";
  el.classList.add("vpp");
  el.innerHTML = `<div class="vpp-box"><textarea class="vpp-q" placeholder="Napr.: Je poistený dron v kooperatíve?"></textarea>
    <div class="vpp-row"><span class="vpp-lbl">Hľadať v:</span><span class="vpp-chips"></span></div>
    <div class="vpp-row"><button class="vpp-go vpp-pri" disabled>Opýtať sa</button><span class="vpp-status vpp-lbl">Načítavam dokumenty…</span></div>
    <div class="vpp-row vpp-ex"></div></div><div class="vpp-answer"></div><div class="vpp-src"></div><div class="vpp-foot"></div>`;
  const $ = (c) => el.querySelector(".vpp-" + c);
  const selected = new Set();
  let index = null;

  const renderChips = () => {
    $("chips").innerHTML = "";
    for (const n of INSURERS) {
      const b = document.createElement("button");
      b.className = "vpp-chip"; b.textContent = n; b.setAttribute("aria-pressed", selected.has(n));
      b.onclick = () => { selected.has(n) ? selected.delete(n) : selected.add(n); renderChips(); };
      $("chips").append(b);
    }
    const l = document.createElement("span"); l.className = "vpp-lbl";
    l.textContent = selected.size ? "" : "(všetky – alebo tie, ktoré spomenieš v otázke)"; $("chips").append(l);
  };

  const renderSources = (res) => {
    let h = "<h3>Nájdené články (zdroje)</h3>";
    if (!res.results.length) h += '<p class="vpp-lbl">Nič sa nenašlo. Skús otázku sformulovať inými slovami.</p>';
    for (const { chunk: c } of res.results) {
      const pg = c.p0 === c.p1 ? c.p0 : c.p0 + "–" + c.p1;
      h += `<details class="vpp-s"><summary><span class="vpp-badge">${esc(c.insurer)}</span><span>${esc(c.doc)}</span><span class="vpp-lbl">str. ${pg}${c.h ? " · " + esc(c.h) : ""}</span></summary><pre>${esc(c.t)}</pre></details>`;
    }
    $("src").innerHTML = h;
  };

  const promptForAI = (q, res) => "Odpovedz po slovensky na otázku o poistných podmienkach VÝHRADNE podľa týchto úryvkov. Pre každú poisťovňu uveď, či je to kryté, podmienky, limity a výluky, a pri tvrdeniach uveď zdroj (poisťovňa, strana). Ak v úryvkoch odpoveď nie je, napíš to.\n\nOTÁZKA: " + q + "\n\nÚRYVKY:\n\n" +
    res.results.map((r) => `[${r.chunk.insurer} | ${r.chunk.doc} | str. ${r.chunk.p0}]\n${r.chunk.t}`).join("\n\n---\n\n");

  const callAI = async (q, res) => {
    const headers = { "content-type": "application/json" };
    if (key) headers.apikey = key;
    const r = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ question: q, ids: res.results.map((x) => x.chunk.id) }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || data.message || "Chyba servera (" + r.status + ")");
    return data.answer;
  };

  const ask = async () => {
    const q = $("q").value.trim();
    if (!q || !index) return;
    $("go").disabled = true;
    const res = search(index, q, { insurers: [...selected] });
    renderSources(res);
    $("status").textContent = "Hľadané v: " + res.searched.join(", ") + (res.mentioned.length && !selected.size ? " (podľa otázky)" : "");
    const a = $("answer");
    if (!res.results.length) { a.innerHTML = ""; $("go").disabled = false; return; }
    a.innerHTML = '<div class="vpp-box"><span class="vpp-spin"></span>AI formuluje odpoveď…</div>';
    try {
      a.innerHTML = '<div class="vpp-box">' + md(await callAI(q, res)) + '</div><div class="vpp-note">Odpoveď vytvorila AI z nájdených úryvkov. Pri dôležitých veciach si ju over v zdrojoch nižšie a v poistnej zmluve klienta.</div>';
    } catch (e) {
      a.innerHTML = `<div class="vpp-err">${esc(e.message)} Nižšie sú nájdené články – môžeš si ich prečítať, alebo ich skopírovať do AI chatu.</div><div class="vpp-row"><button class="vpp-cp">Skopírovať otázku + úryvky do AI chatu</button></div>`;
      const cp = a.querySelector(".vpp-cp");
      cp.onclick = async () => { await navigator.clipboard.writeText(promptForAI(q, res)); cp.textContent = "Skopírované ✓"; };
    }
    $("go").disabled = false;
  };

  renderChips();
  for (const t of EXAMPLES) { const b = document.createElement("button"); b.textContent = t; b.onclick = () => { $("q").value = t; ask(); }; $("ex").append(b); }
  $("go").onclick = ask;
  $("q").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } });
  const d = await loadData();
  index = d.index;
  $("status").textContent = "Pripravené (" + d.chunks.length + " úryvkov)";
  $("go").disabled = false;
  $("foot").innerHTML = "Dokumenty v databáze:<br>" + [...new Set(d.chunks.map((c) => c.insurer + ": " + c.doc))].map(esc).join("<br>") + "<br>Strana = strana v PDF súbore (v Allianz PDF je na jednom liste dvojstrana).";
}

const auto = () => document.querySelectorAll("[data-vpp]").forEach(mountVpp);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", auto); else auto();
