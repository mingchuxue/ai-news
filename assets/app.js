/* 观澜 · 人工智能资讯 */
(function () {
  "use strict";

  const DATA_URL = "data/news.json";
  const FAV_KEY = "guanlan-favs";
  const AUTO_KEY = "guanlan-auto-zh";
  const CACHE_KEY = "guanlan-zh-cache";
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
    unread: false,
    read: new Set(),
    watchOnly: false,
    watches: { keywords: [], tags: [] },
    notify: false,
    density: "comfortable",
    autoZh: false,
    showZh: new Set(),
    hideZh: new Set(),
    limit: 50,
  };
  const PAGE = 50;

  const $ = (id) => document.getElementById(id);
  const els = {};

  const SORT_KEY = "guanlan-sort";
  const READ_KEY = "guanlan-read";
  const WATCH_KEY = "guanlan-watch";
  const DENSITY_KEY = "guanlan-density";
  const NOTIFY_KEY = "guanlan-notify";
  const SEEN_KEY = "guanlan-watch-seen";
  const SORTS = { newest: 1, oldest: 1, heat: 1, source: 1 };
  const PREMIUM_MEDIA = [
    "theverge", "techcrunch", "venturebeat", "mittr", "wired", "arstechnica",
    "ft", "ieee", "guardian", "qbitai", "36kr", "latentspace", "importai",
    "interconnects", "semianalysis", "lastweekinai", "simonwillison",
    "oneusefulthing", "aisnakeoil", "hackernews", "leiphone", "infoq-cn",
  ];

  function validSort(v) {
    return SORTS[v] ? v : "newest";
  }
  function loadSort() {
    try { return validSort(localStorage.getItem(SORT_KEY) || "newest"); }
    catch (e) { return "newest"; }
  }
  function saveSort(v) {
    try { localStorage.setItem(SORT_KEY, v); } catch (e) { /* ignore */ }
  }

  function loadRead() {
    try {
      const raw = JSON.parse(localStorage.getItem(READ_KEY) || "[]");
      state.read = new Set(Array.isArray(raw) ? raw : []);
    } catch (e) { state.read = new Set(); }
  }
  function saveRead() {
    try { localStorage.setItem(READ_KEY, JSON.stringify([...state.read])); }
    catch (e) { /* ignore */ }
  }
  function pruneRead() {
    if (!state.data) return;
    const ids = new Set((state.data.items || []).map((it) => it.id));
    let gone = 0;
    state.read.forEach((id) => {
      if (!ids.has(id)) { state.read.delete(id); gone++; }
    });
    if (gone) saveRead();
  }
  function markRead(id, on) {
    if (!id) return;
    if (on === false) state.read.delete(id);
    else state.read.add(id);
    saveRead();
    if (state.unread) { update(); return; }
    if (els.feed) renderFeed();
    else updateReadAllBtn();
  }
  function markFilteredRead() {
    filtered().forEach((it) => state.read.add(it.id));
    saveRead();
    update();
  }
  function updateReadAllBtn() {
    if (!els.btnReadAll) return;
    if (!state.data) { els.btnReadAll.hidden = true; return; }
    const items = filtered();
    const hasUnread = items.some((it) => !state.read.has(it.id));
    els.btnReadAll.hidden = !items.length || !hasUnread;
  }

  function emptyWatches() {
    return { keywords: [], tags: [] };
  }
  function loadWatches() {
    try {
      const raw = JSON.parse(localStorage.getItem(WATCH_KEY) || "null");
      const w = emptyWatches();
      if (raw && Array.isArray(raw.keywords)) {
        w.keywords = raw.keywords.filter((k) => typeof k === "string" && k.trim()).map((k) => k.trim()).slice(0, 30);
      }
      if (raw && Array.isArray(raw.tags)) {
        w.tags = raw.tags.filter((t) => t && t.group && t.id).slice(0, 40);
      }
      state.watches = w;
    } catch (e) { state.watches = emptyWatches(); }
  }
  function saveWatches() {
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(state.watches)); }
    catch (e) { /* ignore */ }
  }
  function isWatchedConfigured() {
    const w = state.watches || emptyWatches();
    return w.keywords.length + w.tags.length > 0;
  }
  function isWatched(item) {
    const w = state.watches || emptyWatches();
    for (let i = 0; i < w.tags.length; i++) {
      const t = w.tags[i];
      if (t.group === "sources" && item.source_id === t.id) return true;
      if (t.group === "models" && (item.models || []).includes(t.id)) return true;
      if (t.group === "topics" && (item.topics || []).includes(t.id)) return true;
      if (t.group === "types" && (item.types || []).includes(t.id)) return true;
      if (t.group === "platforms" && (item.platforms || []).includes(t.id)) return true;
    }
    if (!w.keywords.length) return false;
    const zh = cachedZh(item);
    const hay = (
      item.title + " " + (item.excerpt || "") + " " + item.source_name +
      (item.title_zh ? " " + item.title_zh : "") +
      (item.excerpt_zh ? " " + item.excerpt_zh : "") +
      (zh ? " " + zh.title + " " + (zh.excerpt || "") : "")
    ).toLowerCase();
    return w.keywords.some((k) => hay.includes(k.toLowerCase()));
  }
  function addWatchKeyword(raw) {
    const k = (raw || "").trim().replace(/\s+/g, " ");
    if (!k) return;
    if (k.length > 40) { toast("关键词请控制在 40 字以内"); return; }
    const w = state.watches;
    if (w.keywords.some((x) => x.toLowerCase() === k.toLowerCase())) {
      toast("已经在关注里了");
      return;
    }
    w.keywords.push(k);
    saveWatches();
    const wi = $("watch-input");
    if (wi) wi.value = "";
    update();
  }
  function addWatchTags(tags) {
    const w = state.watches;
    let n = 0;
    tags.forEach((t) => {
      if (!t.group || !t.id) return;
      if (w.tags.some((x) => x.group === t.group && x.id === t.id)) return;
      w.tags.push({ group: t.group, id: t.id });
      n++;
    });
    if (n) { saveWatches(); update(); }
    else toast("这些标签已经在关注里了");
  }
  function addWatchesFromFilters() {
    const tags = [];
    const push = (group, arr) => arr.forEach((id) => tags.push({ group, id }));
    push("models", state.models);
    push("topics", state.topics);
    push("types", state.types);
    push("platforms", state.platforms);
    push("sources", state.sources);
    if (!tags.length) { toast("请先选择要关注的标签"); return; }
    addWatchTags(tags);
  }
  function removeWatch(kind, id, group) {
    const w = state.watches;
    if (kind === "kw") w.keywords = w.keywords.filter((k) => k !== id);
    else w.tags = w.tags.filter((t) => !(t.group === group && t.id === id));
    saveWatches();
    if (!isWatchedConfigured()) state.watchOnly = false;
    update();
  }

  function loadNotify() {
    try { state.notify = localStorage.getItem(NOTIFY_KEY) === "1"; }
    catch (e) { state.notify = false; }
  }
  function saveNotify() {
    try { localStorage.setItem(NOTIFY_KEY, state.notify ? "1" : "0"); }
    catch (e) { /* ignore */ }
  }
  function notifySupported() {
    return typeof Notification !== "undefined" && !!window.isSecureContext;
  }
  async function setNotify(on) {
    if (on) {
      if (!notifySupported()) { toast("当前浏览器不支持通知"); return; }
      if (!isWatchedConfigured()) { toast("请先添加关注的关键词或标签"); return; }
      let perm = Notification.permission;
      if (perm === "default") {
        try { perm = await Notification.requestPermission(); }
        catch (e) { perm = "denied"; }
      }
      if (perm !== "granted") {
        state.notify = false;
        saveNotify();
        toast(perm === "denied" ? "浏览器未允许通知，可在站点设置里更改" : "未开启通知");
        renderFilters();
        return;
      }
      state.notify = true;
      saveNotify();
      try { localStorage.setItem(SEEN_KEY, new Date().toISOString()); } catch (e) { /* ignore */ }
      toast("已开启。打开本页时，如有符合关注的新资讯会提醒");
    } else {
      state.notify = false;
      saveNotify();
    }
    renderFilters();
  }
  function maybeNotify() {
    if (!state.data) return;
    let last = null;
    try { last = localStorage.getItem(SEEN_KEY); } catch (e) { last = null; }
    const nowIso = new Date().toISOString();
    if (!last) {
      try { localStorage.setItem(SEEN_KEY, nowIso); } catch (e) { /* ignore */ }
      return;
    }
    const lastT = new Date(last).getTime();
    if (!isFinite(lastT)) return;
    const fresh = isWatchedConfigured()
      ? (state.data.items || []).filter((it) => isWatched(it) && new Date(it.published).getTime() > lastT)
      : [];
    try { localStorage.setItem(SEEN_KEY, nowIso); } catch (e) { /* ignore */ }
    if (!fresh.length || !state.notify || !notifySupported() || Notification.permission !== "granted") return;
    const first = fresh[0];
    const title = first.title_zh || first.title;
    const body = fresh.length === 1 ? title : (fresh.length + " 条你关注的新资讯：" + title);
    try {
      const n = new Notification("观澜", { body: body, icon: "favicon.svg", lang: "zh-CN" });
      n.onclick = function () { window.focus(); n.close(); };
    } catch (e) { /* ignore */ }
  }

  function loadDensity() {
    try {
      const v = localStorage.getItem(DENSITY_KEY);
      state.density = v === "compact" ? "compact" : "comfortable";
    } catch (e) { state.density = "comfortable"; }
  }
  function applyDensity() {
    document.body.classList.toggle("density-compact", state.density === "compact");
    document.querySelectorAll("[data-density]").forEach((b) => {
      b.setAttribute("aria-pressed", b.getAttribute("data-density") === state.density ? "true" : "false");
    });
  }
  function setDensity(v) {
    state.density = v === "compact" ? "compact" : "comfortable";
    try { localStorage.setItem(DENSITY_KEY, state.density); } catch (e) { /* ignore */ }
    applyDensity();
  }

  function isTweet(item) {
    return (item.platforms || []).indexOf("x") >= 0 || String(item.source_id || "").indexOf("x-") === 0;
  }
  function sourceWeight(item) {
    if (isTweet(item)) {
      const src = sourceMeta(item.source_id);
      return src && src.official ? 1.15 : 1.05;
    }
    if (item.source_id === "arxiv" || item.source_id === "arxiv-ai") return 1.25;
    const src = sourceMeta(item.source_id);
    if (src && src.official) return 1.55;
    if (PREMIUM_MEDIA.indexOf(item.source_id) >= 0) return 1.25;
    return 1;
  }
  function sourceMeta(id) {
    const list = (state.data && state.data.sources) || [];
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function engagementTerm(item) {
    const e = item.engagement;
    if (!e || typeof e !== "object") return 0;
    let raw = 0;
    if ("likes" in e || "retweets" in e) {
      raw = (e.likes || 0) + 2 * (e.retweets || 0) + 1.5 * (e.quotes || 0) + 0.4 * (e.replies || 0);
    } else if ("points" in e) {
      raw = (e.points || 0) + 0.25 * (e.comments || 0);
    }
    if (raw <= 0) return 0;
    return Math.log10(1 + raw) * 0.45;
  }
  function heatScore(item) {
    const t = new Date(item.published).getTime();
    const ageH = Math.max(0, (Date.now() - t) / 3600000);
    const recency = Math.pow(2, -ageH / 36);
    return recency * (sourceWeight(item) + engagementTerm(item));
  }

  function fmtCount(n) {
    n = Number(n) || 0;
    if (n >= 10000) {
      const w = n / 10000;
      const s = w >= 10 ? String(Math.round(w)) : String(Math.round(w * 10) / 10);
      return s + " 万";
    }
    return String(n);
  }
  function engHTML(item) {
    const e = item.engagement;
    if (!e) return "";
    const bits = [];
    if ("likes" in e || "retweets" in e) {
      if (e.likes) bits.push(fmtCount(e.likes) + " 赞");
      if (e.retweets) bits.push(fmtCount(e.retweets) + " 转");
    } else if ("points" in e) {
      bits.push(fmtCount(e.points) + " 点");
      if (e.comments) bits.push(fmtCount(e.comments) + " 评");
    }
    if (!bits.length) return "";
    const t = bits.join(" · ");
    return `<span class="eng" title="${esc(t)}">${esc(t)}</span>`;
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(function () { el.classList.add("is-on"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("is-on");
      setTimeout(function () { el.hidden = true; }, 320);
    }, 2500);
  }

  async function shareView() {
    writeHash();
    const url = location.href;
    const title = "观澜 · 人工智能资讯";
    try {
      if (navigator.share && (navigator.maxTouchPoints > 0 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || ""))) {
        await navigator.share({ title: title, url: url });
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      toast("链接已复制，筛选与排列方式已包含");
    } catch (e) {
      toast("复制失败，请手动复制地址栏中的链接");
    }
  }

  function watchSectionHTML() {
    const w = state.watches || emptyWatches();
    const chips = [];
    w.keywords.forEach((k) => {
      chips.push(
        `<span class="chip" aria-pressed="true"><span>${esc(k)}</span>` +
        `<button type="button" class="x" data-watch-del="kw" data-id="${esc(k)}" aria-label="取消关注 ${esc(k)}">×</button></span>`
      );
    });
    w.tags.forEach((t) => {
      const name = nameOf(t.group, t.id);
      chips.push(
        `<span class="chip" aria-pressed="true"><span>${esc(name)}</span>` +
        `<button type="button" class="x" data-watch-del="tag" data-group="${esc(t.group)}" data-id="${esc(t.id)}" aria-label="取消关注 ${esc(name)}">×</button></span>`
      );
    });
    const hasFilters = state.models.length + state.topics.length + state.types.length +
      state.platforms.length + state.sources.length;
    const denied = notifySupported() && Notification.permission === "denied";
    const notifyOn = !!(state.notify && notifySupported() && Notification.permission === "granted");
    const canNotify = notifySupported() && !denied;
    return `
      <section class="fg">
        <div class="fg-title">我的关注</div>
        <form class="watch-add" id="watch-form">
          <input id="watch-input" type="text" maxlength="40" placeholder="添加关键词，如 GPT" autocomplete="off" />
          <button type="submit">添加</button>
        </form>
        ${chips.length ? `<div class="watch-chips">${chips.join("")}</div>` : `<p class="watch-empty">添加后，相符的资讯会高亮，也可只看这些条目。</p>`}
        ${hasFilters ? `<button type="button" class="watch-action" data-watch-from-filters>将当前已选标签加入关注</button>` : ""}
        ${canNotify ? `<button type="button" class="auto-zh notify-row" id="btn-notify" aria-pressed="${notifyOn ? "true" : "false"}">
          <span class="switch" aria-hidden="true"><i></i></span>
          有新资讯时通知我
        </button>
        <p class="fg-hint">仅在打开本页时检查，通知在本机发出，不经过服务器。</p>` : (denied ? `<p class="fg-hint">浏览器已关闭通知，可在站点设置里重新允许。</p>` : "")}
      </section>
    `;
  }


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
    const hasParams = !!(raw && (raw.includes("=") || raw.includes("&") || raw.length));
    if (q.has("o")) {
      state.sort = validSort(q.get("o"));
      saveSort(state.sort);
    } else if (!hasParams) {
      state.sort = loadSort();
    } else {
      state.sort = "newest";
    }
    state.fav = q.get("star") === "1";
    state.unread = q.get("u") === "1";
    state.watchOnly = q.get("w") === "1";
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
    if (state.unread) q.set("u", "1");
    if (state.watchOnly) q.set("w", "1");
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
    const zh = cachedZh(item);
    const hay = (
      item.title + " " + (item.excerpt || "") + " " + item.source_name +
      (zh ? " " + zh.title + " " + (zh.excerpt || "") : "")
    ).toLowerCase();
    return q.split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  }

  function orHas(sel, vals) {
    if (!sel.length) return true;
    return vals.some((v) => sel.includes(v));
  }

  function passFilters(item, skip) {
    if (state.fav && !state.favs.has(item.id)) return false;
    if (state.unread && state.read.has(item.id)) return false;
    if (state.watchOnly && !isWatched(item)) return false;
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
      (state.fav ? 1 : 0) +
      (state.unread ? 1 : 0) +
      (state.watchOnly ? 1 : 0)
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
    state.fav = false;
    state.unread = false;
    state.watchOnly = false;
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
    if (group === "unread") return "只看未读";
    if (group === "watch") return "我的关注";
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

    const seg = (key, options, cls) => {
      const buttons = options.map(([id, label]) => {
        let on;
        if (key === "unreadMode") on = (state.unread ? "unread" : "all") === id;
        else on = state[key] === id;
        return `<button type="button" data-seg="${key}" data-id="${esc(id)}" aria-pressed="${on}">${esc(label)}</button>`;
      }).join("");
      return `<div class="seg${cls ? " " + cls : ""}" role="group">${buttons}</div>`;
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

    const keepWatch = (() => {
      const el = els.filterBody.querySelector("#watch-input");
      return {
        value: el ? el.value : "",
        focus: document.activeElement && document.activeElement.id === "watch-input",
        start: el && document.activeElement === el ? el.selectionStart : null,
        end: el && document.activeElement === el ? el.selectionEnd : null,
      };
    })();

    els.filterBody.innerHTML = `
      <section class="fg">
        <div class="fg-title">时间</div>
        ${seg("range", [["1d", "今天"], ["7d", "近 7 天"], ["30d", "近 30 天"], ["all", "全部"]])}
      </section>
      <section class="fg">
        <div class="fg-title">排列方式</div>
        ${seg("sort", [["newest", "最新"], ["oldest", "最早"], ["heat", "热度"], ["source", "来源"]], "is-quad")}
        <p class="fg-hint">「热度」按发布时间衰减（约 36 小时减半），实验室与官方来源权重更高；推特计入赞、转帖与引用，Hacker News 计入点数，均为抓取时的真实数据，没有互动的条目不加这项分数。</p>
      </section>
      <section class="fg">
        <div class="fg-title">阅读</div>
        ${seg("unreadMode", [["all", "全部"], ["unread", "只看未读"]])}
      </section>
      ${watchSectionHTML()}
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

    const wi = els.filterBody.querySelector("#watch-input");
    if (wi) {
      wi.value = keepWatch.value;
      if (keepWatch.focus) {
        wi.focus();
        if (keepWatch.start != null) {
          try { wi.setSelectionRange(keepWatch.start, keepWatch.end); } catch (e) { /* ignore */ }
        }
      }
    }
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
    if (state.unread) chips.push({ group: "unread", id: "1", name: "只看未读" });
    if (state.watchOnly) chips.push({ group: "watch", id: "1", name: "我的关注" });

    const labels = { models: "模型", topics: "功能", types: "类型", platforms: "平台", sources: "来源", region: "地区", lang: "语言", range: "时间", q: "搜索", fav: "", unread: "", watch: "" };
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
    if (els.btnWatch) els.btnWatch.setAttribute("aria-pressed", state.watchOnly ? "true" : "false");
  }

  const EXT = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16l9-9M11 7h6v6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const TR_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18L8.2 6.5 12.4 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.6 13.5h5.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M15 7.5h6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M18 7.5c.15 3.6 1.9 6.2 3.2 8.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M15.2 13.2h6.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

  const zhMem = new Map();
  const zhPending = new Set();
  const zhQueue = [];
  let zhActive = 0;
  let zhFailStreak = 0;
  let zhNoteTimer = 0;

  function srcHash(item) {
    const s = (item.title || "") + "\n" + (item.excerpt || "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function isZhItem(item) {
    const lang = String(item.lang || "").toLowerCase();
    if (lang.startsWith("zh")) return true;
    const t = item.title || "";
    const cjk = (t.match(/[\u3400-\u9fff]/g) || []).length;
    const letters = (t.match(/[A-Za-z\u3400-\u9fff]/g) || []).length;
    return letters > 0 && cjk / letters >= 0.35;
  }

  function cachedZh(item) {
    if (!item) return null;
    const h = srcHash(item);
    const mem = zhMem.get(item.id);
    if (mem && mem.hash === h) return mem;
    if (item.title_zh) {
      const rec = { title: item.title_zh, excerpt: item.excerpt_zh || "", hash: h };
      zhMem.set(item.id, rec);
      return rec;
    }
    return null;
  }

  function loadZhMem() {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
      if (!Array.isArray(raw)) return;
      raw.forEach((row) => {
        if (row && row.id && row.t && row.h) {
          zhMem.set(row.id, { title: row.t, excerpt: row.e || "", hash: row.h });
        }
      });
    } catch (e) { /* ignore */ }
  }

  function saveZhMem() {
    try {
      const rows = [];
      zhMem.forEach((v, id) => { rows.push({ id, t: v.title, e: v.excerpt, h: v.hash }); });
      const slim = rows.length > 900 ? rows.slice(-900) : rows;
      localStorage.setItem(CACHE_KEY, JSON.stringify(slim));
    } catch (e) {
      try { localStorage.removeItem(CACHE_KEY); } catch (e2) { /* ignore */ }
    }
  }

  function loadAutoZh() {
    try { state.autoZh = localStorage.getItem(AUTO_KEY) === "1"; } catch (e) { state.autoZh = false; }
  }

  function saveAutoZh() {
    try { localStorage.setItem(AUTO_KEY, state.autoZh ? "1" : "0"); } catch (e) { /* ignore */ }
  }

  function shouldShowZh(item) {
    if (!item || isZhItem(item)) return false;
    if (state.hideZh.has(item.id)) return false;
    return state.autoZh || state.showZh.has(item.id);
  }

  function itemById(id) {
    const items = (state.data && state.data.items) || [];
    return items.find((x) => x.id === id);
  }

  function parseMtList(data, n) {
    if (!Array.isArray(data) || data.length < n) return null;
    const out = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (typeof row === "string") out.push(row);
      else if (Array.isArray(row) && typeof row[0] === "string") out.push(row[0]);
      else return null;
    }
    if (out.length < n) return null;
    return out.slice(0, n).map((s) => String(s).trim());
  }

  async function mtGoogle(parts) {
    const body = new URLSearchParams();
    parts.forEach((p) => body.append("q", p));
    const res = await fetch(
      "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=zh-CN",
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }
    );
    const ctype = res.headers.get("content-type") || "";
    if (!res.ok || !ctype.includes("json")) throw new Error("google");
    const data = await res.json();
    const out = parseMtList(data, parts.length);
    if (!out) throw new Error("google-parse");
    return out;
  }

  async function mtMemory(parts, lang) {
    const pair = (lang && lang !== "zh" ? lang : "Autodetect") + "|zh-CN";
    const out = [];
    for (const p of parts) {
      const url = "https://api.mymemory.translated.net/get?q=" +
        encodeURIComponent(p) + "&langpair=" + encodeURIComponent(pair);
      const res = await fetch(url);
      if (!res.ok) throw new Error("memory");
      const data = await res.json();
      const t = data && data.responseData && data.responseData.translatedText;
      if (!t || data.responseStatus !== 200) throw new Error("memory");
      if (/^MYMEMORY WARNING/i.test(t)) throw new Error("quota");
      out.push(String(t).trim());
    }
    return out;
  }

  async function translateParts(parts, lang) {
    try { return await mtGoogle(parts); } catch (e) { /* try fallback */ }
    return await mtMemory(parts, lang);
  }

  function enqueueZh(item) {
    if (!item || isZhItem(item) || cachedZh(item) || zhPending.has(item.id)) return;
    zhPending.add(item.id);
    zhQueue.push(item);
    paintCard(item.id);
    pumpZh();
  }

  function pumpZh() {
    while (zhActive < 2 && zhQueue.length) {
      const item = zhQueue.shift();
      zhActive++;
      runZh(item).finally(() => {
        zhActive--;
        pumpZh();
      });
    }
  }

  async function runZh(item) {
    const parts = [item.title || ""];
    if (item.excerpt) parts.push(item.excerpt);
    try {
      const got = await translateParts(parts, item.lang || "en");
      if (!got || !got[0]) throw new Error("empty");
      zhMem.set(item.id, {
        title: got[0],
        excerpt: item.excerpt ? (got[1] || "") : "",
        hash: srcHash(item),
      });
      saveZhMem();
      zhFailStreak = 0;
      showTrNote("");
    } catch (e) {
      zhFailStreak++;
      if (zhFailStreak >= 4) {
        showTrNote("翻译暂时不可用，请稍后再试。已译出的条目不受影响。");
      }
    }
    zhPending.delete(item.id);
    paintCard(item.id);
  }

  function showTrNote(msg) {
    const el = $("tr-note");
    if (!el) return;
    if (zhNoteTimer) clearTimeout(zhNoteTimer);
    if (!msg) { el.hidden = true; el.textContent = ""; return; }
    el.hidden = false;
    el.textContent = msg;
    zhNoteTimer = setTimeout(() => { el.hidden = true; }, 8000);
  }

  function paintCard(id) {
    const card = els.feed && els.feed.querySelector('.card[data-id="' + id + '"]');
    if (!card) return;
    const item = itemById(id);
    if (!item) return;
    const rec = cachedZh(item);
    const showing = shouldShowZh(item) && !!rec;
    const pending = zhPending.has(item.id) && !rec;
    const h2 = card.querySelector("h2");
    const h2a = h2 && h2.querySelector("a");
    const excerpt = card.querySelector(".excerpt");
    const btn = card.querySelector("[data-trans]");
    if (h2a) h2a.textContent = showing ? rec.title : item.title;
    if (excerpt) excerpt.textContent = showing ? (rec.excerpt || item.excerpt || "") : (item.excerpt || "");
    card.classList.toggle("is-translated", showing);
    let mark = h2 && h2.querySelector(".tr-mark");
    if (showing) {
      if (!mark && h2 && h2a) {
        mark = document.createElement("span");
        mark.className = "tr-mark";
        mark.textContent = "译文";
        h2.insertBefore(mark, h2a);
      }
    } else if (mark) {
      mark.remove();
    }
    if (btn) {
      btn.classList.toggle("is-busy", pending);
      btn.classList.remove("is-err");
      btn.setAttribute("aria-pressed", showing ? "true" : "false");
      const label = pending ? "翻译中" : (showing ? "查看原文" : "翻译");
      const lab = btn.querySelector(".tr-label");
      if (lab) lab.textContent = label;
      btn.setAttribute("aria-label", label);
    }
  }

  function scheduleVisibleTranslations() {
    if (!state.autoZh || !els.feed) return;
    const cards = els.feed.querySelectorAll(".card[data-id]");
    cards.forEach((card) => {
      const item = itemById(card.getAttribute("data-id"));
      if (!item || isZhItem(item) || state.hideZh.has(item.id)) return;
      if (!cachedZh(item)) enqueueZh(item);
    });
  }

  function onTransClick(id) {
    const item = itemById(id);
    if (!item || isZhItem(item)) return;
    const showing = shouldShowZh(item) && cachedZh(item);
    const pending = zhPending.has(item.id) && !cachedZh(item);
    if (showing || pending) {
      state.hideZh.add(id);
      state.showZh.delete(id);
      paintCard(id);
      return;
    }
    state.hideZh.delete(id);
    state.showZh.add(id);
    if (cachedZh(item)) {
      paintCard(id);
      return;
    }
    enqueueZh(item);
  }

  function setAutoZh(on) {
    state.autoZh = !!on;
    saveAutoZh();
    if (state.autoZh) state.hideZh = new Set();
    else {
      state.showZh = new Set();
      state.hideZh = new Set();
    }
    if (els.btnAuto) els.btnAuto.setAttribute("aria-pressed", state.autoZh ? "true" : "false");
    if (state.data) renderFeed();
  }

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
    const chinese = isZhItem(item);
    const rec = chinese ? null : cachedZh(item);
    const showing = !chinese && shouldShowZh(item) && !!rec;
    const pending = !chinese && zhPending.has(item.id) && !rec;
    const title = showing ? rec.title : item.title;
    const excerpt = showing ? (rec.excerpt || item.excerpt || "") : (item.excerpt || "");
    let transBtn = "";
    if (!chinese) {
      const label = pending ? "翻译中" : (showing ? "查看原文" : "翻译");
      transBtn = `<button type="button" class="tr-btn${pending ? " is-busy" : ""}" data-trans="${esc(item.id)}" aria-pressed="${showing ? "true" : "false"}" aria-label="${esc(label)}">${TR_ICON}<span class="tr-label">${esc(label)}</span></button>`;
    }
    const mark = showing ? `<span class="tr-mark">译文</span>` : "";
    const watched = isWatchedConfigured() && isWatched(item);
    const read = state.read.has(item.id);
    const watchMark = watched ? `<span class="watch-mark">关注</span>` : "";
    const cls = "card" + (showing ? " is-translated" : "") + (read ? " is-read" : "") + (watched ? " is-watched" : "");
    const readBtn = read
      ? `<button type="button" class="read-tag" data-toggle-read="${esc(item.id)}" aria-label="标为未读" title="标为未读">已读</button>`
      : "";
    return `
      <article class="${cls}" data-id="${esc(item.id)}">
        <div class="card-top">
          <a class="source" href="${esc(item.source_home || item.url)}" target="_blank" rel="noopener noreferrer">
            <span class="dot" style="background:${color}"></span>${esc(item.source_name)}
          </a>
          <time datetime="${esc(item.published)}" title="${esc(fmtFull(item.published))}">${esc(relTime(item.published))}</time>
          ${engHTML(item)}${readBtn}
          <button type="button" class="star" data-star="${esc(item.id)}" aria-pressed="${starred}" aria-label="${starred ? "取消收藏" : "收藏"}">${STAR}</button>
        </div>
        <h2>${watchMark}${mark}<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a></h2>
        ${excerpt ? `<p class="excerpt">${esc(excerpt)}</p>` : ""}
        <div class="card-foot">
          <ul class="tags">${tagButtons(item)}</ul>
          <div class="card-acts">${transBtn}<a class="orig" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">原文 ${EXT}</a></div>
        </div>
      </article>`;
  }

  function renderFeed() {
    let items = filtered();
    if (state.sort === "oldest") {
      items = items.slice().sort((a, b) => {
        const d = new Date(a.published) - new Date(b.published);
        return d !== 0 ? d : (a.id < b.id ? -1 : 1);
      });
    } else if (state.sort === "heat") {
      items = items.slice().sort((a, b) => {
        const d = heatScore(b) - heatScore(a);
        return d !== 0 ? d : (new Date(b.published) - new Date(a.published));
      });
    } else if (state.sort !== "source") {
      items = items.slice().sort((a, b) => {
        const d = new Date(b.published) - new Date(a.published);
        return d !== 0 ? d : (a.id < b.id ? -1 : 1);
      });
    }
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
    let countLabel = `共 <em>${n}</em> 条资讯`;
    if (state.fav && state.watchOnly && state.unread) countLabel = `关注且收藏的未读 <em>${n}</em> 条`;
    else if (state.fav && state.unread) countLabel = `收藏中的未读 <em>${n}</em> 条`;
    else if (state.watchOnly && state.unread) countLabel = `关注中的未读 <em>${n}</em> 条`;
    else if (state.fav) countLabel = `收藏中的 <em>${n}</em> 条`;
    else if (state.watchOnly) countLabel = `关注中的 <em>${n}</em> 条`;
    else if (state.unread) countLabel = `未读 <em>${n}</em> 条`;
    else if (state.sort === "heat") countLabel = `按热度排列，共 <em>${n}</em> 条`;
    els.count.innerHTML = countLabel;
    updateReadAllBtn();

    if (!n) {
      els.feed.innerHTML = "";
      els.empty.hidden = false;
      let emptyHead = "这一段里还没有符合条件的资讯";
      let emptyBody = "换一组标签，或把时间范围放宽一些。";
      if (state.fav && activeCount() === 1) {
        emptyHead = "还没有收藏";
        emptyBody = "在资讯卡片右上角点星标，即可在这里找到它。";
      } else if (state.watchOnly && !isWatchedConfigured()) {
        emptyHead = "还没有关注";
        emptyBody = "在筛选栏的「我的关注」里添加关键词或标签。";
      } else if (state.watchOnly) {
        emptyHead = "暂无符合关注的资讯";
        emptyBody = "试试添加更多关键词，或把时间范围放宽一些。";
      } else if (state.unread) {
        emptyHead = "这一段里的资讯都已读过了";
        emptyBody = "关闭「只看未读」，或换一组筛选条件。";
      }
      els.empty.querySelector("h2").textContent = emptyHead;
      els.empty.querySelector("p").textContent = emptyBody;
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
      scheduleVisibleTranslations();
      return;
    }

    let html = "";
    let lastDay = "";
    const slice = items.slice(0, state.limit);
    const byHeat = state.sort === "heat";
    slice.forEach((it) => {
      if (!byHeat) {
        const day = shanghaiDate(it.published);
        if (day !== lastDay) {
          lastDay = day;
          const lb = dayLabel(day);
          html += `<div class="day"><h2>${esc(lb.main)}</h2>${lb.sub ? `<span class="sub">${esc(lb.sub)}</span>` : ""}</div>`;
        }
      }
      html += cardHTML(it);
    });
    els.feed.innerHTML = html + moreBtn(n - slice.length);
    scheduleVisibleTranslations();
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
      <p>列表可按最新、最早、热度或来源排列。「热度」综合时效与来源权重：刚发布的条目更高，约 36 小时衰减一半，实验室与官方来源权重大于一般媒体；推特计入赞、转帖与引用，Hacker News 计入点数，均为抓取时的真实数据，没有互动数据的条目不加这项分数。排列方式会写进地址栏，便于分享。</p>
      <p>打开原文后该条会标为已读，可筛选「只看未读」。可添加关键词或标签作为「我的关注」，相符的条目会高亮，也可只看这些资讯；若允许通知，打开本页时如有符合的新资讯会在本机提醒。已读、关注与收藏都保存在本机浏览器中，不会上传。点「分享」可复制当前筛选与排列的链接。</p>
      <p>外文资讯可译为简体中文：每张卡片上有「翻译」，也可打开列表上方的「自动翻译」。默认先显示原文，译文由机器生成，仅供阅读参考，内容以原文为准。中文条目无需翻译。</p>
      <p>最近更新：${esc(fmtFull(data.updated_at))}（北京时间）。窗口约为最近 ${data.window_days || 30} 天，当前 ${data.item_count} 条。</p>
      <h3>实验室与官方</h3>
      ${list(official)}
      <h3>媒体与其他来源</h3>
      ${list(media)}
      <p style="margin-top:22px;color:var(--faint);font-size:12.5px;">资讯来自各来源的公开订阅，标题与摘要默认保留原文，版权归原作者。本站只做整理与筛选，不代表各来源立场。译文由机器生成，仅供阅读参考。</p>
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
    if (group === "unread") { state.unread = false; return; }
    if (group === "watch") { state.watchOnly = false; return; }
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

    els.filterBody.addEventListener("submit", (e) => {
      if (e.target && e.target.id === "watch-form") {
        e.preventDefault();
        const input = $("watch-input");
        addWatchKeyword(input ? input.value : "");
        if (input) input.value = "";
      }
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
        const id = seg.getAttribute("data-id");
        if (key === "unreadMode") {
          state.unread = id === "unread";
        } else {
          state[key] = id;
          if (key === "sort") saveSort(validSort(id));
        }
        update();
        return;
      }
      const watchDel = e.target.closest("[data-watch-del]");
      if (watchDel) {
        removeWatch(watchDel.getAttribute("data-watch-del"), watchDel.getAttribute("data-id"), watchDel.getAttribute("data-group"));
        return;
      }
      if (e.target.closest("[data-watch-from-filters]")) {
        addWatchesFromFilters();
        return;
      }
      if (e.target.closest("#btn-notify")) {
        setNotify(!state.notify || Notification.permission !== "granted");
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

    const markOpen = (e) => {
      const open = e.target.closest("h2 a, a.orig");
      if (!open) return;
      const card = open.closest(".card");
      if (card) markRead(card.getAttribute("data-id"), true);
    };
    els.feed.addEventListener("click", (e) => {
      if (e.target.closest("#btn-more")) {
        state.limit += PAGE;
        renderFeed();
        return;
      }
      const tog = e.target.closest("[data-toggle-read]");
      if (tog) {
        const id = tog.getAttribute("data-toggle-read");
        markRead(id, !state.read.has(id));
        return;
      }
      markOpen(e);
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
      const tr = e.target.closest("[data-trans]");
      if (tr) {
        onTransClick(tr.getAttribute("data-trans"));
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

    els.feed.addEventListener("auxclick", (e) => { if (e.button === 1) markOpen(e); });

    els.btnFav.addEventListener("click", () => { state.fav = !state.fav; update(); });
    if (els.btnWatch) {
      els.btnWatch.addEventListener("click", () => {
        if (!state.watchOnly && !isWatchedConfigured()) {
          toast("请先在筛选里添加关注的关键词或标签");
          const input = els.filterBody && els.filterBody.querySelector("#watch-input");
          if (els.btnFilter && window.matchMedia && window.matchMedia("(max-width: 860px)").matches) {
            els.btnFilter.click();
          }
          if (input) input.focus();
          return;
        }
        state.watchOnly = !state.watchOnly;
        update();
      });
    }
    if (els.btnShare) els.btnShare.addEventListener("click", () => { shareView(); });
    if (els.btnReadAll) els.btnReadAll.addEventListener("click", () => { markFilteredRead(); });
    document.querySelectorAll("[data-density]").forEach((b) => {
      b.addEventListener("click", () => setDensity(b.getAttribute("data-density")));
    });
    if (els.btnAuto) {
      els.btnAuto.addEventListener("click", () => setAutoZh(!state.autoZh));
    }
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
    els.btnWatch = $("btn-watch");
    els.btnShare = $("btn-share");
    els.btnReadAll = $("btn-read-all");
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
    els.btnAuto = $("btn-auto-zh");

    loadFavs();
    loadRead();
    loadWatches();
    loadNotify();
    loadDensity();
    applyDensity();
    loadZhMem();
    loadAutoZh();
    if (els.btnAuto) els.btnAuto.setAttribute("aria-pressed", state.autoZh ? "true" : "false");
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
    pruneRead();
    update();
    maybeNotify();
  }

  window.addEventListener("hashchange", () => {
    parseHash();
    if (els.q) els.q.value = state.q;
    if (state.data) update();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main);
  else main();
})();
