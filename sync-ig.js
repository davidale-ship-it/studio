// Art Studio — Instagram saved-folder sync. Run on https://www.instagram.com/<user>/saved/<folder>/<id>/
// Set window.__artCfg = { folder: 'Art Inspiration', maxRemove: 60 } first. Returns at once; progress is in window.__art.
// 1. scrolls the folder and collects every post  2. a "Send to Art Studio" button appears (needs one real click: it opens the relay)
// 3. sends the posts (+ pictures only for the ones the app has no picture of)
// 4. state 'click-to-remove': unsave the posts Dávid already judged — the agent clicks, see __artStep below.
(() => {
  const CFG = window.__artCfg || {};
  const FOLDER = CFG.folder || 'Saved';
  const MAX_REMOVE = CFG.maxRemove || 100;
  const DRY = !!CFG.dryRun;
  const ORIGIN = 'https://davidale-ship-it.github.io';
  const BRIDGE = ORIGIN + '/studio/bridge.html';
  const A = window.__art = { state: 'collecting', folder: FOLDER, found: 0, added: 0, pictures: 0, toRemove: 0, removed: 0, errors: [] };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const tiles = new Map();
  const grab = () => document.querySelectorAll('main a[href*="/p/"], main a[href*="/reel/"]').forEach(a => {
    const m = (a.getAttribute('href') || '').match(/\/(p|reel)\/([\w-]+)/); if (!m) return;
    const t = tiles.get(m[2]) || { code: m[2], type: m[1] };
    const img = a.querySelector('img');
    if (img && (img.currentSrc || img.src)) { t.src = img.currentSrc || img.src; t.caption = (img.alt || '').slice(0, 700); }
    tiles.set(m[2], t);
  });
  async function collect() {
    // the grid only keeps ~30 posts on the page, so walk down one screen at a time and note each one
    let stuck = 0, lastH = 0;
    for (let i = 0; i < 3000 && stuck < 8; i++) {
      grab(); A.found = tiles.size;
      const before = window.scrollY;
      window.scrollBy(0, Math.round(innerHeight * 0.8)); await sleep(650); grab();
      const atEnd = window.scrollY + innerHeight >= document.documentElement.scrollHeight - 5;
      const h = document.documentElement.scrollHeight;
      // at the bottom: only finish once the page has stopped growing for ~15 s (more posts load slowly in a background tab)
      if (window.scrollY === before || atEnd) { if (h === lastH) stuck++; else stuck = 0; lastH = h; await sleep(1500); }
      else { stuck = 0; lastH = h; }
    }
    window.scrollTo(0, 0); A.found = tiles.size;
  }
  async function pic(t) {
    const b = await (await fetch(t.src)).blob();
    const bmp = await createImageBitmap(b);
    const k = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const jpg = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.84));
    const u = new Uint8Array(await jpg.arrayBuffer()); let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  let win = null, ready = null, seq = 0; const waiters = {};
  addEventListener('message', e => {
    if (e.origin !== ORIGIN || !e.data) return;
    if (e.data.type === 'art-ready' && ready) ready();
    if (e.data.type === 'art-result' && waiters[e.data.id]) { waiters[e.data.id](e.data); delete waiters[e.data.id]; }
  });
  const send = items => new Promise((res, rej) => {
    const id = ++seq;
    waiters[id] = d => d.ok ? res(d) : rej(new Error(d.error));
    win.postMessage({ type: 'art-import', id, source: 'ig', folder: FOLDER, items }, ORIGIN);
    setTimeout(() => { if (waiters[id]) { delete waiters[id]; rej(new Error('relay timeout')); } }, 150000);
  });
  // ---- removal: Instagram only accepts a real click on its bookmark. The script opens each judged post and lines it up;
  // the agent clicks the same screen point each time and calls __artStep() again. A transparent shield catches clicks
  // whenever the bookmark is NOT exactly under that point, so a click can never land on anything else.
  const R = { list: [], i: -1, done: 0, skipped: 0, point: null, cur: null };
  const shield = document.createElement('div');
  shield.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:transparent';
  const icon = re => [...document.querySelectorAll('[role=dialog] svg[aria-label]')].find(s => re.test(s.getAttribute('aria-label')));
  const savedIcon = () => icon(/^(Remove|Eltávolítás)$/), unsavedIcon = () => icon(/^(Save|Mentés)$/);
  // close the post pop-up the way a person would (Escape, then its ✕). Never "back": Instagram sometimes jumps a page too far.
  async function closePost() {
    for (let k = 0; k < 3 && document.querySelector('[role=dialog]'); k++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      await sleep(900);
      if (!document.querySelector('[role=dialog]')) break;
      const s = [...document.querySelectorAll('svg[aria-label]')].find(x => /^(Bezárás|Close)$/.test(x.getAttribute('aria-label')));
      const b = s && s.closest('[role=button],button'); if (b) { b.click(); await sleep(900); }
    }
  }
  async function openPost(code) {
    const find = () => document.querySelector('main a[href*="/' + code + '/"]');
    let a = find();
    if (!a) { window.scrollTo(0, 0); await sleep(700); a = find(); }
    for (let k = 0; k < 800 && !a; k++) { const y = window.scrollY; window.scrollBy(0, Math.round(innerHeight * 0.8)); await sleep(450); a = find(); if (!a && window.scrollY === y) { await sleep(1500); a = find(); if (!a && window.scrollY === y) break; } }
    if (!a) return false;
    a.scrollIntoView({ block: 'center' }); await sleep(300); a.click();
    for (let k = 0; k < 30; k++) { await sleep(300); if (savedIcon() || unsavedIcon()) return true; }
    return false;
  }
  window.__artStep = async () => {
    if (R.cur) {
      // inside a folder Instagram asks "remove from collection / remove from saved?" — remove from saved (Dávid wants the folders wiped)
      for (let k = 0; k < 12; k++) {
        await sleep(300);
        const c = [...document.querySelectorAll('[role=dialog] button')].find(x => /^(Eltávolítás|Remove|Unsave)$/.test(x.textContent.trim()));
        if (c) { c.click(); break; }
        if (unsavedIcon() && !savedIcon()) break;
      }
      await sleep(1000);
      if (unsavedIcon() && !savedIcon()) R.done++; else R.skipped++;
      R.cur = null; A.removed = R.done;
    }
    shield.remove(); await closePost();
    while (++R.i < R.list.length) {
      const code = R.list[R.i];
      if (!(await openPost(code))) { R.skipped++; continue; }
      const s = savedIcon();
      if (!s) { R.done++; A.removed = R.done; await closePost(); continue; }   // already not saved
      const b = s.closest('[role=button],button'), r = b.getBoundingClientRect();
      if (!R.point) R.point = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      let hit = document.elementFromPoint(R.point.x, R.point.y);
      if (!(hit && b.contains(hit))) {
        // photos and videos lay the post out differently: nudge the pop-up so the bookmark sits under the same point
        const dlg = b.closest('[role=dialog]');
        if (dlg) { dlg.style.transform = 'translate(' + (R.point.x - (r.x + r.width / 2)) + 'px,' + (R.point.y - (r.y + r.height / 2)) + 'px)'; await sleep(150); }
        hit = document.elementFromPoint(R.point.x, R.point.y);
      }
      if (hit && b.contains(hit)) { R.cur = code; return { ready: true, x: R.point.x, y: R.point.y, viewportWidth: innerWidth, left: R.list.length - R.i - 1, removed: R.done }; }
      R.skipped++; await closePost();
    }
    document.body.appendChild(shield);
    A.state = 'done';
    return { ready: false, removed: R.done, skipped: R.skipped, x: R.point ? R.point.x : 0, y: R.point ? R.point.y : 0, viewportWidth: innerWidth };
  };
  window.__artRemove = codes => { R.list = codes.slice(0, MAX_REMOVE); R.i = -1; R.cur = null; R.done = 0; R.skipped = 0; A.state = 'click-to-remove'; return R.list.length; };
  async function run() {
    A.state = 'sending';
    win = window.open(BRIDGE, 'artbridge', 'popup,width=440,height=320');
    if (!win) throw new Error('popup blocked');
    await new Promise((res, rej) => { ready = res; setTimeout(() => rej(new Error('relay did not open')), 30000); });
    const all = [...tiles.values()];
    const r1 = await send(all.map(t => ({ code: t.code, type: t.type, caption: t.caption || '' })));
    A.added = r1.added || 0;
    const need = new Set(r1.need || []), remove = r1.remove || [];
    A.state = 'pictures';
    const todo = all.filter(t => need.has(t.code) && t.src);
    A.picturesWanted = todo.length;
    const chunks = []; for (let i = 0; i < todo.length; i += 5) chunks.push(todo.slice(i, i + 5));
    let next = 0;
    const worker = async () => {   // three at a time
      while (next < chunks.length) {
        const ch = chunks[next++];
        const batch = (await Promise.all(ch.map(async t => {
          try { return { code: t.code, type: t.type, caption: t.caption || '', imageBase64: await pic(t), mimeType: 'image/jpeg' }; }
          catch (e) { if (A.errors.length < 50) A.errors.push('picture ' + t.code); return null; }
        }))).filter(Boolean);
        if (batch.length) { try { const r = await send(batch); A.pictures += r.pictures || 0; } catch (e) { if (A.errors.length < 50) A.errors.push(e.message); } }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    try { win.close(); } catch (e) {}
    A.toRemove = remove.length; A.removeCodes = remove.slice(0, MAX_REMOVE);
    R.list = DRY ? [] : A.removeCodes.slice();
    A.state = R.list.length ? 'click-to-remove' : 'done';   // the agent now calls __artStep() and clicks
  }
  const btn = document.createElement('button');
  btn.id = 'art-sync-btn'; btn.textContent = 'Send to Art Studio · ' + FOLDER;
  Object.assign(btn.style, { position: 'fixed', top: '14px', right: '14px', zIndex: '2147483647', padding: '14px 22px', font: '600 16px system-ui,sans-serif',
    background: '#f0997b', color: '#1b1b1f', border: '0', borderRadius: '999px', cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,.4)' });
  btn.onclick = () => {
    btn.disabled = true; btn.textContent = 'Syncing ' + FOLDER + '…';
    run().catch(e => { A.state = 'error'; A.errors.push(String(e.message || e)); try { win && win.close(); } catch (x) {} })
      .finally(() => btn.remove());
  };
  collect().then(() => { A.state = 'ready'; document.body.appendChild(btn); });
  return 'collecting';
})();
