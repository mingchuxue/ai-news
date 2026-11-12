/* 观澜 · 人工智能资讯 */
(function () {
  "use strict";

  const DATA_URL = "data/news.json";
  const FAV_KEY = "guanlan-favs";
  const TZ = "Asia/Shanghai";
  const SRC_HUES = [162, 28, 210, 42, 280, 190, 8, 125, 330, 50, 240, 80];

  const state = {
    data: null,
    q: "",
    models: [],
    topics: [],
    types: [],
    platforms: [],
    sources: [],
    region: [],
    lang: [],
    range: "30d",
    sort: "newest",
    fav: false,
    favs: new Set(),
    limit: 50,
  };
  const PAGE = 50;

  const $ = (id) => document.getElementById(id);
  const els = {};

  function loadFavs() {
    try {
      const raw = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
      state.favs = new Set(Array.isArray(raw) ? raw : []);
    } catch (e) {
      state.favs = new Set();
    }
  }
  function saveFavs() {
    localStorage.setItem(FAV_KEY, JSON.stringify([...state.favs]));
  }

  function shanghaiDate(iso) {
    const d = new Date(iso);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d); // YYYY-MM-DD
    return parts;
  }
  function shanghaiNowDate() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
  }
  function yesterdayDate() {
    const now = new Date();
    // 26 hours back is a safe walk; compute via formatter on now-24h in Shanghai
    const t = now.getTime() - 24 * 3600 * 1000;
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(t));
  }
  function weekday(ymd) {
    const [y, m, d] = ymd.split("-").map(Number);
    const days = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    // noon UTC-ish to avoid DST issues; Shanghai has no DST
    const dt = new Date(Date.UTC(y, m - 1, d, 4, 0, 0));
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(dt);
    const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return days[map[wd] ?? dt.getUTCDay()];
  }
  function dayLabel(ymd) {
    const today = shanghaiNowDate();
    const yest = yesterdayDate();
    if (ymd === today) return { main: "今天", sub: "" };
    if (ymd === yest) return { main: "昨天", sub: weekday(ymd) };
    const [y, m, d] = ymd.split("-");
    const thisYear = today.slice(0, 4);
    const main = (y === thisYear ? "" : y + " 年 ") + Number(m) + " 月 " + Number(d) + " 日";
    return { main, sub: weekday(ymd) };
  }
  function fmtClock(iso) {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
  }
  function fmtFull(iso) {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: TZ, year: "numeric", month: "numeric", day: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
  }
  function relTime(iso) {
    const t = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.round((now - t) / 1000);
    if (diff < 60 && diff >= -120) return "刚刚";
    if (diff < 0) return fmtClock(iso);
    if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
    if (diff < 36 * 3600 && shanghaiDate(iso) === shanghaiNowDate()) return fmtClock(iso);
    if (shanghaiDate(iso) === yesterdayDate()) return "昨天 " + fmtClock(iso);
    return Number(shanghaiDate(iso).slice(5, 7)) + " 月 " + Number(shanghaiDate(iso).slice(8, 10)) + " 日 " + fmtClock(iso);
  }

  function sourceColor(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    const hue = SRC_HUES[h % SRC_HUES.length];
    return "hsl(" + hue + " 32% 42%)";
  }

  function parseHash() {
    const raw = (location.hash || "").replace(/^#\/?/, "").replace(/^\?/, "");
    const q = new URLSearchParams(raw.includes("=") || raw.includes("&") || raw ? raw : location.search.replace(/^\?/, ""));
    const list = (k) => (q.get(k) || "").split(/[,+]/).map((s) => s.trim()).filter(Boolean);
    state.q = q.get("q") || "";
    state.models = list("m");
    state.topics = list("f");
    state.types = list("t");
    state.platforms = list("p");
    state.sources = list("s");
    state.region = list("r");
    state.lang = list("l");
    state.range = q.get("d") || "30d";
    state.sort = q.get("o") || "newest";
    state.fav = q.get("star") === "1";
  }

  function writeHash() {
    const q = new URLSearchParams();
    const put = (k, arr) => { if (arr && arr.length) q.set(k, arr.join(",")); };
    if (state.q) q.set("q", state.q);
    put("m", state.models);
    put("f", state.topics);
    put("t", state.types);
    put("p", state.platforms);
    put("s", state.sources);
    put("r", state.region);
    put("l", state.lang);
    if (state.range && state.range !== "30d") q.set("d", state.range);
    if (state.sort && state.sort !== "newest") q.set("o", state.sort);
    if (state.fav) q.set("star", "1");
    const s = q.toString();
    const next = s ? "#?" + s : (location.pathname + location.search).split("#")[0] === location.href.split("#")[0] ? "#" : "";
    const url = s ? location.pathname + location.search + "#?" + s : location.pathname + location.search;
    if (url !== location.pathname + location.search + location.hash) {
      history.replaceState(null, "", url);
    }
  }

  function inRange(item) {
    const t = new Date(item.published).getTime();
    const now = Date.now();
    if (state.range === "all") return true;
    if (state.range === "1d") return shanghaiDate(item.published) === shanghaiNowDate();
    if (state.range === "7d") return t >= now - 7 * 86400 * 1000;
    if (state.range === "30d") return t >= now - 30 * 86400 * 1000;
    return true;
  }

  function matchesSearch(item, q) {
    if (!q) return true;
    const hay = (item.title + " " + (item.excerpt || "") + " " + item.source_name).toLowerCase();
    return q.split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  }

  function orHas(sel, vals) {
    if (!sel.length) return true;
    return vals.some((v) => sel.includes(v));
  }

  function passFilters(item, skip) {
    if (state.fav && !state.favs.has(item.id)) return false;
    if (!inRange(item)) return false;
    const q = state.q.trim().toLowerCase();
    if (q && !matchesSearch(item, q)) return false;
    if (skip !== "models" && !orHas(state.models, item.models || [])) return false;
    if (skip !== "topics" && !orHas(state.topics, item.topics || [])) return false;
    if (skip !== "types" && !orHas(state.types, item.types || [])) return false;
    if (skip !== "platforms" && !orHas(state.platforms, item.platforms || [])) return false;
    if (skip !== "sources" && !orHas(state.sources, [item.source_id])) return false;
    if (skip !== "region" && !orHas(state.region, [item.region])) return false;
    if (skip !== "lang" && !orHas(state.lang, [item.lang])) return false;
    return true;
  }

  function filtered(skip) {
    return (state.data.items || []).filter((it) => passFilters(it, skip));
  }

  function facetCount(key, id) {
    const skip = key;
    let n = 0;
    const items = filtered(skip);
    for (const it of items) {
      let vals;
      if (key === "models") vals = it.models || [];
      else if (key === "topics") vals = it.topics || [];
      else if (key === "types") vals = it.types || [];
      else if (key === "platforms") vals = it.platforms || [];
      else if (key === "sources") vals = [it.source_id];
      else if (key === "region") vals = [it.region];
      else if (key === "lang") vals = [it.lang];
      else vals = [];
      if (vals.includes(id)) n++;
    }
    return n;
  }

  function toggleIn(arr, id) {
    const i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(id);
  }

  function activeCount() {
    return (
      (state.q ? 1 : 0) +
      state.models.length + state.topics.length + state.types.length +
      state.platforms.length +
      state.sources.length + state.region.length + state.lang.length +
      (state.range !== "30d" ? 1 : 0) +
      (state.fav ? 1 : 0)
    );
  }

  function resetAll() {
    state.q = "";
    state.models = [];
    state.topics = [];
    state.types = [];
    state.platforms = [];
    state.sources = [];
    state.region = [];
    state.lang = [];
    state.range = "30d";
    state.sort = "newest";
    state.fav = false;
    if (els.q) els.q.value = "";
  }

  function nameOf(group, id) {
    const tax = state.data.taxonomy || {};
    const map = {
      models: tax.models, topics: tax.topics, types: tax.types, platforms: tax.platforms,
    };
    if (map[group]) {
      const t = map[group].find((x) => x.id === id);
      if (t) return t.name;
    }
    if (group === "sources") {
      const s = (state.data.sources || []).find((x) => x.id === id);
      if (s) return s.name;
    }
    if (group === "region") return id === "cn" ? "国内" : "国际";
    if (group === "lang") return id === "zh" ? "中文" : "English";
    if (group === "range") return ({ "1d": "今天", "7d": "近 7 天", "30d": "近 30 天", all: "全部" })[id] || id;
    return id;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderFilters() {
    const data = state.data;
    const tax = data.taxonomy;
    const sources = (data.sources || []).filter((s) => s.count > 0);
    const official = sources.filter((s) => s.official);
    const others = sources.filter((s) => !s.official);

    const seg = (key, options) => {
      const buttons = options.map(([id, label]) => {
        const on = state[key] === id;
        return `<button type="button" data-seg="${key}" data-id="${esc(id)}" aria-pressed="${on}">${esc(label)}</button>`;
      }).join("");
      return `<div class="seg" role="group">${buttons}</div>`;
    };

    const chipGroup = (group, items, opts) => {
      const limit = (opts && opts.limit) || 16;
      const selected = state[group] || [];
      let shown = items.slice();
      // always show selected, even if beyond the fold
      const html = shown.map((t, i) => {
        const n = facetCount(group, t.id);
        const on = selected.includes(t.id);
        const hide = !on && i >= limit && !opts.always;
        const cls = "chip" + (n === 0 && !on ? " is-off" : "") + (hide ? " js-more" : "");
        const style = hide ? " style=\"display:none\"" : "";
        const extra = group === "sources" ? ` style="--src:${sourceColor(t.id)}${hide ? ";display:none" : ""}"` : style;
        return `<button type="button" class="${cls}" data-group="${group}" data-id="${esc(t.id)}" aria-pressed="${on}"${extra}><span>${esc(t.name)}</span><span class="n">${n}</span></button>`;
      }).join("");
      const more = shown.length > limit && !opts.always
        ? `<button type="button" class="chip chip-more" data-expand="${group}">显示全部 ${shown.length}</button>`
        : "";
      return `<div class="chips" data-chips="${group}">${html}${more}</div>`;
    };

    const modelItems = tax.models.filter((t) => t.count > 0 || state.models.includes(t.id));
    const topicItems = tax.topics.filter((t) => t.count > 0 || state.topics.includes(t.id));
    const typeItems = tax.types.filter((t) => t.count > 0 || state.types.includes(t.id));
    const platformItems = ((tax.platforms || []).filter((t) => t.count > 0 || state.platforms.includes(t.id)));
    const srcItems = sources.map((s) => ({ id: s.id, name: s.name, official: s.official }));
    // official first already from payload; keep it

    els.filterBody.innerHTML = `
      <section class="fg">
        <div class="fg-title">时间</div>
        ${seg("range", [["1d", "今天"], ["7d", "近 7 天"], ["30d", "近 30 天"], ["all", "全部"]])}
      </section>
      <section class="fg">
        <div class="fg-title">排序</div>
        ${seg("sort", [["newest", "最新优先"], ["source", "按来源"]])}
      </section>
      <section class="fg">
        <div class="fg-title">模型</div>
        ${chipGroup("models", modelItems, { limit: 14 })}
      </section>
      <section class="fg">
        <div class="fg-title">功能 / 领域</div>
        ${chipGroup("topics", topicItems, { limit: 16, always: true })}
      </section>
      <section class="fg">
        <div class="fg-title">类型</div>
        ${chipGroup("types", typeItems, { limit: 16, always: true })}
      </section>
      <section class="fg">
        <div class="fg-title">平台</div>
        ${chipGroup("platforms", platformItems, { always: true })}
      </section>
      <section class="fg">
        <div class="fg-title">来源</div>
        ${chipGroup("sources", srcItems, { limit: 12 })}
      </section>
      <section class="fg">
        <div class="fg-title">地区</div>
        ${chipGroup("region", [{ id: "cn", name: "国内" }, { id: "intl", name: "国际" }], { always: true })}
      </section>
      <section class="fg">
        <div class="fg-title">语言</div>
        ${chipGroup("lang", [{ id: "zh", name: "中文" }, { id: "en", name: "English" }], { always: true })}
      </section>
    `;
  }

  function renderActive() {
    const chips = [];
    const add = (group, id) => {
      chips.push({ group, id, name: nameOf(group, id) });
    };
    state.models.forEach((id) => add("models", id));
    state.topics.forEach((id) => add("topics", id));
    state.types.forEach((id) => add("types", id));
    state.platforms.forEach((id) => add("platforms", id));
    state.sources.forEach((id) => add("sources", id));
    state.region.forEach((id) => add("region", id));
    state.lang.forEach((id) => add("lang", id));
    if (state.range !== "30d") chips.push({ group: "range", id: state.range, name: nameOf("range", state.range) });
    if (state.q) chips.push({ group: "q", id: state.q, name: "“" + state.q + "”" });
    if (state.fav) chips.push({ group: "fav", id: "1", name: "只看收藏" });

    const labels = { models: "模型", topics: "功能", types: "类型", platforms: "平台", sources: "来源", region: "地区", lang: "语言", range: "时间", q: "搜索", fav: "" };
    if (!chips.length) {
      els.activeBar.hidden = true;
      els.activeBar.innerHTML = "";
    } else {
      els.activeBar.hidden = false;
      els.activeBar.innerHTML = chips.map((c) => (
        `<span class="active-chip">${c.group && labels[c.group] ? `<b>${labels[c.group]}</b>` : ""} ${esc(c.name)} <button type="button" class="x" data-drop="${c.group}" data-id="${esc(c.id)}" aria-label="移除">×</button></span>`
      )).join("") + `<button type="button" class="clear-all" data-drop="all">清除全部</button>`;
    }

    const n = activeCount();
    if (els.badge) {
      if (n) { els.badge.hidden = false; els.badge.textContent = n; }
      else els.badge.hidden = true;
    }
    els.btnFav.setAttribute("aria-pressed", state.fav ? "true" : "false");
  }

  const EXT = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16l9-9M11 7h6v6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const STAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.6l1.7 3.7 4 .5-3 2.8.8 4-3.5-2-3.5 2 .8-4-3-2.8 4-.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

  function tagButtons(item) {
    const parts = [];
    const push = (group, ids, catalog) => {
      (ids || []).forEach((id) => {
        const t = (catalog || []).find((x) => x.id === id);
        const name = t ? t.name : id;
        parts.push(`<li><button type="button" class="tag" data-group="${group}" data-id="${esc(id)}">${esc(name)}</button></li>`);
      });
    };
    const tax = state.data.taxonomy;
    push("models", item.models, tax.models);
    push("topics", item.topics, tax.topics);
    push("types", item.types, tax.types);
    push("platforms", item.platforms, tax.platforms);
    return parts.join("");
  }

  function cardHTML(item) {
    const starred = state.favs.has(item.id);
    const color = sourceColor(item.source_id);
    return `
      <article class="card" data-id="${esc(item.id)}">
        <div class="card-top">
          <a class="source" href="${esc(item.source_home || item.url)}" target="_blank" rel="noopener noreferrer">
            <span class="dot" style="background:${color}"></span>${esc(item.source_name)}
          </a>
          <time datetime="${esc(item.published)}" title="${esc(fmtFull(item.published))}">${esc(relTime(item.published))}</time>
          <button type="button" class="star" data-star="${esc(item.id)}" aria-pressed="${starred}" aria-label="${starred ? "取消收藏" : "收藏"}">${STAR}</button>
        </div>
        <h2><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a></h2>
        ${item.excerpt ? `<p class="excerpt">${esc(item.excerpt)}</p>` : ""}
        <div class="card-foot">
          <ul class="tags">${tagButtons(item)}</ul>
          <a class="orig" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">原文 ${EXT}</a>
        </div>
      </article>`;
  }

  function renderFeed() {
    let items = filtered();
    if (state.sort === "source") {
      const order = [];
      const groups = new Map();
      items.forEach((it) => {
        if (!groups.has(it.source_id)) {
          groups.set(it.source_id, []);
          order.push(it.source_id);
        }
        groups.get(it.source_id).push(it);
      });
      items = [];
      order.forEach((sid) => {
        items.push({ _head: true, source_id: sid, source_name: groups.get(sid)[0].source_name });
        items.push(...groups.get(sid));
      });
    }

    const n = items.filter((x) => !x._head).length;
    els.count.innerHTML = state.fav
      ? `收藏中的 <em>${n}</em> 条`
      : `共 <em>${n}</em> 条资讯`;

    if (!n) {
      els.feed.innerHTML = "";
      els.empty.hidden = false;
      els.empty.querySelector("h2").textContent = state.fav && !activeCount()
        ? "还没有收藏"
        : "这一段里还没有符合条件的资讯";
      els.empty.querySelector("p").textContent = state.fav && !activeCount()
        ? "在资讯卡片右上角点星标，即可在这里找到它。"
        : "换一组标签，或把时间范围放宽一些。";
      return;
    }
    els.empty.hidden = true;

    const moreBtn = (left) => left > 0
      ? `<div class="more-wrap"><button type="button" class="more-btn" id="btn-more">加载更多（还有 ${left} 条）</button></div>`
      : "";

    if (state.sort === "source") {
      let html = "";
      let shown = 0;
      items.forEach((it) => {
        if (it._head) {
          if (shown < state.limit) html += `<div class="day"><h2>${esc(it.source_name)}</h2></div>`;
        } else if (shown < state.limit) {
          html += cardHTML(it);
          shown++;
        }
      });
      els.feed.innerHTML = html + moreBtn(n - Math.min(n, state.limit));
      return;
    }

    let html = "";
    let lastDay = "";
    const slice = items.slice(0, state.limit);
    slice.forEach((it) => {
      const day = shanghaiDate(it.published);
      if (day !== lastDay) {
        lastDay = day;
        const lb = dayLabel(day);
        html += `<div class="day"><h2>${esc(lb.main)}</h2>${lb.sub ? `<span class="sub">${esc(lb.sub)}</span>` : ""}</div>`;
      }
      html += cardHTML(it);
    });
    els.feed.innerHTML = html + moreBtn(n - slice.length);
  }

  function renderAbout() {
    const data = state.data;
    const official = (data.sources || []).filter((s) => s.official && s.count > 0);
    const media = (data.sources || []).filter((s) => !s.official && s.count > 0);
    const list = (arr) => `<ul class="src-grid">${arr.map((s) => (
      `<li><a href="${esc(s.home)}" target="_blank" rel="noopener noreferrer">${s.official ? '<span class="off-dot" title="实验室 / 官方"></span>' : ""}<span>${esc(s.name)}</span><span class="n">${s.count}</span></a></li>`
    )).join("")}</ul>`;
    els.aboutBody.innerHTML = `
      <p>观澜收集实验室、研究机构与科技媒体公开发布的人工智能资讯，亦收录各实验室、产品与媒体的官方推特账号。每条都标明来源，并链回原文；发布时间按北京时间显示。</p>
      <p>标签按标题与摘要中的关键词自动归类，可按模型、功能、类型、平台、来源、地区和语言多重组合筛选。组内为「任一」，组与组之间为「同时满足」。筛选条件会写进地址栏，方便分享。点选「推特」可只看来自官方账号的帖子。</p>
      <p>收藏保存在本机浏览器中，不会上传。</p>
      <p>最近更新：${esc(fmtFull(data.updated_at))}（北京时间）。窗口约为最近 ${data.window_days || 30} 天，当前 ${data.item_count} 条。</p>
      <h3>实验室与官方</h3>
      ${list(official)}
      <h3>媒体与其他来源</h3>
      ${list(media)}
      <p style="margin-top:22px;color:var(--faint);font-size:12.5px;">资讯来自各来源的公开订阅，标题与摘要保留原文，版权归原作者。本站只做整理与筛选，不代表各来源立场。</p>
    `;
  }

  function update(opts) {
    if (!opts || !opts.keepLimit) state.limit = PAGE;
    writeHash();
    renderFilters();
    renderActive();
    renderFeed();
    if (els.btnApply) {
      const n = filtered().length;
      els.btnApply.textContent = "查看 " + n + " 条结果";
    }
  }

  function onDrop(group, id) {
    if (group === "all") { resetAll(); return; }
    if (group === "q") { state.q = ""; els.q.value = ""; return; }
    if (group === "fav") { state.fav = false; return; }
    if (group === "range") { state.range = "30d"; return; }
    if (state[group] && Array.isArray(state[group])) {
      state[group] = state[group].filter((x) => x !== id);
    }
  }

  function bind() {
    els.q.addEventListener("input", () => {
      state.q = els.q.value;
      update();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName || "")) {
        e.preventDefault();
        els.q.focus();
        els.q.select();
      }
      if (e.key === "Escape") closeFilters();
    });

    els.filterBody.addEventListener("click", (e) => {
      const exp = e.target.closest("[data-expand]");
      if (exp) {
        const g = exp.getAttribute("data-expand");
        const box = els.filterBody.querySelector('[data-chips="' + g + '"]');
        if (box) {
          box.querySelectorAll(".js-more").forEach((n) => { n.style.display = ""; n.classList.remove("js-more"); });
          exp.remove();
        }
        return;
      }
      const seg = e.target.closest("[data-seg]");
      if (seg) {
        const key = seg.getAttribute("data-seg");
        state[key] = seg.getAttribute("data-id");
        update();
        return;
      }
      const chip = e.target.closest("[data-group]");
      if (chip && chip.hasAttribute("data-id")) {
        const g = chip.getAttribute("data-group");
        const id = chip.getAttribute("data-id");
        if (Array.isArray(state[g])) toggleIn(state[g], id);
        update();
      }
    });

    els.activeBar.addEventListener("click", (e) => {
      const drop = e.target.closest("[data-drop]");
      if (!drop) return;
      onDrop(drop.getAttribute("data-drop"), drop.getAttribute("data-id"));
      update();
    });

    els.feed.addEventListener("click", (e) => {
      if (e.target.closest("#btn-more")) {
        state.limit += PAGE;
        renderFeed();
        return;
      }
      const star = e.target.closest("[data-star]");
      if (star) {
        const id = star.getAttribute("data-star");
        if (state.favs.has(id)) state.favs.delete(id);
        else state.favs.add(id);
        saveFavs();
        // If viewing favs, item may disappear
        update();
        return;
      }
      const tag = e.target.closest(".tag[data-group]");
      if (tag) {
        const g = tag.getAttribute("data-group");
        const id = tag.getAttribute("data-id");
        if (Array.isArray(state[g]) && !state[g].includes(id)) {
          state[g].push(id);
          update();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }
    });

    els.btnFav.addEventListener("click", () => { state.fav = !state.fav; update(); });
    els.btnReset.addEventListener("click", () => { resetAll(); update(); });
    els.btnEmptyReset.addEventListener("click", () => { resetAll(); update(); });
    els.btnAbout.addEventListener("click", () => { renderAbout(); els.about.showModal(); });
    $("btn-close-about").addEventListener("click", () => els.about.close());
    els.about.addEventListener("click", (e) => { if (e.target === els.about) els.about.close(); });

    els.btnFilter.addEventListener("click", () => {
      els.filters.classList.add("is-open");
      els.mask.hidden = false;
      els.btnFilter.setAttribute("aria-expanded", "true");
    });
    $("btn-close-filters").addEventListener("click", closeFilters);
    els.mask.addEventListener("click", closeFilters);
    els.btnApply.addEventListener("click", closeFilters);
  }

  function closeFilters() {
    els.filters.classList.remove("is-open");
    els.mask.hidden = true;
    els.btnFilter.setAttribute("aria-expanded", "false");
  }

  function skeleton() {
    els.feed.innerHTML = [0, 1, 2, 3, 4, 5].map(() =>
      `<div class="sk"><div class="sk-l w40"></div><div class="sk-l w80"></div><div class="sk-l w60"></div></div>`
    ).join("");
  }

  function setUpdated(iso) {
    if (!iso) return;
    const t = "更新于 " + fmtFull(iso) + "（北京时间）";
    els.updated.textContent = t;
    $("foot-updated").textContent = t;
  }

  async function main() {
    els.q = $("q");
    els.filterBody = $("filter-body");
    els.activeBar = $("active-bar");
    els.feed = $("feed");
    els.empty = $("empty");
    els.error = $("error");
    els.count = $("count");
    els.updated = $("updated");
    els.btnFav = $("btn-fav");
    els.btnReset = $("btn-reset");
    els.btnEmptyReset = $("btn-empty-reset");
    els.btnAbout = $("btn-about");
    els.about = $("about");
    els.aboutBody = $("about-body");
    els.btnFilter = $("btn-filter");
    els.filters = $("filters");
    els.mask = $("filters-mask");
    els.btnApply = $("btn-apply");
    els.badge = $("filter-badge");

    loadFavs();
    parseHash();
    if (state.q) els.q.value = state.q;
    skeleton();
    bind();

    try {
      const res = await fetch(DATA_URL + "?t=" + Date.now());
      if (!res.ok) throw new Error("http " + res.status);
      state.data = await res.json();
    } catch (err) {
      els.feed.innerHTML = "";
      els.error.hidden = false;
      els.count.textContent = "";
      return;
    }
    setUpdated(state.data.updated_at);
    update();
  }

  window.addEventListener("hashchange", () => {
    parseHash();
    if (els.q) els.q.value = state.q;
    if (state.data) update();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main);
  else main();
})();
