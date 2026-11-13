// Art Studio — YouTube playlist sync. Run on https://www.youtube.com/playlist?list=<id>
// Set window.__artCfg = { folder: 'Nagyon hasznos', maxRemove: 80 } first. Returns at once; progress is in window.__art.
// 1. scrolls the playlist and collects every video  2. a "Send to Art Studio" button appears (needs one real click: it opens the relay)
// 3. sends the videos (the app fetches thumbnails itself)  4. removes from the playlist the videos Dávid already judged in the app.
(() => {
  const CFG = window.__artCfg || {};
  const FOLDER = CFG.folder || 'Playlist';
  const MAX_REMOVE = CFG.maxRemove || 80;
  const DRY = !!CFG.dryRun;
  const ORIGIN = 'https://davidale-ship-it.github.io';
  const BRIDGE = ORIGIN + '/studio/bridge.html';
  const A = window.__art = { state: 'collecting', folder: FOLDER, found: 0, added: 0, toRemove: 0, removed: 0, errors: [] };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const vids = new Map();
  const rows = () => [...document.querySelectorAll('ytd-playlist-video-renderer')];
  const idOf = r => { const a = r.querySelector('a#video-title'); const m = a && (a.href || '').match(/[?&]v=([\w-]{11})/); return m ? m[1] : ''; };
  const grab = () => rows().forEach(r => {
    const id = idOf(r); if (!id) return;
    const a = r.querySelector('a#video-title');
    const ch = r.querySelector('ytd-channel-name a, #channel-name a');
    vids.set(id, { code: id, caption: ((a.getAttribute('title') || a.textContent || '').trim() + (ch ? ' — ' + ch.textContent.trim() : '')).slice(0, 300) });
  });
  async function collect() {
    // the grid only keeps ~30 posts on the page, so walk down one screen at a time and note each one
    let stuck = 0;
    for (let i = 0; i < 2000 && stuck < 6; i++) {
      grab(); A.found = vids.size;
      const before = window.scrollY;
      window.scrollBy(0, Math.round(innerHeight * 0.8)); await sleep(900); grab();
      const atEnd = window.scrollY + innerHeight >= document.documentElement.scrollHeight - 5;
      if (window.scrollY === before || atEnd) { stuck++; await sleep(900); } else stuck = 0;
    }
    window.scrollTo(0, 0); A.found = vids.size;
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
    win.postMessage({ type: 'art-import', id, source: 'yt', folder: FOLDER, items }, ORIGIN);
    setTimeout(() => { if (waiters[id]) { delete waiters[id]; rej(new Error('relay timeout')); } }, 150000);
  });
  async function removeOne(id) {
    const r = rows().find(x => idOf(x) === id);
    if (!r) throw new Error('not on page ' + id);
    r.scrollIntoView({ block: 'center' }); await sleep(400);
    const btn = r.querySelector('#menu button, ytd-menu-renderer button');
    if (!btn) throw new Error('no menu ' + id);
    btn.click(); await sleep(700);
    const item = [...document.querySelectorAll('ytd-popup-container ytd-menu-service-item-renderer')]
      .find(x => x.offsetParent !== null && /^\s*(Remove from|Eltávolítás)/i.test(x.textContent));
    if (!item) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); throw new Error('no remove option ' + id); }
    item.click(); await sleep(1100);
  }
  async function run() {
    A.state = 'sending';
    win = window.open(BRIDGE, 'artbridge', 'popup,width=440,height=320');
    if (!win) throw new Error('popup blocked');
    await new Promise((res, rej) => { ready = res; setTimeout(() => rej(new Error('relay did not open')), 30000); });
    const all = [...vids.values()]; let remove = [];
    for (let i = 0; i < all.length; i += 100) { const r = await send(all.slice(i, i + 100)); A.added += r.added || 0; remove = remove.concat(r.remove || []); }
    try { win.close(); } catch (e) {}
    A.state = 'removing'; A.toRemove = remove.length; A.removeCodes = remove.slice(0, MAX_REMOVE);
    if (!DRY) for (const id of A.removeCodes) {
      try { await removeOne(id); A.removed++; } catch (e) { A.errors.push(e.message); if (!A.removed && A.errors.length >= 3) break; }
      await sleep(600 + Math.random() * 600);
    }
    A.state = 'done';
  }
  const btn = document.createElement('button');
  btn.id = 'art-sync-btn'; btn.textContent = 'Send to Art Studio · ' + FOLDER;
  Object.assign(btn.style, { position: 'fixed', top: '70px', right: '14px', zIndex: '2147483647', padding: '14px 22px', font: '600 16px system-ui,sans-serif',
    background: '#f0997b', color: '#1b1b1f', border: '0', borderRadius: '999px', cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,.4)' });
  btn.onclick = () => {
    btn.disabled = true; btn.textContent = 'Syncing ' + FOLDER + '…';
    run().catch(e => { A.state = 'error'; A.errors.push(String(e.message || e)); try { win && win.close(); } catch (x) {} })
      .finally(() => btn.remove());
  };
  collect().then(() => { A.state = 'ready'; document.body.appendChild(btn); });
  return 'collecting';
})();
