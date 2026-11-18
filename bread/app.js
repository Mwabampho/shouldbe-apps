// Bread web app — screens and interaction. Ledger rules live in engine.js.
(function () {
  'use strict';
  const { Money, Bank, Validation, LocalStore, ACCOUNTS, ACCOUNT_TITLE, CATEGORIES, CARD_CATEGORIES, BILLERS, LIMITS, maskAccount, startOfDay } = window.BreadEngine;

  // ---------- storage helpers (never throw) ----------
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  const bank = new Bank(LocalStore('bread.ledger.v1'));
  const app = document.getElementById('app');
  const layer = document.getElementById('sheets');

  const ui = {
    screen: bank.hasProfile ? 'lock' : 'welcome',
    tab: 'home',
    sheets: [],            // stack of {type, f:{fields}, ...}
    hide: ls.get('bread.hideBalances') === '1',
    draft: { first: '', last: '', dob: '' },
    pin1: '', pinErr: null, code: '', expected: '', codeSecs: 30, codeErr: null,
    lockPin: '', lockErr: null, openErr: null, identityErr: null,
    modal: null            // {kind:'pin'|'confirm', ...}
  };

  // ---------- PIN (replaces Face ID / passcode on the web) ----------
  async function hashPin(pin, salt) {
    const data = new TextEncoder().encode(salt + ':' + pin);
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', data);
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 2166136261; for (const b of data) { h ^= b; h = Math.imul(h, 16777619) >>> 0; } return 'f' + h.toString(16);
  }
  async function setPin(pin) {
    const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
    ls.set('bread.pin', JSON.stringify({ salt, hash: await hashPin(pin, salt) }));
  }
  async function checkPin(pin) {
    try { const p = JSON.parse(ls.get('bread.pin') || 'null'); return !!p && p.hash === await hashPin(pin, p.salt); } catch (e) { return false; }
  }
  /** Ask for the PIN in a modal. Resolves true/false. */
  function requirePin(reason) {
    return new Promise(resolve => { ui.modal = { kind: 'pin', reason, value: '', err: null, resolve }; renderModal(); });
  }
  function confirmBox(title, message, button) {
    return new Promise(resolve => { ui.modal = { kind: 'confirm', title, message, button, resolve }; renderModal(); });
  }
  async function authorise(amount, reason) { return amount < LIMITS.largePayment ? true : requirePin(reason); }

  // ---------- small helpers ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDay = d => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const fmtDateTime = d => new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const initials = n => String(n).split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
  function relTime(d) {
    const s = Math.round((Date.now() - new Date(d)) / 1000);
    if (s < 60) return 'now';
    const m = Math.round(s / 60); if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60); if (h < 24) return h + ' hr ago';
    const days = Math.round(h / 24); return days === 1 ? 'yesterday' : days + ' days ago';
  }
  const top = () => ui.sheets[ui.sheets.length - 1];

  const P = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/>',
    swap: '<path d="M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7"/>',
    chart: '<path d="M3 20h18M6 16l4-5 4 3 5-7"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0"/>',
    user: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="10" r="3.2"/><path d="M6 18.5c1.5-2.5 3.6-3.5 6-3.5s4.5 1 6 3.5"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 7.6C3.9 9.4 2 12 2 12s3.6 6.5 10 6.5c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    up: '<path d="M7 17L17 7M9 7h8v8"/>',
    down: '<path d="M12 4v15M6 13l6 6 6-6"/>',
    doc: '<path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6"/>',
    tray: '<path d="M12 3v10M8 9l4 4 4-4M3 14h5l1.5 3h5L16 14h5v6H3z"/>',
    snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 2 3-2M9 20l3-2 3 2"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    wave: '<path d="M8 8a6 6 0 0 1 0 8M12 5a10 10 0 0 1 0 14M16 2a14 14 0 0 1 0 20"/>',
    chev: '<path d="M9 5l7 7-7 7"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    cart: '<path d="M3 4h2.5l2.2 11h10.6L20.5 8H7"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
    fork: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1-3 4-3 8h3"/>',
    car: '<path d="M4 16v-4l2-5h12l2 5v4zM4 16v2.5M20 16v2.5M4 12h16"/><circle cx="7.5" cy="14" r=".8"/><circle cx="16.5" cy="14" r=".8"/>',
    bag: '<path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
    play: '<circle cx="12" cy="12" r="9.5"/><path d="M10 8.5l5.5 3.5-5.5 3.5z"/>',
    dollar: '<circle cx="12" cy="12" r="9.5"/><path d="M15 9c-.5-1.2-1.6-1.8-3-1.8-1.8 0-3 .9-3 2.3 0 3.2 6 1.6 6 4.8 0 1.4-1.3 2.4-3 2.4-1.5 0-2.7-.7-3.1-2M12 5.5v13"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    drop: '<path d="M12 3s7 7.5 7 12a7 7 0 0 1-14 0c0-4.5 7-12 7-12z"/>',
    wifi: '<path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r="1"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    share: '<path d="M12 15V3M7.5 7.5L12 3l4.5 4.5M5 12v8h14v-8"/>',
    leaf: '<path d="M5 19C5 10 10 5 20 4c-1 10-6 15-15 15zM5 19l8-8"/>',
    people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.8-3.3 3.1-5 6-5s5.2 1.7 6 5M16 5.2a3 3 0 0 1 0 5.6M18 14c1.6.7 2.6 2.4 3 5"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
    id: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2.2"/><path d="M5 16c.8-1.6 2-2.3 3.5-2.3S11.2 14.4 12 16M14.5 10h4M14.5 13.5h4"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l2.5 2.5M14.5 8.5L17 11"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'
  };
  const icon = (n, cls) => '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (P[n] || '') + '</svg>';
  const CAT_ICON = { groceries: 'cart', dining: 'fork', transport: 'car', shopping: 'bag', subscriptions: 'play', bills: 'doc', transfers: 'swap', income: 'dollar', deposits: 'tray', payments: 'up', other: 'grid' };
  const BILL_ICON = { electricity: 'bolt', water: 'drop', internet: 'wifi', phone: 'phone', rent: 'home', insurance: 'shield' };
  const mark = size => '<span class="mark" style="width:' + size + 'px;height:' + size + 'px" aria-hidden="true"><i></i></span>';
  const goldBtn = (label, act, extra) => '<button class="gold-btn" data-act="' + act + '"' + (extra || '') + '>' + esc(label) + '</button>';
  const footer = text => '<p class="sec-foot">' + icon('lock') + '<span>' + text + '</span></p>';

  // =====================================================================
  // ONBOARDING
  // =====================================================================
  function headerRow(step, backAct) {
    return '<div class="hdr-row"><button class="icon-btn" data-act="' + backAct + '" aria-label="Back">' + icon('back') + '</button><span>' + step + '</span><span style="width:36px"></span></div>';
  }

  function viewWelcome() {
    return '<div class="welcome" data-act="toIntro" role="button" aria-label="Open Bread">' +
      '<div class="welcome-top">' + mark(86) + '<h1 class="brand">Bread</h1><p class="tag">More than money.<br>A brighter tomorrow.</p></div>' +
      '<div class="hero" style="background-image:url(hero.jpg)"></div>' +
      '<p class="small-cap">Secure Banking &nbsp;•&nbsp; Smarter Living</p>' +
      '<p class="tap-hint">Tap anywhere to begin</p></div>';
  }

  function viewIntro() {
    const tile = (ic, t, s) => '<div class="benefit"><span class="benefit-ic">' + icon(ic) + '</span><div><b>' + t + '</b><small>' + s + '</small></div></div>';
    return '<div class="screen center">' + '<div style="height:40px"></div>' + mark(72) +
      '<h1 class="brand" style="font-size:46px">Bread</h1><p class="tag">Banking that helps<br>you grow.</p>' +
      '<div class="stack">' + tile('lock', 'PIN-protected', 'Your own 4-digit Bread PIN.') + tile('leaf', 'Tools for a brighter you', 'Save, spend, grow with purpose.') + tile('people', 'Built for real life', 'Simple. Smart. Human.') + '</div>' +
      '<p class="demo-note">Demo bank: pretend money, saved only in this browser.</p>' +
      '<div class="grow"></div>' + goldBtn('Get Started', 'toIdentity') +
      '<p class="muted small" style="margin:12px 0 24px">Nothing you enter leaves this phone.</p></div>';
  }

  function viewIdentity() {
    const d = ui.draft;
    const max = new Date(); max.setFullYear(max.getFullYear() - 18);
    const min = new Date(); min.setFullYear(min.getFullYear() - 120);
    const iso = x => x.toISOString().slice(0, 10);
    return '<div class="screen">' + headerRow('Step 1 of 3', 'toIntro') +
      '<div class="center">' + '<span class="big-ic">' + icon('id') + '</span><h2>Identity Verification</h2><p class="muted">Tell us who is opening<br>this Bread account.</p></div>' +
      '<div class="stack">' +
      '<input class="field" data-draft="first" autocomplete="given-name" placeholder="First name" value="' + esc(d.first) + '">' +
      '<input class="field" data-draft="last" autocomplete="family-name" placeholder="Last name" value="' + esc(d.last) + '">' +
      '<label class="field date-field"><span>Date of birth</span><input type="date" data-draft="dob" min="' + iso(min) + '" max="' + iso(max) + '" value="' + esc(d.dob) + '"></label>' +
      '</div>' + (ui.identityErr ? '<p class="err center">' + esc(ui.identityErr) + '</p>' : '') +
      goldBtn('Continue', 'identityNext') + footer('Your details are stored only in this browser<br>on this phone.') + '</div>';
  }

  function pinDots(n, err) {
    let s = '<div class="pin-dots' + (err ? ' bad' : '') + '">';
    for (let i = 0; i < 4; i++) s += '<i class="' + (i < n ? 'on' : '') + '"></i>';
    return s + '</div>';
  }
  function keypad(target) {
    const k = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    return '<div class="keypad">' + k.map(x => x ? '<button data-act="key" data-arg="' + target + ':' + x + '" aria-label="' + (x === '⌫' ? 'Delete' : x) + '">' + x + '</button>' : '<span></span>').join('') + '</div>';
  }

  function viewPin() {
    const confirming = ui.pin1.length === 4;
    const cur = confirming ? ui.pin2 || '' : ui.pin1;
    return '<div class="screen center">' + (ui.changingPin ? headerRow('Change PIN', 'cancelPinChange') : headerRow('Step 2 of 3', 'toIdentity')) +
      '<span class="big-ic">' + icon('key') + '</span><h2>' + (confirming ? 'Confirm your PIN' : 'Create a Bread PIN') + '</h2>' +
      '<p class="muted">' + (confirming ? 'Enter the same 4 digits again.' : 'You\'ll use this to unlock Bread and<br>approve large payments.') + '</p>' +
      pinDots(cur.length, ui.pinErr) + (ui.pinErr ? '<p class="err">' + esc(ui.pinErr) + '</p>' : '<p class="err">&nbsp;</p>') +
      keypad('setup') + '<div class="grow"></div>' + footer('Your PIN is stored as a one-way hash<br>in this browser only.') + '</div>';
  }

  function viewCode() {
    const c = ui.code;
    let boxes = '';
    for (let i = 0; i < 6; i++) boxes += '<i class="' + (ui.codeErr ? 'bad' : '') + '">' + esc(c[i] || '') + '</i>';
    const disp = ui.expected.slice(0, 3) + ' ' + ui.expected.slice(3);
    return '<div class="screen center">' + headerRow('Step 3 of 3', 'toPin') +
      '<h2>Dynamic Security Check</h2><p class="muted">Type this code into the boxes below.<br>It is not sent by text — it is shown here.</p>' +
      '<div class="notif"><span class="notif-ic">' + mark(22) + '</span><div><b>Bread</b><small>Review</small><p>Your review code is: <strong class="code-big">' + disp + '</strong></p></div></div>' +
      '<label class="code-boxes">' + boxes + '<input id="codeInput" inputmode="numeric" autocomplete="one-time-code" maxlength="6" aria-label="Six digit security code" value="' + esc(c) + '"></label>' +
      '<p class="muted small">Code expires in <span id="codeSecs">' + ui.codeSecs + '</span> seconds</p>' +
      (ui.codeErr ? '<p class="err">' + esc(ui.codeErr) + '</p>' : '') +
            '<button class="ghost-btn" data-act="newCode">' + icon('refresh') + ' Generate New Review Code</button>' +
      '<div class="grow"></div>' + footer('Codes are generated on this phone<br>and expire after 30 seconds.') + '</div>';
  }

  function viewGranted() {
    return '<div class="screen center"><div class="grow"></div>' +
      '<div class="granted">' + icon('check') + '</div><h2>Access Granted</h2>' +
      '<p class="muted">Welcome to Bread' + (ui.draft.first ? ', ' + esc(ui.draft.first) : '') + '.</p>' +
      (ui.openErr ? '<p class="err">' + esc(ui.openErr) + '</p>' : '') +
      '<div style="height:24px"></div>' + goldBtn('Open My Accounts', 'openAccount') + '<div class="grow"></div>' +
      footer('This session used your Bread PIN<br>and a security code.') + '</div>';
  }

  function viewLock() {
    return '<div class="screen center"><div class="grow"></div>' + mark(86) +
      '<h2 style="margin-top:18px">Welcome back,<br>' + esc(bank.state.profile.firstName) + '</h2>' +
      '<p class="muted">Enter your PIN to unlock Bread.</p>' +
      pinDots(ui.lockPin.length, ui.lockErr) + '<p class="err">' + (ui.lockErr ? esc(ui.lockErr) : '&nbsp;') + '</p>' +
      keypad('lock') + '<div class="grow"></div>' +
      '<button class="link-btn" data-act="eraseFromLock">Not you? Remove Bread from this phone</button></div>';
  }

  // =====================================================================
  // MAIN TABS
  // =====================================================================
  function activityRow(tx, hidden) {
    const pos = tx.amount > 0;
    return '<button class="row" data-act="openTx" data-arg="' + tx.id + '">' +
      '<span class="row-ic ' + (pos ? 'pos' : '') + '">' + icon(CAT_ICON[tx.category] || 'grid') + '</span>' +
      '<span class="row-main"><b>' + esc(tx.title) + '</b><small>' + CATEGORIES[tx.category] + ' • ' + ACCOUNT_TITLE[tx.account] + '</small></span>' +
      '<span class="row-end"><b class="' + (pos ? 'pos' : '') + '">' + (hidden ? '••••' : Money.format(tx.amount, true)) + '</b><small>' + fmtDay(tx.date) + '</small></span></button>';
  }
  const empty = t => '<p class="empty">' + esc(t) + '</p>';
  function limitBar(title, used, limit) {
    const pct = Math.min(100, Math.round(used / Math.max(limit, 1) * 100));
    return '<div class="limit"><div class="limit-top"><span>' + title + '</span><b>' + Money.format(used) + ' of ' + Money.format(limit) + '</b></div><div class="bar"><i class="' + (used >= limit ? 'full' : '') + '" style="width:' + pct + '%"></i></div></div>';
  }

  function mountains() {
    return '<svg class="mountains" viewBox="0 0 400 175" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a140f"/><stop offset=".55" stop-color="#4d331c"/><stop offset="1" stop-color="#8c5c2b"/></linearGradient>' +
      '<radialGradient id="sun"><stop offset="0" stop-color="#fdd48c" stop-opacity=".5"/><stop offset="1" stop-color="#fdd48c" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset=".35" stop-color="#060504" stop-opacity="0"/><stop offset="1" stop-color="#060504"/></linearGradient></defs>' +
      '<rect width="400" height="175" fill="url(#sky)"/><circle cx="288" cy="108" r="60" fill="url(#sun)"/>' +
      '<path d="M0 175 L0 122 L67 91 L133 108 L200 70 L267 96 L333 82 L400 105 L400 175Z" fill="#33241a"/>' +
      '<path d="M0 175 L0 143 L67 119 L133 129 L200 101 L267 122 L333 112 L400 136 L400 175Z" fill="#1c140f"/>' +
      '<rect width="400" height="175" fill="url(#fade)"/></svg>';
  }

  function greeting() { const h = new Date().getHours(); return h >= 5 && h < 12 ? 'Good morning' : h < 17 && h >= 12 ? 'Good afternoon' : 'Good evening'; }

  function tabHome() {
    const s = bank.state, hide = ui.hide, unread = bank.unreadCount;
    const recent = bank.transactions.slice(0, 5);
    const qa = [['up', 'Send', 'send'], ['down', 'Receive', 'receive'], ['doc', 'Pay Bills', 'payBills'], ['tray', 'Deposit', 'deposit']];
    return '<div class="home-head">' + mountains() + '<div class="home-head-in">' +
      '<div class="topbar"><span class="logo-row">' + mark(28) + '<b>Bread</b></span><span class="grow"></span>' +
      '<button class="icon-btn" data-act="sheet" data-arg="notifications" aria-label="Notifications' + (unread ? ', ' + unread + ' unread' : '') + '">' + icon('bell') + (unread ? '<em class="badge">' + Math.min(unread, 9) + '</em>' : '') + '</button>' +
      '<button class="icon-btn gold" data-act="sheet" data-arg="profile" aria-label="Profile">' + icon('user') + '</button></div>' +
      '<h1 class="greet">' + greeting() + ',<br>' + esc(s.profile.firstName) + '.</h1><p class="tagline">A brighter tomorrow starts here.</p></div></div>' +
      '<div class="pad">' +
      '<div class="panel balance"><div><small class="muted">Total Balance</small><div class="big">' + (hide ? '••••••••' : Money.format(bank.totalBalance)) + '</div></div>' +
      '<button class="icon-btn gold" data-act="toggleHide" aria-label="' + (hide ? 'Show balances' : 'Hide balances') + '">' + icon(hide ? 'eyeOff' : 'eye') + '</button></div>' +
      '<div class="minis">' + s.accounts.map(a => '<div class="panel mini"><small>' + ACCOUNT_TITLE[a.id] + '</small><b>' + (hide ? '••••••' : Money.format(a.balance)) + '</b></div>').join('') + '</div>' +
      '<div class="quick">' + qa.map(q => '<button data-act="sheet" data-arg="' + q[2] + '"><span>' + icon(q[0]) + '</span>' + q[1] + '</button>').join('') + '</div>' +
      '<div class="sec-head"><b>Recent Activity</b><button class="link gold" data-act="sheet" data-arg="activity">See All</button></div>' +
      (recent.length ? recent.map(t => activityRow(t, hide)).join('') : empty('No activity yet. Add money to get started.')) +
      '</div>';
  }

  function goldCard(card, name) {
    return '<div class="gold-card' + (card.frozen ? ' frozen' : '') + '" role="img" aria-label="Bread debit card ending in ' + card.last4 + (card.frozen ? ', frozen' : '') + '">' +
      '<div class="gc-top">' + mark(29) + '<b>Bread</b><span class="grow"></span><em>DEBIT</em></div>' +
      '<div class="gc-bottom"><div><b>•••• ' + esc(card.last4) + '</b><small>' + esc(name.toUpperCase()) + '</small></div><span class="gc-brand">BREAD</span></div>' +
      (card.frozen ? '<div class="gc-frost">' + icon('snow') + ' Frozen</div>' : '') + '</div>';
  }
  const toggle = (on, act, label) => '<button class="toggle' + (on ? ' on' : '') + '" role="switch" aria-checked="' + on + '" aria-label="' + label + '" data-act="' + act + '"><i></i></button>';

  function tabCards() {
    const s = bank.state, card = s.card;
    const opt = (ic, title, trailing, act) => (act ? '<button class="opt" data-act="sheet" data-arg="' + act + '">' : '<div class="opt">') +
      icon(ic) + '<span>' + title + '</span><span class="grow"></span>' + trailing + (act ? '</button>' : '</div>');
    const cardTx = bank.transactions.filter(t => t.kind === 'cardPurchase').slice(0, 6);
    return '<div class="pad"><h3 class="center" style="margin:18px 0 14px">Your Card</h3>' + goldCard(card, s.profile.firstName + ' ' + s.profile.lastName) +
      '<div style="margin:14px 4px">' + limitBar('Spent today', bank.cardSpentToday, card.dailyLimit) + '</div>' +
      '<div class="opts">' +
      opt('snow', 'Freeze Card', toggle(card.frozen, 'toggleFreeze', 'Freeze Card')) +
      opt('list', 'View Details', icon('chev', 'chev'), 'cardDetails') +
      opt('shield', 'Set Spending Limits', '<small class="muted">' + Money.format(card.dailyLimit) + '/day</small>' + icon('chev', 'chev'), 'cardLimit') +
      opt('lock', 'Online Purchases', toggle(card.onlinePurchases, 'toggleOnline', 'Online Purchases')) +
      opt('wave', 'Pay with Card', icon('chev', 'chev'), 'cardPurchase') + '</div>' +
      '<div class="sec-head"><b>Card Activity</b></div>' +
      (cardTx.length ? cardTx.map(t => activityRow(t, false)).join('') : empty('No card payments yet.')) +
      footer('Card controls apply instantly to every<br>card payment Bread authorises.') + '</div>';
  }

  function tabMove() {
    const s = bank.state;
    const row = (ic, t, sub, act) => '<button class="move-row" data-act="sheet" data-arg="' + act + '"><span class="move-ic">' + icon(ic) + '</span><span class="row-main"><b>' + t + '</b><small>' + sub + '</small></span>' + icon('chev', 'chev') + '</button>';
    return '<div class="pad"><h1 class="title">Move Money</h1>' +
      '<div class="panel flush">' + row('swap', 'Transfer', 'Between your Bread accounts', 'transfer') + row('up', 'Send', 'Pay someone by bank details', 'send') +
      row('doc', 'Pay Bills', 'Utilities, rent and more', 'payBills') + row('tray', 'Deposit', 'Add money to an account', 'deposit') + row('down', 'Receive', 'Share your account details', 'receive') + '</div>' +
      '<div class="sec-head"><b>Daily limits</b></div><div class="panel">' + limitBar('Payments &amp; bills', bank.paymentsUsedToday, LIMITS.dailyPayment) + limitBar('Deposits', bank.depositsToday, LIMITS.dailyDeposit) + '</div>' +
      '<div class="sec-head"><b>Payees</b><button class="link gold" data-act="sheet" data-arg="addPayee">' + icon('plus') + ' Add</button></div>' +
      (s.payees.length ? s.payees.map(p => '<div class="payee"><span class="initials">' + esc(initials(p.name)) + '</span><span class="row-main"><b>' + esc(p.name) + '</b><small>Routing ' + esc(p.routingNumber) + ' • ' + esc(maskAccount(p.accountNumber)) + '</small></span>' +
        '<button class="icon-btn" data-act="removePayee" data-arg="' + p.id + '" aria-label="Remove ' + esc(p.name) + '">' + icon('trash') + '</button></div>').join('') : empty('No payees yet. Add someone to send them money.')) +
      '</div>';
  }

  function tabInsights() {
    const month = bank.monthInterval(0), last = bank.monthInterval(-1);
    const spend = bank.spending(month), total = spend.reduce((a, b) => a + b.total, 0);
    const lastTotal = bank.spending(last).reduce((a, b) => a + b.total, 0);
    const income = bank.income(month), week = bank.dailySpending(7);
    const max = Math.max(1, ...week.map(d => d.total));
    const niceMax = Math.ceil(max / 100 / 50) * 50 || 50;
    let cmp = 'No data last month';
    if (lastTotal > 0) { const d = total - lastTotal; cmp = d === 0 ? 'Same as last month' : Money.format(Math.abs(d)) + ' ' + (d > 0 ? 'more' : 'less') + ' than last month'; }
    const goal = bank.state.goal, saved = bank.balance('savings');
    return '<div class="pad"><h1 class="title">Insights</h1><p class="muted small" style="margin-top:-8px">' + month.start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) + '</p>' +
      '<div class="minis two"><div class="panel tile"><small>Spent</small><b>' + Money.format(total) + '</b><em>' + cmp + '</em></div><div class="panel tile"><small>Money in</small><b>' + Money.format(income) + '</b><em>Salary &amp; deposits</em></div></div>' +
      '<div class="panel"><b class="small-h">Last 7 days</b><div class="chart" role="img" aria-label="Spending over the last seven days">' +
      '<div class="yax"><span>$' + niceMax + '</span><span>$' + niceMax / 2 + '</span><span>$0</span></div><div class="bars">' +
      week.map(d => '<div class="bar-col" title="' + Money.format(d.total) + '"><div class="bar-fill" style="height:' + (d.total / 100 / niceMax * 100) + '%"></div><span>' + d.day.toLocaleDateString(undefined, { weekday: 'narrow' }) + '</span></div>').join('') +
      '</div></div></div>' +
      '<div class="sec-head"><b>Where it went</b></div>' +
      (spend.length ? spend.map(i => '<div class="cat"><div class="cat-top">' + icon(CAT_ICON[i.category], 'gold') + '<span>' + CATEGORIES[i.category] + '</span><span class="grow"></span><b>' + Money.format(i.total) + '</b></div><div class="bar"><i style="width:' + (i.total / Math.max(total, 1) * 100) + '%"></i></div></div>').join('') : empty('No spending this month yet.')) +
      (goal ? '<div class="panel" style="margin-top:18px"><div class="sec-head" style="margin:0"><b>Savings goal</b><button class="link gold" data-act="sheet" data-arg="goal">Edit</button></div>' +
        '<p class="muted small">' + esc(goal.name) + '</p><div class="bar green"><i style="width:' + Math.min(100, saved / goal.target * 100) + '%"></i></div>' +
        '<p class="small">' + Money.format(saved) + ' of ' + Money.format(goal.target) + (saved >= goal.target ? ' — reached!' : '') + '</p></div>' : '') +
      '</div>';
  }

  function viewMain() {
    const tabs = [['home', 'home', 'Home'], ['cards', 'card', 'Cards'], ['move', 'swap', 'Move Money'], ['insights', 'chart', 'Insights']];
    const body = { home: tabHome, cards: tabCards, move: tabMove, insights: tabInsights }[ui.tab]();
    return (bank.lastSaveError ? '<div class="save-err">' + esc(bank.lastSaveError) + '</div>' : '') +
      '<main class="main-scroll">' + body + '</main>' +
      '<nav class="tabbar">' + tabs.map(t => '<button data-act="tab" data-arg="' + t[0] + '" class="' + (ui.tab === t[0] ? 'on' : '') + '"' + (ui.tab === t[0] ? ' aria-current="page"' : '') + '>' + icon(t[1]) + '<span>' + t[2] + '</span></button>').join('') + '</nav>';
  }

  // =====================================================================
  // SHEETS
  // =====================================================================
  const acctOptions = (sel, only) => (only || ACCOUNTS).map(k => '<option value="' + k + '"' + (sel === k ? ' selected' : '') + '>' + ACCOUNT_TITLE[k] + ' • ' + Money.format(bank.balance(k)) + '</option>').join('');
  const amountField = (key, val) => '<div class="amount"><span>$</span><input data-field="' + key + '" inputmode="decimal" placeholder="0.00" aria-label="Amount in dollars" value="' + esc(val || '') + '"></div>';
  const section = (title, inner, foot) => '<section class="fsec">' + (title ? '<h4>' + title + '</h4>' : '') + '<div class="fbox">' + inner + '</div>' + (foot ? '<p class="ffoot">' + foot + '</p>' : '') + '</section>';
  const errText = e => e ? '<p class="err">' + esc(e) + '</p>' : '';
  const input = (key, ph, val, extra) => '<input class="finput" data-field="' + key + '" placeholder="' + esc(ph) + '" aria-label="' + esc(ph) + '" value="' + esc(val || '') + '"' + (extra || '') + '>';
  const select = (key, label, opts) => '<label class="fselect"><span>' + label + '</span><select data-field="' + key + '">' + opts + '</select></label>';
  const lc = (k, v) => '<div class="lc"><span>' + k + '</span><b>' + esc(v) + '</b></div>';
  const actBtn = (label, act, dis) => '<button class="form-btn" data-act="' + act + '"' + (dis ? ' disabled' : '') + '>' + esc(label) + '</button>';

  const SHEETS = {
    send: {
      title: 'Send',
      init: () => { const p = bank.state.payees; return { payee: p.length === 1 ? p[0].id : '', from: 'everyday', amount: '', note: '' }; },
      body(sh) {
        const f = sh.f, p = bank.state.payees;
        return section('To', (p.length ? select('payee', 'Payee', '<option value="">Choose…</option>' + p.map(x => '<option value="' + x.id + '"' + (f.payee === x.id ? ' selected' : '') + '>' + esc(x.name + ' • ' + maskAccount(x.accountNumber)) + '</option>').join('')) : '<p class="muted pad-in">You haven\'t added anyone yet.</p>') +
          '<button class="frow gold" data-act="push" data-arg="addPayee">' + icon('plus') + ' New payee</button>') +
          section('From', select('from', 'Account', acctOptions(f.from, ['everyday', 'savings']))) +
          section('Amount', amountField('amount', f.amount) + input('note', 'Note (optional)', f.note)) +
          section('', errText(sh.err) + actBtn(sh.working ? 'Sending…' : 'Send Money', 'submitSend', sh.working),
            'Payments of ' + Money.format(LIMITS.largePayment) + ' or more ask for your Bread PIN. Daily limit ' + Money.format(LIMITS.dailyPayment) + '.');
      }
    },
    addPayee: {
      title: 'New Payee',
      init: () => ({ name: '', routing: '', account: '' }),
      body(sh) {
        const f = sh.f;
        return section('Payee', input('name', 'Full name', f.name, ' autocomplete="name"') + input('routing', 'Routing number (9 digits)', f.routing, ' inputmode="numeric"') + input('account', 'Account number', f.account, ' inputmode="numeric"')) +
          section('', errText(sh.err) + actBtn('Save Payee', 'submitPayee'), 'Routing numbers are checked with the ABA checksum before saving. Try 011000015 or 021000021.');
      }
    },
    transfer: {
      title: 'Transfer',
      init: () => ({ from: 'everyday', to: 'savings', amount: '', note: '' }),
      body(sh) {
        const f = sh.f;
        return section('', select('from', 'From', acctOptions(f.from)) + select('to', 'To', acctOptions(f.to)) + '<button class="frow gold" data-act="swapAccts">' + icon('swap') + ' Swap accounts</button>') +
          section('Amount', amountField('amount', f.amount) + '<button class="frow gold small" data-act="fullBalance">Transfer full balance (' + Money.format(bank.balance(f.from)) + ')</button>' + input('note', 'Note (optional)', f.note)) +
          section('', errText(sh.err) + actBtn('Transfer', 'submitTransfer'));
      }
    },
    payBills: {
      title: 'Pay Bills',
      init: () => ({ biller: 'electricity', reference: '', from: 'everyday', amount: '' }),
      body(sh) {
        const f = sh.f;
        return section('Biller', '<div class="billers">' + Object.keys(BILLERS).map(b => '<button class="' + (f.biller === b ? 'on' : '') + '" aria-pressed="' + (f.biller === b) + '" data-act="pickBiller" data-arg="' + b + '">' + icon(BILL_ICON[b]) + '<span>' + BILLERS[b] + '</span></button>').join('') + '</div>' + input('reference', 'Customer reference', f.reference)) +
          section('From', select('from', 'Account', acctOptions(f.from, ['everyday', 'savings']))) +
          section('Amount', amountField('amount', f.amount)) +
          section('', errText(sh.err) + actBtn(sh.working ? 'Paying…' : 'Pay ' + BILLERS[f.biller], 'submitBill', sh.working));
      }
    },
    deposit: {
      title: 'Deposit',
      init: () => ({ into: 'everyday', source: 'Linked debit card', amount: '' }),
      body(sh) {
        const f = sh.f, src = ['Linked debit card', 'Cash deposit', 'Check deposit', 'Employer payment'];
        return section('Into', select('into', 'Account', acctOptions(f.into))) +
          section('Source', select('source', 'Source', src.map(s => '<option' + (f.source === s ? ' selected' : '') + '>' + s + '</option>').join(''))) +
          section('Amount', amountField('amount', f.amount)) +
          section('', errText(sh.err) + actBtn('Add Money', 'submitDeposit'), Money.format(Math.max(0, LIMITS.dailyDeposit - bank.depositsToday)) + ' of your ' + Money.format(LIMITS.dailyDeposit) + ' daily deposit limit remains.');
      }
    },
    receive: {
      title: 'Receive',
      init: () => ({ account: 'everyday' }),
      body(sh) {
        const s = bank.state, name = s.profile.firstName + ' ' + s.profile.lastName, num = bank.account(sh.f.account).accountNumber;
        const copyRow = (label, value) => '<button class="copy-row" data-act="copy" data-arg="' + esc(value) + '" data-label="' + label + '"><span><small>' + label + '</small><b class="mono">' + esc(value) + '</b></span>' + icon(sh.copied === label ? 'check' : 'copy', 'gold') + '</button>';
        return section('', '<div class="seg">' + ACCOUNTS.map(k => '<button class="' + (sh.f.account === k ? 'on' : '') + '" data-act="segAccount" data-arg="' + k + '">' + ACCOUNT_TITLE[k] + '</button>').join('') + '</div>') +
          section('Your details', copyRow('Name', name) + copyRow('Routing number', s.routingNumber) + copyRow('Account number', num)) +
          section('', '<button class="frow gold" data-act="shareDetails">' + icon('share') + ' Share account details</button>', 'Share these details with anyone who needs to pay you.');
      }
    },
    activity: {
      title: 'Activity',
      init: () => ({ q: '', filter: '' }),
      body(sh) {
        return '<div class="search">' + icon('search') + '<input id="actSearch" data-field="q" data-live="1" placeholder="Search activity" aria-label="Search activity" value="' + esc(sh.f.q) + '" autocomplete="off"></div>' +
          '<div class="seg">' + [['', 'All']].concat(ACCOUNTS.map(k => [k, ACCOUNT_TITLE[k]])).map(x => '<button class="' + (sh.f.filter === x[0] ? 'on' : '') + '" data-act="segFilter" data-arg="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>' +
          '<div id="actList">' + activityList(sh) + '</div>';
      }
    },
    transaction: {
      title: 'Transaction',
      init: () => ({}),
      body(sh) {
        const tx = bank.state.transactions.find(t => t.id === sh.id);
        if (!tx) return '<p class="muted pad-in">This transaction is no longer available.</p>';
        if (sh.f.note === undefined) sh.f.note = tx.note;
        return '<div class="tx-hero">' + icon(CAT_ICON[tx.category], 'gold big') + '<b>' + esc(tx.title) + '</b><div class="big ' + (tx.amount > 0 ? 'pos' : '') + '">' + Money.format(tx.amount, true) + '</div></div>' +
          section('Details', lc('Date', fmtDateTime(tx.date)) + lc('Account', ACCOUNT_TITLE[tx.account]) + lc('Category', CATEGORIES[tx.category]) + lc('Reference', tx.reference || '—') +
            (tx.kind === 'cardPurchase' ? lc('Type', tx.isOnline ? 'Online card payment' : 'In-person card payment') : '') + lc('Transaction ID', tx.id.slice(0, 8).toUpperCase())) +
          section('Note', input('note', 'Add a note', sh.f.note) + actBtn(sh.saved ? 'Saved' : 'Save Note', 'saveNote'));
      }
    },
    notifications: {
      title: 'Notifications',
      init: () => { const unread = bank.state.notices.filter(n => !n.read).map(n => n.id); setTimeout(() => bank.markAllNoticesRead(), 0); return { unread }; },
      extraAction: () => bank.state.notices.length ? '<button class="link gold" data-act="clearNotices">Clear</button>' : '',
      body(sh) {
        const ns = bank.state.notices.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
        if (!ns.length) return '<p class="muted pad-in">You\'re all caught up.</p>';
        return ns.map(n => '<div class="notice"><i class="' + (sh.f.unread.includes(n.id) ? 'dot' : '') + '"></i><div><b>' + esc(n.title) + '</b><p>' + esc(n.body) + '</p><small>' + relTime(n.date) + '</small></div></div>').join('');
      }
    },
    profile: {
      title: 'Profile',
      init: () => ({ first: bank.state.profile.firstName, last: bank.state.profile.lastName }),
      body(sh) {
        const p = bank.state.profile, f = sh.f;
        return '<div class="prof-head"><span class="initials lg">' + esc(initials(p.firstName + ' ' + p.lastName)) + '</span><div><b>' + esc(p.firstName + ' ' + p.lastName) + '</b><small class="muted">Member since ' + new Date(p.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) + '</small></div></div>' +
          section('Name', input('first', 'First name', f.first) + input('last', 'Last name', f.last) + errText(sh.err) + actBtn(sh.saved ? 'Saved' : 'Save Name', 'saveName')) +
          section('Security & privacy', '<div class="lc"><span>Hide balances on Home</span>' + toggle(ui.hide, 'toggleHide', 'Hide balances on Home') + '</div>' +
            '<button class="frow gold" data-act="lockNow">' + icon('lock') + ' Lock Bread Now</button>' + '<button class="frow gold" data-act="changePin">' + icon('key') + ' Change PIN</button>' +
            lc('Auto-lock', 'When Bread leaves the screen') + lc('Large payment approval', Money.format(LIMITS.largePayment) + '+')) +
          section('About', lc('Version', '1.0.0 (web)') + '<p class="muted small pad-in">This is a demo bank with pretend money. Your accounts, balances and history are kept only in this browser on this phone. Nothing is sent to a server.</p>') +
          section('', '<button class="form-btn danger" data-act="eraseAll">Close Accounts &amp; Erase Data</button>');
      }
    },
    cardLimit: {
      title: 'Spending Limit',
      init: () => ({ dollars: Math.round(bank.state.card.dailyLimit / 100) }),
      body(sh) {
        return section('', '<div class="big center" id="limitVal">' + Money.format(sh.f.dollars * 100) + ' per day</div>' +
          '<input type="range" class="slider" data-field="dollars" data-live="1" min="' + LIMITS.minCard / 100 + '" max="' + LIMITS.maxCard / 100 + '" step="50" value="' + sh.f.dollars + '" aria-label="Daily card limit">',
          'Spent today: ' + Money.format(bank.cardSpentToday) + '. Card payments above the limit are declined.') +
          section('', errText(sh.err) + actBtn('Save Limit', 'saveLimit'));
      }
    },
    cardDetails: {
      title: 'Card Details',
      init: () => ({}),
      body(sh) {
        const s = bank.state, c = s.card, name = s.profile.firstName + ' ' + s.profile.lastName;
        const grouped = c.number.replace(/(.{4})/g, '$1 ').trim();
        return '<div style="padding:4px 2px 14px">' + goldCard(c, name) + '</div>' + (sh.revealed ?
          section('Card details', '<button class="copy-row" data-act="copy" data-arg="' + c.number + '" data-label="Card number"><span><small>Card number</small><b class="mono">' + grouped + '</b></span>' + icon(sh.copied === 'Card number' ? 'check' : 'copy', 'gold') + '</button>' +
            lc('Expires', String(c.expiryMonth).padStart(2, '0') + '/' + String(c.expiryYear % 100).padStart(2, '0')) + lc('Security code', c.cvv) + lc('Name on card', name)) + section('', actBtn('Hide Details', 'hideCard')) :
          section('', errText(sh.err) + actBtn('Show Card Details', 'revealCard'), 'Card details are shown only after you enter your Bread PIN. This is a pretend card and can\'t be used in real shops.'));
      }
    },
    cardPurchase: {
      title: 'Pay with Card',
      init: () => ({ merchant: '', category: 'groceries', amount: '', online: false }),
      body(sh) {
        const f = sh.f;
        return section('Merchant', input('merchant', 'Merchant name', f.merchant) + select('category', 'Category', CARD_CATEGORIES.map(c => '<option value="' + c + '"' + (f.category === c ? ' selected' : '') + '>' + CATEGORIES[c] + '</option>').join('')) +
          '<div class="seg in">' + [[false, 'In person'], [true, 'Online']].map(x => '<button class="' + (f.online === x[0] ? 'on' : '') + '" data-act="segOnline" data-arg="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>') +
          section('Amount', amountField('amount', f.amount)) +
          section('', (sh.result ? '<p class="result ' + (sh.result.ok ? 'ok' : 'bad') + '">' + icon(sh.result.ok ? 'check' : 'x') + esc(sh.result.msg) + '</p>' : '') + actBtn('Pay with Card •••• ' + bank.state.card.last4, 'submitPurchase'),
            'Card payments come from Everyday and follow your freeze, online and daily limit settings.');
      }
    },
    goal: {
      title: 'Savings Goal',
      init: () => { const g = bank.state.goal; return { name: g ? g.name : '', target: g ? Money.toInput(g.target) : '' }; },
      body(sh) {
        return section('Goal', input('name', 'Goal name', sh.f.name) + amountField('target', sh.f.target)) +
          section('', errText(sh.err) + actBtn('Save Goal', 'saveGoal'), 'Progress is measured against your Savings balance.');
      }
    },
    receipt: {
      title: '',
      init: () => ({}),
      body(sh) {
        const r = sh.r;
        return '<div class="receipt"><div class="granted">' + icon('check') + '</div><h2>' + esc(r.title) + '</h2><div class="big gold-text">' + Money.format(r.amount) + '</div>' +
          '<div class="panel">' + r.lines.map(l => '<div class="lc"><span>' + esc(l[0]) + '</span><b>' + esc(l[1]) + '</b></div>').join('') + '</div>' +
          '<div class="grow"></div>' + goldBtn('Done', 'closeAll') + '</div>';
      }
    }
  };

  function activityList(sh) {
    const items = bank.transactionsMatching(sh.f.q, sh.f.filter || null);
    if (!items.length) return '<p class="muted pad-in">' + (sh.f.q ? 'No results for “' + esc(sh.f.q) + '”.' : 'No activity yet.') + '</p>';
    const groups = new Map();
    for (const t of items) { const k = startOfDay(new Date(t.date)).getTime(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
    let out = '';
    for (const [k, list] of groups) out += '<h4 class="day-h">' + new Date(k).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '</h4><div class="fbox">' + list.map(t => activityRow(t, ui.hide)).join('') + '</div>';
    return out;
  }

  function openSheet(type, extra) {
    const def = SHEETS[type];
    ui.sheets = [Object.assign({ type, f: def.init() }, extra || {})];
    renderSheets(true);
  }
  function pushSheet(type, extra) {
    const def = SHEETS[type];
    ui.sheets.push(Object.assign({ type, f: def.init() }, extra || {}));
    renderSheets(true);
  }
  function popSheet() { ui.sheets.pop(); renderSheets(); }
  function closeAll() { ui.sheets = []; renderSheets(); render(); }
  function showReceipt(r) { ui.sheets = [{ type: 'receipt', f: {}, r }]; renderSheets(true); }

  function renderSheets(animate) {
    const sh = top();
    if (!sh) { layer.innerHTML = ''; layer.className = ''; document.body.classList.remove('sheet-open'); return; }
    const def = SHEETS[sh.type];
    const canBack = ui.sheets.length > 1;
    layer.className = 'open';
    document.body.classList.add('sheet-open');
    const scroll = layer.querySelector('.sheet-body');
    const keep = !animate && scroll ? scroll.scrollTop : 0;
    layer.innerHTML = '<div class="scrim" data-act="closeAll"></div><div class="sheet' + (animate ? ' in' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(def.title || 'Done') + '">' +
      '<div class="grab"></div><div class="sheet-bar">' +
      (sh.type === 'receipt' ? '<span></span>' : canBack ? '<button class="link gold" data-act="pop">' + icon('back') + ' Back</button>' : '<button class="link gold" data-act="closeAll">Close</button>') +
      '<b>' + esc(def.title) + '</b>' + (def.extraAction ? def.extraAction(sh) : '<span></span>') + '</div>' +
      '<div class="sheet-body">' + def.body(sh) + '</div></div>';
    if (keep) layer.querySelector('.sheet-body').scrollTop = keep;
  }

  // =====================================================================
  // MODALS (PIN prompt, confirm)
  // =====================================================================
  const modalLayer = document.getElementById('modal');
  function renderModal() {
    const m = ui.modal;
    if (!m) { modalLayer.innerHTML = ''; modalLayer.className = ''; return; }
    modalLayer.className = 'open';
    if (m.kind === 'pin') {
      modalLayer.innerHTML = '<div class="modal-box pin-box" role="dialog" aria-modal="true" aria-label="Enter your PIN"><h3>Enter your Bread PIN</h3><p class="muted small">' + esc(m.reason) + '</p>' +
        pinDots(m.value.length, m.err) + '<p class="err">' + (m.err ? esc(m.err) : '&nbsp;') + '</p>' + keypad('modal') +
        '<button class="link gold" data-act="modalCancel">Cancel</button></div>';
    } else {
      modalLayer.innerHTML = '<div class="modal-box" role="alertdialog" aria-modal="true"><h3>' + esc(m.title) + '</h3><p class="muted small">' + esc(m.message) + '</p>' +
        '<button class="form-btn danger" data-act="modalOk">' + esc(m.button) + '</button><button class="link gold" data-act="modalCancel">Cancel</button></div>';
    }
  }
  function endModal(result) { const m = ui.modal; ui.modal = null; renderModal(); if (m) m.resolve(result); }

  // =====================================================================
  // RENDER
  // =====================================================================
  let codeTimer = null;
  function render() {
    const v = { welcome: viewWelcome, intro: viewIntro, identity: viewIdentity, pin: viewPin, code: viewCode, granted: viewGranted, lock: viewLock, main: viewMain }[ui.screen];
    app.className = 'scr-' + ui.screen;
    const scroller = app.querySelector('.main-scroll');
    const keep = ui.screen === 'main' && scroller && scroller.dataset.tab === ui.tab ? scroller.scrollTop : 0;
    app.innerHTML = v();
    const ns = app.querySelector('.main-scroll');
    if (ns) { ns.dataset.tab = ui.tab; ns.scrollTop = keep; }
    if (ui.screen === 'code') {
      if (!codeTimer) codeTimer = setInterval(tickCode, 1000);
    } else if (codeTimer) { clearInterval(codeTimer); codeTimer = null; }
  }
  function newCode() {
    const b = new Uint32Array(1); crypto.getRandomValues(b);
    ui.expected = String(b[0] % 1000000).padStart(6, '0'); ui.codeSecs = 30; ui.code = ''; ui.codeErr = null;
  }
  function tickCode() {
    if (ui.screen !== 'code') return;
    if (ui.codeSecs <= 0) { newCode(); render(); return; }
    ui.codeSecs--;
    const el = document.getElementById('codeSecs'); if (el) el.textContent = ui.codeSecs;
  }

  bank.onChange(() => { if (bank.hasProfile && ui.screen === 'main') { render(); if (top()) renderSheets(); } });

  // =====================================================================
  // ACTIONS
  // =====================================================================
  function parseAmountOrError(sh, text) {
    const a = Money.parse(text);
    if (a == null) { sh.err = 'Enter an amount greater than $0.00 with no more than two decimal places.'; renderSheets(); }
    return a;
  }

  async function handleKey(target, k) {
    if (target === 'setup') {
      const confirming = ui.pin1.length === 4;
      let cur = confirming ? (ui.pin2 || '') : ui.pin1;
      if (k === '⌫') cur = cur.slice(0, -1); else if (cur.length < 4) cur += k;
      ui.pinErr = null;
      if (confirming) ui.pin2 = cur; else ui.pin1 = cur;
      if (confirming && cur.length === 4) {
        if (ui.pin2 === ui.pin1) {
          await setPin(ui.pin1);
          if (ui.changingPin) { ui.changingPin = false; ui.screen = 'main'; } else { newCode(); ui.screen = 'code'; }
        }
        else { ui.pinErr = 'PINs didn\'t match. Start again.'; ui.pin1 = ''; ui.pin2 = ''; }
      }
      render();
    } else if (target === 'lock') {
      if (k === '⌫') ui.lockPin = ui.lockPin.slice(0, -1); else if (ui.lockPin.length < 4) ui.lockPin += k;
      ui.lockErr = null;
      if (ui.lockPin.length === 4) {
        const ok = await checkPin(ui.lockPin);
        ui.lockPin = '';
        if (ok) { ui.screen = 'main'; ui.tab = 'home'; } else ui.lockErr = 'Wrong PIN. Try again.';
      }
      render();
    } else if (target === 'modal' && ui.modal) {
      const m = ui.modal;
      if (k === '⌫') m.value = m.value.slice(0, -1); else if (m.value.length < 4) m.value += k;
      m.err = null;
      if (m.value.length === 4) {
        if (await checkPin(m.value)) { endModal(true); return; }
        m.value = ''; m.err = 'Wrong PIN. Try again.';
      }
      renderModal();
    }
  }

  const actions = {
    toIntro() { ui.screen = 'intro'; render(); },
    toIdentity() { ui.screen = 'identity'; ui.pin1 = ''; ui.pin2 = ''; ui.pinErr = null; render(); },
    cancelPinChange() { ui.changingPin = false; ui.pin1 = ''; ui.pin2 = ''; ui.screen = 'main'; render(); },
    toPin() { ui.screen = 'pin'; ui.pin1 = ''; ui.pin2 = ''; render(); },
    identityNext() {
      const d = ui.draft, f = Validation.cleanName(d.first), l = Validation.cleanName(d.last);
      if (!f || !l) { ui.identityErr = 'Enter a name of 2–40 letters.'; return render(); }
      if (!d.dob) { ui.identityErr = 'Enter your date of birth.'; return render(); }
      const [y, mo, da] = d.dob.split('-').map(Number);
      if (!Validation.isAdult(new Date(y, mo - 1, da), new Date())) { ui.identityErr = 'You must be 18 or older to open a Bread account.'; return render(); }
      d.first = f; d.last = l; ui.identityErr = null; ui.screen = 'pin'; ui.pin1 = ''; ui.pin2 = ''; render();
    },
    newCode() { newCode(); render(); },
    openAccount() {
      try {
        const [y, mo, da] = ui.draft.dob.split('-').map(Number);
        bank.openAccount(ui.draft.first, ui.draft.last, new Date(y, mo - 1, da));
        ui.openErr = null; ui.screen = 'main'; ui.tab = 'home'; render();
      } catch (e) { ui.openErr = e.message; render(); }
    },
    async eraseFromLock() {
      if (await confirmBox('Remove Bread data?', 'This permanently deletes the Bread accounts, balances and history stored in this browser.', 'Erase Accounts on This Phone')) eraseEverything();
    },
    key(arg) { const i = arg.indexOf(':'); handleKey(arg.slice(0, i), arg.slice(i + 1)); },
    tab(arg) { ui.tab = arg; render(); const m = app.querySelector('.main-scroll'); if (m) m.scrollTop = 0; },
    sheet(arg) { openSheet(arg); },
    push(arg) { pushSheet(arg); },
    pop() { popSheet(); },
    closeAll() { closeAll(); },
    openTx(arg) { if (top()) pushSheet('transaction', { id: arg }); else openSheet('transaction', { id: arg }); },
    toggleHide() { ui.hide = !ui.hide; ls.set('bread.hideBalances', ui.hide ? '1' : '0'); render(); if (top()) renderSheets(); },
    toggleFreeze() { bank.setCardFrozen(!bank.state.card.frozen); },
    toggleOnline() { bank.setOnlinePurchases(!bank.state.card.onlinePurchases); },
    async removePayee(id) {
      const p = bank.state.payees.find(x => x.id === id); if (!p) return;
      if (await confirmBox('Remove payee?', 'Past payments to ' + p.name + ' stay in your activity.', 'Remove ' + p.name)) bank.removePayee(id);
    },
    async submitSend() {
      const sh = top(), f = sh.f;
      const payee = bank.state.payees.find(p => p.id === f.payee);
      if (!payee) { sh.err = 'Choose who to pay.'; return renderSheets(); }
      const amount = parseAmountOrError(sh, f.amount); if (amount == null) return;
      if (!(await authorise(amount, 'Approve sending ' + Money.format(amount) + ' to ' + payee.name))) { sh.err = 'Payment not approved. Your PIN is required for large payments.'; return renderSheets(); }
      try {
        const t = bank.send(payee.id, f.from, amount, f.note);
        showReceipt({ title: 'Money sent', amount, lines: [['To', payee.name], ['Account', maskAccount(payee.accountNumber)], ['From', ACCOUNT_TITLE[f.from]], ['Date', fmtDateTime(t.date)]] });
      } catch (e) { sh.err = e.message; renderSheets(); }
    },
    submitPayee() {
      const sh = top(), f = sh.f;
      try {
        const p = bank.addPayee(f.name, f.routing, f.account);
        if (ui.sheets.length > 1) { ui.sheets.pop(); const below = top(); if (below.type === 'send') below.f.payee = p.id; renderSheets(); }
        else closeAll();
      } catch (e) { sh.err = e.message; renderSheets(); }
    },
    swapAccts() { const f = top().f; [f.from, f.to] = [f.to, f.from]; renderSheets(); },
    fullBalance() { const f = top().f; f.amount = Money.toInput(bank.balance(f.from)); renderSheets(); },
    submitTransfer() {
      const sh = top(), f = sh.f;
      const amount = parseAmountOrError(sh, f.amount); if (amount == null) return;
      try {
        bank.transfer(f.from, f.to, amount, f.note);
        showReceipt({ title: 'Transfer complete', amount, lines: [['From', ACCOUNT_TITLE[f.from]], ['To', ACCOUNT_TITLE[f.to]], ['New ' + ACCOUNT_TITLE[f.from] + ' balance', Money.format(bank.balance(f.from))]] });
      } catch (e) { sh.err = e.message; renderSheets(); }
    },
    pickBiller(arg) { top().f.biller = arg; renderSheets(); },
    async submitBill() {
      const sh = top(), f = sh.f;
      const amount = parseAmountOrError(sh, f.amount); if (amount == null) return;
      if (!(await authorise(amount, 'Approve paying ' + Money.format(amount) + ' to ' + BILLERS[f.biller]))) { sh.err = 'Payment not approved. Your PIN is required for large payments.'; return renderSheets(); }
      try {
        const t = bank.payBill(f.biller, f.reference, f.from, amount);
        showReceipt({ title: 'Bill paid', amount, lines: [['Biller', BILLERS[f.biller]], ['Reference', t.reference], ['From', ACCOUNT_TITLE[f.from]]] });
      } catch (e) { sh.err = e.message; renderSheets(); }
    },
    submitDeposit() {
      const sh = top(), f = sh.f;
      const amount = parseAmountOrError(sh, f.amount); if (amount == null) return;
      try {
        bank.deposit(f.into, amount, f.source);
        showReceipt({ title: 'Money added', amount, lines: [['Into', ACCOUNT_TITLE[f.into]], ['Source', f.source], ['New balance', Money.format(bank.balance(f.into))]] });
      } catch (e) { sh.err = e.message; renderSheets(); }
    },
    segAccount(arg) { const sh = top(); sh.f.account = arg; sh.copied = null; renderSheets(); },
    async copy(arg, el) {
      const sh = top();
      try { await navigator.clipboard.writeText(arg); } catch (e) { /* clipboard unavailable: still show the value */ }
      sh.copied = el.dataset.label; renderSheets();
    },
    async shareDetails() {
      const s = bank.state, sh = top();
      const text = 'Pay ' + s.profile.firstName + ' ' + s.profile.lastName + ' at Bread\nRouting number: ' + s.routingNumber + '\nAccount number: ' + bank.account(sh.f.account).accountNumber;
      try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); sh.copied = 'Shared'; renderSheets(); } } catch (e) {}
    },
    segFilter(arg) { top().f.filter = arg; renderSheets(); },
    saveNote() { const sh = top(); bank.updateNote(sh.id, sh.f.note); sh.saved = true; renderSheets(); },
    clearNotices() { bank.clearNotices(); },
    saveName() {
      const sh = top();
      try { bank.updateName(sh.f.first, sh.f.last); sh.err = null; sh.saved = true; renderSheets(); } catch (e) { sh.err = e.message; renderSheets(); }
    },
    lockNow() { lock(); },
    async changePin() {
      if (!(await requirePin('Enter your current PIN to change it.'))) return;
      closeAll(); ui.screen = 'pin'; ui.pin1 = ''; ui.pin2 = ''; ui.changingPin = true; render();
    },
    async eraseAll() {
      if (!(await confirmBox('Close your Bread accounts?', 'Balances, history, payees and your card are permanently deleted from this browser.', 'Erase Everything'))) return;
      if (await requirePin('Confirm closing your Bread accounts')) eraseEverything();
    },
    saveLimit() {
      const sh = top();
      try { bank.setCardLimit(Number(sh.f.dollars) * 100); closeAll(); } catch (e) { sh.err = e.message; renderSheets(); }
    },
    async revealCard() {
      const sh = top();
      if (await requirePin('Show your Bread card details')) { sh.revealed = true; sh.err = null; } else sh.err = 'Your PIN is required to view card details.';
      renderSheets();
    },
    hideCard() { top().revealed = false; renderSheets(); },
    segOnline(arg) { top().f.online = arg === 'true'; renderSheets(); },
    submitPurchase() {
      const sh = top(), f = sh.f;
      const amount = Money.parse(f.amount);
      if (amount == null) { sh.result = { ok: false, msg: 'Enter an amount greater than $0.00 with no more than two decimal places.' }; return renderSheets(); }
      try {
        const t = bank.cardPurchase(f.merchant, f.category, amount, f.online);
        sh.result = { ok: true, msg: 'Approved: ' + Money.format(amount) + ' at ' + t.title }; f.amount = '';
      } catch (e) {
        sh.result = { ok: false, msg: 'Declined: ' + (e.code === 'invalidName' ? 'Enter a merchant name of 2–40 characters.' : e.message) };
      }
      renderSheets();
    },
    saveGoal() {
      const sh = top();
      const cents = Money.parse(sh.f.target);
      if (cents == null) { sh.err = 'Enter a goal name and a target greater than $0.00.'; return renderSheets(); }
      try { bank.setGoal(sh.f.name, cents); closeAll(); } catch (e) { sh.err = e.message; renderSheets(); }
    },
    modalCancel() { endModal(false); },
    modalOk() { endModal(true); }
  };

  function eraseEverything() {
    bank.closeAndErase(); ls.del('bread.pin');
    ui.sheets = []; renderSheets();
    ui.screen = 'welcome'; ui.draft = { first: '', last: '', dob: '' }; ui.lockPin = ''; ui.lockErr = null;
    render();
  }
  function lock() {
    if (!bank.hasProfile) return;
    ui.sheets = []; renderSheets();
    if (ui.modal) endModal(false);
    ui.screen = 'lock'; ui.lockPin = ''; ui.lockErr = null; render();
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el.dataset.arg, el); }
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.draft) { ui.draft[el.dataset.draft] = el.value; ui.identityErr = null; return; }
    if (el.id === 'codeInput') {
      ui.code = el.value.replace(/[^0-9]/g, '').slice(0, 6); el.value = ui.code; ui.codeErr = null;
      const boxes = el.parentElement.querySelectorAll('i');
      boxes.forEach((b, i) => { b.textContent = ui.code[i] || ''; b.className = ''; });
      if (ui.code.length === 6) {
        if (ui.code === ui.expected) { el.blur(); setTimeout(() => { ui.screen = 'granted'; render(); }, 150); }
        else { ui.codeErr = 'That code does not match. Type the code in the box above.'; ui.code = ''; render(); }
      }
      return;
    }
    const sh = top();
    if (el.dataset.field && sh) {
      sh.f[el.dataset.field] = el.type === 'range' ? Number(el.value) : el.value;
      sh.saved = false;
      if (sh.type === 'activity') { const l = document.getElementById('actList'); if (l) l.innerHTML = activityList(sh); }
      if (sh.type === 'cardLimit') { const v = document.getElementById('limitVal'); if (v) v.textContent = Money.format(sh.f.dollars * 100) + ' per day'; }
    }
  });
  document.addEventListener('change', e => {
    const el = e.target, sh = top();
    if (el.tagName === 'SELECT' && el.dataset.field && sh) { sh.f[el.dataset.field] = el.value; if (sh.type === 'transfer') renderSheets(); }
  });
  document.addEventListener('keydown', e => {
    if (ui.modal && ui.modal.kind === 'pin') {
      if (/^[0-9]$/.test(e.key)) handleKey('modal', e.key); else if (e.key === 'Backspace') handleKey('modal', '⌫'); else if (e.key === 'Escape') endModal(false);
      return;
    }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const t = ui.screen === 'lock' ? 'lock' : ui.screen === 'pin' ? 'setup' : null;
    if (t) { if (/^[0-9]$/.test(e.key)) handleKey(t, e.key); else if (e.key === 'Backspace') handleKey(t, '⌫'); }
    else if (e.key === 'Escape' && top()) closeAll();
  });
  // Auto-lock when Bread leaves the screen (like the iPhone app).
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); document.body.classList.add('cover'); }
    else { document.body.classList.remove('cover'); if (hiddenAt && Date.now() - hiddenAt > 30000 && ui.screen === 'main') lock(); }
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
  window.__bread = { bank, ui };
})();
