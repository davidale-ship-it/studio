// Art Studio — Instagram saved-folder sync. Run on https://www.instagram.com/<user>/saved/<folder>/<id>/
// Set window.__artCfg = { folder: 'Art Inspiration', maxRemove: 60 } first. Returns at once; progress is in window.__art.
// 1. scrolls the folder and collects every post  2. a "Send to Art Studio" button appears (needs one real click: it opens the relay)
// 3. sends the posts (+ pictures only for the ones the app has no picture of)  4. unsaves the posts Dávid already judged in the app.
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
    let stuck = 0;
    for (let i = 0; i < 2000 && stuck < 6; i++) {
      grab(); A.found = tiles.size;
      const before = window.scrollY;
      window.scrollBy(0, Math.round(innerHeight * 0.8)); await sleep(650); grab();
      const atEnd = window.scrollY + innerHeight >= document.documentElement.scrollHeight - 5;
      if (window.scrollY === before || atEnd) { stuck++; await sleep(900); } else stuck = 0;
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
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const pk = code => { let n = 0n; for (const ch of code.slice(0, 11)) n = n * 64n + BigInt(ALPHA.indexOf(ch)); return n.toString(); };
  const csrf = () => (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '';
  async function unsave(code) {
    const r = await fetch('/api/v1/web/save/' + pk(code) + '/unsave/', {
      method: 'POST', credentials: 'include', body: '',
      headers: { 'x-csrftoken': csrf(), 'x-ig-app-id': '936619743392459', 'x-requested-with': 'XMLHttpRequest', 'content-type': 'application/x-www-form-urlencoded' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.status !== 'ok') throw new Error('unsave ' + code + ' failed (' + r.status + ')');
  }
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
    A.state = 'removing'; A.toRemove = remove.length; A.removeCodes = remove.slice(0, MAX_REMOVE);
    if (!DRY) for (const code of A.removeCodes) {
      try { await unsave(code); A.removed++; } catch (e) { A.errors.push(e.message); if (!A.removed && A.errors.length >= 3) break; }
      await sleep(2500 + Math.random() * 2000);
    }
    A.state = 'done';
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
