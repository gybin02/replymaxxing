// BossMaxxing 定制简历在线编辑器：点击任意文字即可编辑，支持一键打印导出 A4 PDF 或下载 Word (.docx)
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const qs = new URLSearchParams(location.search);
const KEY = qs.get("key") || "";
let JOB = null,
  V = 0,
  R = null;
const PH = /\[[^\]\n]{1,40}\]/g;

async function load() {
  const { abJobs = {} } = await chrome.storage.local.get("abJobs");
  JOB = abJobs[KEY];
  if (!JOB || !JOB.versions || !JOB.versions.length) {
    $("doc").append(el("p", "", "未找到定制简历记录。请先在侧边栏「简历定制」中点击「立即按此 JD 定制简历」。"));
    return;
  }
  const want = parseInt(qs.get("v") || "", 10);
  V = Number.isFinite(want) && want >= 1 && want <= JOB.versions.length ? want - 1 : JOB.versions.length - 1;
  show();
}

function show() {
  const ver = JOB.versions[V];
  if (!ver.original) ver.original = JSON.parse(JSON.stringify(ver.resume));
  R = ver.resume;
  $("tbTitle").textContent = `${R.name || "个人"}简历${JOB.company ? " · 应聘 " + JOB.company : ""}`;
  $("tbSub").textContent = `${JOB.title || "定制版本"} · 版本 v${V + 1}/${JOB.versions.length} · 点击任意文字可直接编辑并自动保存`;
  renderDoc();
  renderSide();
  marks();
}

let saveT = null;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    const { abJobs = {} } = await chrome.storage.local.get("abJobs");
    if (!abJobs[KEY]) return;
    abJobs[KEY].versions[V] = JOB.versions[V];
    await chrome.storage.local.set({ abJobs });
  }, 400);
}

function edit(tag, cls, text, set, ph) {
  const e = el(tag, cls, text || "");
  e.contentEditable = "plaintext-only";
  e.spellcheck = false;
  if (ph) e.dataset.ph = ph;
  e.addEventListener("input", () => {
    set(e.innerText.replace(/\n+/g, " ").trim());
    save();
    marks();
  });
  e.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      e.blur();
    }
  });
  return e;
}

function bulletList(list, onChange) {
  const ul = el("ul");
  list.forEach((b, i) => {
    const li = el("li");
    li.append(
      edit("span", "", b, (v) => {
        list[i] = v;
      })
    );
    const x = el("button", "x", "✕");
    x.title = "删除此条经历";
    x.onclick = () => {
      list.splice(i, 1);
      save();
      onChange();
    };
    li.append(x);
    ul.append(li);
  });
  return ul;
}

function renderDoc() {
  const d = $("doc");
  d.innerHTML = "";
  d.append(edit("h1", "", R.name, (v) => (R.name = v)));
  d.append(edit("div", "hl", R.headline, (v) => (R.headline = v)));
  const c = R.contact || (R.contact = {});
  const ct = el("div", "ct");
  ["phone", "email", "location", "linkedin", "website"]
    .filter((k) => c[k])
    .forEach((k, i) => {
      if (i) ct.append(" | ");
      ct.append(edit("span", "", c[k], (v) => (c[k] = v)));
    });
  d.append(ct);
  if (R.summary) {
    d.append(el("h2", "", "个人优势"));
    d.append(edit("p", "", R.summary, (v) => (R.summary = v)));
  }
  if (R.skills && R.skills.length) {
    d.append(el("h2", "", "专业技能"));
    R.skills.forEach((g) => {
      const p = el("p", "sk");
      if (g.group) p.append(el("b", "", g.group + "："));
      p.append(edit("span", "", g.items.join("、"), (v) => (g.items = v.split(/\s*[、,，]\s*/).filter(Boolean))));
      d.append(p);
    });
  }
  if (R.experience && R.experience.length) {
    d.append(el("h2", "", "工作经历"));
    R.experience.forEach((e) => {
      const w = el("div", "ent");
      const h = el("div", "eh");
      const left = el("div", "");
      left.append(edit("span", "t", e.company, (v) => (e.company = v)), document.createTextNode(" · "), edit("span", "t", e.title, (v) => (e.title = v)));
      const dates = el("div", "d");
      dates.append(edit("span", "", e.start, (v) => (e.start = v)), document.createTextNode(" - "), edit("span", "", e.end, (v) => (e.end = v)));
      h.append(left, dates);
      w.append(h);
      if (e.location) w.append(edit("div", "es", e.location, (v) => (e.location = v)));
      w.append(bulletList(e.bullets, renderDoc));
      const add = el("button", "add", "+ 新增一条 STAR/XYZ 成果描述");
      add.onclick = () => {
        e.bullets.push("主导 [核心动作 X]，通过 [关键方案 Z]，将核心业务指标提升 [提升Y%]");
        save();
        renderDoc();
        marks();
      };
      w.append(add);
      d.append(w);
    });
  }
  if (R.projects && R.projects.length) {
    d.append(el("h2", "", "项目经历"));
    R.projects.forEach((p) => {
      const w = el("div", "ent");
      w.append(edit("div", "t", p.name, (v) => (p.name = v)));
      w.querySelector(".t").style.fontWeight = "700";
      w.append(bulletList(p.bullets, renderDoc));
      d.append(w);
    });
  }
  if (R.education && R.education.length) {
    d.append(el("h2", "", "教育经历"));
    R.education.forEach((e) => {
      const w = el("div", "ent");
      const h = el("div", "eh");
      const left = el("div", "");
      left.append(edit("span", "t", e.school, (v) => (e.school = v)));
      const deg = [e.degree, e.field].filter(Boolean).join(" · ");
      if (deg) {
        left.append(document.createTextNode(" · "));
        left.append(
          edit("span", "", deg, (v) => {
            e.degree = v;
            e.field = "";
          })
        );
      }
      h.append(
        left,
        edit("div", "d", [e.start, e.end].filter(Boolean).join(" - "), (v) => {
          e.start = "";
          e.end = v;
        })
      );
      w.append(h);
      if (e.details) w.append(edit("p", "", e.details, (v) => (e.details = v)));
      d.append(w);
    });
  }
}

function marks() {
  const doc = $("doc");
  const ranges = [];
  let n = 0;
  const walk = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
  for (let t = walk.nextNode(); t; t = walk.nextNode()) {
    for (const m of t.data.matchAll(PH)) {
      const r = new Range();
      r.setStart(t, m.index);
      r.setEnd(t, m.index + m[0].length);
      ranges.push(r);
      n++;
    }
  }
  try {
    CSS.highlights.set("ph", new Highlight(...ranges));
  } catch {}
  const w = $("phWarn");
  w.classList.toggle("hidden", !n);
  w.textContent = n ? `⚠️ 简历中还有 ${n} 处黄色高亮占位符（如 [提升X%]）需要填入您的真实业务数据。直接点击对应文字即可修改。` : "";
}

function renderSide() {
  const s = $("side");
  s.innerHTML = "";
  const ver = JOB.versions[V];
  const vb = el("div", "box");
  vb.append(el("h4", "", "定制版本"));
  const vs = el("div", "vers");
  JOB.versions.forEach((_, i) => {
    const b = el("button", i === V ? "on" : "", `v${i + 1}`);
    b.onclick = () => {
      V = i;
      show();
    };
    vs.append(b);
  });
  vb.append(vs);
  const reset = el("button", "btn ghost sm", "还原初始生成版本");
  reset.style.marginTop = "8px";
  reset.onclick = () => {
    if (!ver.original) return;
    ver.resume = JSON.parse(JSON.stringify(ver.original));
    save();
    show();
  };
  vb.append(reset);
  s.append(vb);

  if (ver.match && ver.match.after != null) {
    const m = el("div", "box");
    m.append(el("h4", "", "Boss直聘岗位匹配度"));
    const sc = el("div", "score");
    sc.append(el("b", "", `${ver.match.before ?? "?"}% → ${ver.match.after}%`));
    m.append(sc);
    if (ver.match.keywordsAdded && ver.match.keywordsAdded.length) {
      m.append(el("p", "", "已对齐核心关键词"));
      const k = el("div", "kw");
      ver.match.keywordsAdded.forEach((x) => k.append(el("span", "", x)));
      m.append(k);
    }
    s.append(m);
  }
  if (ver.gaps && ver.gaps.length) {
    const g = el("div", "box");
    g.append(el("h4", "", "投递前优化建议"));
    const ul = el("ul");
    ver.gaps.forEach((x) => {
      const li = el("li");
      li.append(el("b", "", x.gap + "："), document.createTextNode(x.advice));
      ul.append(li);
    });
    g.append(ul);
    s.append(g);
  }
  if (ver.changes && ver.changes.length) {
    const c = el("div", "box");
    c.append(el("h4", "", "本次 AI 改写重点"));
    const ul = el("ul");
    ver.changes.forEach((x) => ul.append(el("li", "", x)));
    c.append(ul);
    s.append(c);
  }
}

function plainText(r) {
  const L = [
    r.name,
    r.headline,
    ["phone", "email", "location", "linkedin", "website"]
      .map((k) => r.contact && r.contact[k])
      .filter(Boolean)
      .join(" | "),
    "",
  ];
  if (r.summary) L.push("【个人优势】", r.summary, "");
  if (r.skills && r.skills.length) {
    L.push("【专业技能】");
    r.skills.forEach((g) => L.push((g.group ? g.group + "：" : "") + g.items.join("、")));
    L.push("");
  }
  if (r.experience && r.experience.length) {
    L.push("【工作经历】");
    r.experience.forEach((e) => {
      L.push(`${[e.company, e.title].filter(Boolean).join(" · ")} | ${[e.start, e.end].filter(Boolean).join(" - ")}`);
      e.bullets.forEach((b) => L.push("• " + b));
      L.push("");
    });
  }
  if (r.projects && r.projects.length) {
    L.push("【项目经历】");
    r.projects.forEach((p) => {
      L.push(p.name);
      p.bullets.forEach((b) => L.push("• " + b));
    });
    L.push("");
  }
  if (r.education && r.education.length) {
    L.push("【教育经历】");
    r.education.forEach((e) =>
      L.push([e.school, [e.degree, e.field].filter(Boolean).join(" · "), [e.start, e.end].filter(Boolean).join(" - ")].filter(Boolean).join(" | "))
    );
  }
  return L.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (u8) => {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function zip(files) {
  const enc = new TextEncoder(),
    parts = [],
    central = [];
  let off = 0;
  for (const [name, text] of files) {
    const nb = enc.encode(name),
      data = enc.encode(text),
      crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true);
    h.setUint16(8, 0, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(h.buffer), nb, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, nb.length, true);
    c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nb);
    off += 30 + nb.length + data.length;
  }
  const size = central.reduce((t, p) => t + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
const x = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const run = (t, o = {}) =>
  `<w:r><w:rPr>${o.b ? "<w:b/>" : ""}${o.i ? "<w:i/>" : ""}${o.sz ? `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` : ""}</w:rPr><w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
const para = (runs, o = {}) =>
  `<w:p><w:pPr>${o.center ? '<w:jc w:val="center"/>' : ""}${o.rule ? '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="222222"/></w:pBdr>' : ""}${o.tab ? '<w:tabs><w:tab w:val="right" w:pos="10800"/></w:tabs>' : ""}<w:spacing w:before="${o.before || 0}" w:after="${o.after || 0}"/>${o.bullet ? '<w:ind w:left="360" w:hanging="240"/>' : ""}</w:pPr>${runs}</w:p>`;
function docx(r) {
  const P = [];
  P.push(para(run(r.name, { b: true, sz: 36 }), { center: true }));
  if (r.headline) P.push(para(run(r.headline, { sz: 22 }), { center: true }));
  const ct = ["phone", "email", "location", "linkedin", "website"]
    .map((k) => r.contact && r.contact[k])
    .filter(Boolean)
    .join(" | ");
  if (ct) P.push(para(run(ct, { sz: 19 }), { center: true, after: 80 }));
  const H = (t) => P.push(para(run(t, { b: true, sz: 22 }), { rule: true, before: 200, after: 80 }));
  const B = (t) => P.push(para(run("•  " + t), { bullet: true, after: 30 }));
  if (r.summary) {
    H("个人优势");
    P.push(para(run(r.summary)));
  }
  if (r.skills && r.skills.length) {
    H("专业技能");
    r.skills.forEach((g) => P.push(para((g.group ? run(g.group + "：", { b: true }) : "") + run(g.items.join("、")), { after: 30 })));
  }
  if (r.experience && r.experience.length) {
    H("工作经历");
    r.experience.forEach((e) => {
      P.push(
        para(
          run([e.company, e.title].filter(Boolean).join(" · "), { b: true }) +
            `<w:r><w:tab/></w:r>` +
            run([e.start, e.end].filter(Boolean).join(" - ")),
          { tab: true, before: 100 }
        )
      );
      e.bullets.forEach(B);
    });
  }
  if (r.projects && r.projects.length) {
    H("项目经历");
    r.projects.forEach((p) => {
      P.push(para(run(p.name, { b: true }), { before: 80 }));
      p.bullets.forEach(B);
    });
  }
  if (r.education && r.education.length) {
    H("教育经历");
    r.education.forEach((e) => {
      P.push(
        para(
          run([e.school, [e.degree, e.field].filter(Boolean).join(" · ")].filter(Boolean).join(" · "), { b: true }) +
            `<w:r><w:tab/></w:r>` +
            run([e.start, e.end].filter(Boolean).join(" - ")),
          { tab: true, before: 60 }
        )
      );
    });
  }
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${P.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="PingFang SC" w:hAnsi="PingFang SC" w:cs="PingFang SC" w:eastAsia="PingFang SC"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`;
  return zip([
    [
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    ],
    [
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ],
    [
      "word/_rels/document.xml.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    ],
    ["word/document.xml", doc],
    ["word/styles.xml", styles],
  ]);
}

const fileBase = () => [R.name || "个人简历", JOB.title, JOB.company].filter(Boolean).join("_").replace(/[\\/:*?"<>|]+/g, "").trim();

$("dlPdf").onclick = () => {
  const t = document.title;
  document.title = fileBase();
  window.print();
  setTimeout(() => (document.title = t), 1000);
};
$("dlDocx").onclick = () => {
  const a = el("a");
  a.href = URL.createObjectURL(docx(R));
  a.download = fileBase() + ".docx";
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 2000);
};
$("copyTxt").onclick = async () => {
  try {
    await navigator.clipboard.writeText(plainText(R));
    $("copyTxt").textContent = "已复制 ✓";
    setTimeout(() => ($("copyTxt").textContent = "复制纯文本"), 1500);
  } catch {}
};
load();
