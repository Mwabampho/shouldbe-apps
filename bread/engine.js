// Bread ledger — web port of BankEngine.swift.
// All money is integer cents. Works in the browser (window.BreadEngine) and in Node (module.exports) for tests.
(function (root) {
  'use strict';

  const MAX_SINGLE = 100000000; // $1,000,000.00

  const Money = {
    maxSingleAmount: MAX_SINGLE,
    /** "12", "12.5", "1,234.56", "$40" -> cents. null for empty/zero/negative/>2 decimals/absurd. */
    parse(raw) {
      let t = String(raw == null ? '' : raw).trim().replace(/\$/g, '').replace(/,/g, '').replace(/ /g, '');
      if (!t) return null;
      const parts = t.split('.');
      if (parts.length > 2) return null;
      const whole = parts[0], frac = parts.length === 2 ? parts[1] : '';
      if (!whole && !frac) return null;
      if (!/^[0-9]*$/.test(whole) || !/^[0-9]*$/.test(frac) || frac.length > 2 || whole.length > 9) return null;
      const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
      if (!(cents > 0) || cents > MAX_SINGLE) return null;
      return cents;
    },
    format(cents, signed) {
      const neg = cents < 0, mag = Math.abs(cents);
      const whole = Math.floor(mag / 100), frac = mag % 100;
      const body = '$' + whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + (frac < 10 ? '0' : '') + frac;
      if (neg) return '-' + body;
      return signed && cents > 0 ? '+' + body : body;
    },
    toInput(cents) { return cents > 0 ? Math.floor(cents / 100) + '.' + String(cents % 100).padStart(2, '0') : ''; }
  };

  const ACCOUNTS = ['everyday', 'savings', 'investing'];
  const ACCOUNT_TITLE = { everyday: 'Everyday', savings: 'Savings', investing: 'Investing' };
  const canPayOut = k => k !== 'investing';

  const CATEGORIES = {
    groceries: 'Groceries', dining: 'Dining', transport: 'Transport', shopping: 'Shopping',
    subscriptions: 'Subscriptions', bills: 'Bills', transfers: 'Transfers', income: 'Income',
    deposits: 'Deposits', payments: 'Payments', other: 'Other'
  };
  const isSpending = c => !['transfers', 'income', 'deposits'].includes(c);
  const CARD_CATEGORIES = ['groceries', 'dining', 'transport', 'shopping', 'subscriptions', 'other'];

  const BILLERS = { electricity: 'Electricity', water: 'Water', internet: 'Internet', phone: 'Mobile Phone', rent: 'Rent', insurance: 'Insurance' };

  const LIMITS = {
    dailyPayment: 1000000,   // $10,000.00
    dailyDeposit: 500000,    // $5,000.00
    minCard: 5000,           // $50.00
    maxCard: 1000000,        // $10,000.00
    largePayment: 100000     // $1,000.00 needs PIN
  };

  class BankError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const E = {
    noAccount: () => new BankError('noAccount', 'Open a Bread account first.'),
    invalidAmount: () => new BankError('invalidAmount', 'Enter an amount greater than $0.00 with no more than two decimal places.'),
    insufficientFunds: a => new BankError('insufficientFunds', 'Insufficient funds. Available balance is ' + Money.format(a) + '.'),
    sameAccount: () => new BankError('sameAccount', 'Choose two different accounts.'),
    accountCannotPay: k => new BankError('accountCannotPay', "Payments can't be made directly from " + ACCOUNT_TITLE[k] + '. Transfer to Everyday first.'),
    unknownPayee: () => new BankError('unknownPayee', 'That payee no longer exists.'),
    invalidName: () => new BankError('invalidName', 'Enter a name of 2–40 letters.'),
    invalidRoutingNumber: () => new BankError('invalidRoutingNumber', 'Routing number must be 9 digits and pass the ABA check.'),
    invalidAccountNumber: () => new BankError('invalidAccountNumber', 'Account number must be 4–17 digits.'),
    duplicatePayee: () => new BankError('duplicatePayee', 'You already have a payee with these account details.'),
    invalidReference: () => new BankError('invalidReference', 'Enter a reference of 2–30 characters.'),
    cardFrozen: () => new BankError('cardFrozen', 'Your card is frozen. Unfreeze it to make purchases.'),
    onlinePurchasesBlocked: () => new BankError('onlinePurchasesBlocked', 'Online purchases are turned off for this card.'),
    cardLimitExceeded: r => new BankError('cardLimitExceeded', "This exceeds your card's daily limit. " + Money.format(r) + ' left today.'),
    dailyPaymentLimitExceeded: r => new BankError('dailyPaymentLimitExceeded', 'This exceeds the $10,000.00 daily payment limit. ' + Money.format(r) + ' left today.'),
    depositLimitExceeded: r => new BankError('depositLimitExceeded', 'This exceeds the $5,000.00 daily deposit limit. ' + Money.format(r) + ' left today.'),
    invalidLimit: () => new BankError('invalidLimit', 'Choose a daily card limit between $50.00 and $10,000.00.'),
    underage: () => new BankError('underage', 'You must be 18 or older to open a Bread account.'),
    invalidGoal: () => new BankError('invalidGoal', 'Enter a goal name and a target greater than $0.00.')
  };

  const Validation = {
    cleanName(raw) {
      const t = String(raw || '').trim().split(/\s+/).filter(Boolean).join(' ');
      const len = [...t].length;
      if (len < 2 || len > 40) return null;
      if (!/^[\p{L} '\-.]+$/u.test(t) || !/\p{L}/u.test(t)) return null;
      return t;
    },
    digits: raw => String(raw || '').replace(/[^0-9]/g, ''),
    isValidRouting(raw) {
      if (!/^[0-9]{9}$/.test(raw) || raw === '000000000') return false;
      const d = [...raw].map(Number);
      return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
    },
    isValidAccountNumber: raw => /^[0-9]{4,17}$/.test(raw),
    luhnCheckDigit(partial) {
      let sum = 0;
      [...partial].reverse().forEach((ch, i) => { let v = Number(ch) || 0; if (i % 2 === 0) { v *= 2; if (v > 9) v -= 9; } sum += v; });
      return (10 - sum % 10) % 10;
    },
    isLuhnValid(n) { return n.length >= 12 && Validation.luhnCheckDigit(n.slice(0, -1)) === Number(n.slice(-1)); },
    isAdult(dob, now) {
      const d = new Date(dob);
      const e = new Date(d.getFullYear() + 18, d.getMonth(), d.getDate());
      return e <= now;
    }
  };

  // ---- date helpers (local calendar) ----
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds());
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  function uuid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  function randomDigits(n) {
    let s = '';
    const buf = new Uint8Array(n);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(buf); else for (let i = 0; i < n; i++) buf[i] = Math.random() * 256;
    for (let i = 0; i < n; i++) s += String(buf[i] % 10);
    return s;
  }

  const clip60 = s => [...String(s || '').trim()].slice(0, 60).join('');

  class Bank {
    /** store: {load():state|null, save(state), erase()} or null */
    constructor(store, now) {
      this.store = store || null;
      this.now = now || (() => new Date());
      this.state = this.store ? this.store.load() : null;
      this.lastSaveError = null;
      this.listeners = [];
    }
    onChange(fn) { this.listeners.push(fn); }
    get hasProfile() { return !!this.state; }

    account(k) { return this.state ? this.state.accounts.find(a => a.id === k) || null : null; }
    balance(k) { const a = this.account(k); return a ? a.balance : 0; }
    get totalBalance() { return this.state ? this.state.accounts.reduce((s, a) => s + a.balance, 0) : 0; }
    get unreadCount() { return this.state ? this.state.notices.filter(n => !n.read).length : 0; }
    get transactions() { return (this.state ? this.state.transactions.slice() : []).sort((a, b) => new Date(b.date) - new Date(a.date)); }

    transactionsMatching(query, account) {
      const q = String(query || '').trim().toLowerCase();
      return this.transactions.filter(tx => (!account || tx.account === account) &&
        (!q || tx.title.toLowerCase().includes(q) || CATEGORIES[tx.category].toLowerCase().includes(q) || tx.note.toLowerCase().includes(q) || tx.reference.toLowerCase().includes(q)));
    }

    _todaySum(pred, sign) {
      const today = this.now();
      return (this.state ? this.state.transactions : []).filter(t => pred(t) && sameDay(new Date(t.date), today)).reduce((s, t) => s + sign * t.amount, 0);
    }
    get paymentsUsedToday() { return this._todaySum(t => t.kind === 'payment' || t.kind === 'billPayment', -1); }
    get depositsToday() { return this._todaySum(t => t.kind === 'deposit', 1); }
    get cardSpentToday() { return this._todaySum(t => t.kind === 'cardPurchase', -1); }

    monthInterval(offset) {
      const n = this.now();
      const start = new Date(n.getFullYear(), n.getMonth() + (offset || 0), 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      return { start, end };
    }
    spending(iv) {
      const totals = {};
      for (const tx of this.state ? this.state.transactions : []) {
        const d = new Date(tx.date);
        if (tx.amount < 0 && isSpending(tx.category) && d >= iv.start && d < iv.end) totals[tx.category] = (totals[tx.category] || 0) - tx.amount;
      }
      return Object.keys(totals).map(c => ({ category: c, total: totals[c] }))
        .sort((a, b) => a.total === b.total ? (a.category < b.category ? -1 : 1) : b.total - a.total);
    }
    income(iv) {
      return (this.state ? this.state.transactions : []).filter(t => {
        const d = new Date(t.date); return t.amount > 0 && (t.kind === 'income' || t.kind === 'deposit') && d >= iv.start && d < iv.end;
      }).reduce((s, t) => s + t.amount, 0);
    }
    dailySpending(days) {
      days = days || 7;
      const today = startOfDay(this.now());
      const out = [];
      for (let back = days - 1; back >= 0; back--) {
        const day = addDays(today, -back), next = addDays(day, 1);
        const total = (this.state ? this.state.transactions : []).filter(t => {
          const d = new Date(t.date); return t.amount < 0 && isSpending(t.category) && d >= day && d < next;
        }).reduce((s, t) => s - t.amount, 0);
        out.push({ day, total });
      }
      return out;
    }

    // ---- opening ----
    openAccount(firstName, lastName, dateOfBirth, seedSampleHistory) {
      const first = Validation.cleanName(firstName), last = Validation.cleanName(lastName);
      if (!first || !last) throw E.invalidName();
      if (!Validation.isAdult(dateOfBirth, this.now())) throw E.underage();
      const created = this.now();
      const partial = '529999' + randomDigits(9);
      const cardNumber = partial + Validation.luhnCheckDigit(partial);
      const state = {
        version: 1,
        profile: { firstName: first, lastName: last, dateOfBirth: new Date(dateOfBirth).toISOString(), createdAt: created.toISOString() },
        accounts: ACCOUNTS.map(id => ({ id, balance: 0, accountNumber: '40' + randomDigits(8) })),
        transactions: [], payees: [],
        card: { frozen: false, onlinePurchases: true, dailyLimit: 100000, last4: cardNumber.slice(-4), number: cardNumber, cvv: randomDigits(3),
          expiryMonth: created.getMonth() + 1, expiryYear: created.getFullYear() + 4 },
        notices: [],
        goal: { name: 'Rainy day fund', target: 1000000 },
        routingNumber: '021000021'
      };
      if (seedSampleHistory !== false) seedHistory(state, created);
      state.notices.push(notice(created, 'Welcome to Bread, ' + first, 'Your Everyday, Savings and Investing accounts are open. Your Bread card ending ' + state.card.last4 + ' is ready to use.'));
      this._commit(state);
    }
    closeAndErase() {
      if (this.store) this.store.erase();
      this.state = null;
      this._emit();
    }

    // ---- money movement ----
    _s() { if (!this.state) throw E.noAccount(); return JSON.parse(JSON.stringify(this.state)); }

    transfer(from, to, amount, note) {
      const s = this._s();
      if (!(amount > 0) || amount > MAX_SINGLE) throw E.invalidAmount();
      if (from === to) throw E.sameAccount();
      const fa = s.accounts.find(a => a.id === from), ta = s.accounts.find(a => a.id === to);
      if (!fa || !ta) throw E.sameAccount();
      if (fa.balance < amount) throw E.insufficientFunds(fa.balance);
      const group = uuid(), date = this.now().toISOString(), n = clip60(note);
      fa.balance -= amount; ta.balance += amount;
      s.transactions.push(tx(date, from, -amount, 'To ' + ACCOUNT_TITLE[to], 'transfers', 'transferOut', n, 'Internal transfer', group));
      s.transactions.push(tx(date, to, amount, 'From ' + ACCOUNT_TITLE[from], 'transfers', 'transferIn', n, 'Internal transfer', group));
      this._commit(s);
      return group;
    }

    addPayee(name, routingNumber, accountNumber) {
      const s = this._s();
      const clean = Validation.cleanName(name);
      if (!clean) throw E.invalidName();
      const rawR = String(routingNumber || '').replace(/[\s-]/g, ''), rawA = String(accountNumber || '').replace(/[\s-]/g, '');
      const routing = Validation.digits(rawR), account = Validation.digits(rawA);
      if (routing.length !== rawR.length || !Validation.isValidRouting(routing)) throw E.invalidRoutingNumber();
      if (account.length !== rawA.length || !Validation.isValidAccountNumber(account)) throw E.invalidAccountNumber();
      if (s.payees.some(p => p.routingNumber === routing && p.accountNumber === account)) throw E.duplicatePayee();
      const payee = { id: uuid(), name: clean, routingNumber: routing, accountNumber: account };
      s.payees.push(payee);
      this._commit(s);
      return payee;
    }
    removePayee(id) { if (!this.state) return; const s = this._s(); s.payees = s.payees.filter(p => p.id !== id); this._commit(s); }

    _checkOutgoing(s, from, amount) {
      if (!(amount > 0) || amount > MAX_SINGLE) throw E.invalidAmount();
      if (!canPayOut(from)) throw E.accountCannotPay(from);
      const remaining = Math.max(0, LIMITS.dailyPayment - this.paymentsUsedToday);
      if (amount > remaining) throw E.dailyPaymentLimitExceeded(remaining);
      const a = s.accounts.find(x => x.id === from);
      if (!a) throw E.unknownPayee();
      if (a.balance < amount) throw E.insufficientFunds(a.balance);
    }
    _apply(s, t) { const a = s.accounts.find(x => x.id === t.account); if (!a) return; a.balance += t.amount; s.transactions.push(t); }

    send(payeeId, from, amount, note) {
      const s = this._s();
      const payee = s.payees.find(p => p.id === payeeId);
      if (!payee) throw E.unknownPayee();
      this._checkOutgoing(s, from, amount);
      const t = tx(this.now().toISOString(), from, -amount, payee.name, 'payments', 'payment', clip60(note), 'To ' + maskAccount(payee.accountNumber));
      this._apply(s, t);
      s.notices.push(notice(this.now(), 'Payment sent', Money.format(amount) + ' sent to ' + payee.name + ' from ' + ACCOUNT_TITLE[from] + '.'));
      this._commit(s);
      return t;
    }

    payBill(biller, reference, from, amount) {
      const s = this._s();
      const ref = String(reference || '').trim();
      if ([...ref].length < 2 || [...ref].length > 30) throw E.invalidReference();
      this._checkOutgoing(s, from, amount);
      const t = tx(this.now().toISOString(), from, -amount, BILLERS[biller], 'bills', 'billPayment', '', ref);
      this._apply(s, t);
      s.notices.push(notice(this.now(), 'Bill paid', Money.format(amount) + ' paid to ' + BILLERS[biller] + ' (ref ' + ref + ').'));
      this._commit(s);
      return t;
    }

    deposit(into, amount, source) {
      const s = this._s();
      if (!(amount > 0) || amount > MAX_SINGLE) throw E.invalidAmount();
      const remaining = Math.max(0, LIMITS.dailyDeposit - this.depositsToday);
      if (amount > remaining) throw E.depositLimitExceeded(remaining);
      const src = String(source || '').trim();
      const t = tx(this.now().toISOString(), into, amount, src ? 'Deposit • ' + src : 'Deposit', 'deposits', 'deposit', '', 'Top-up');
      this._apply(s, t);
      s.notices.push(notice(this.now(), 'Money added', Money.format(amount) + ' added to ' + ACCOUNT_TITLE[into] + '.'));
      this._commit(s);
      return t;
    }

    /** Declines are logged as notices, never as transactions. */
    cardPurchase(merchant, category, amount, online) {
      const s = this._s();
      const name = String(merchant || '').trim();
      try {
        if ([...name].length < 2 || [...name].length > 40) throw E.invalidName();
        if (!(amount > 0) || amount > MAX_SINGLE) throw E.invalidAmount();
        if (s.card.frozen) throw E.cardFrozen();
        if (online && !s.card.onlinePurchases) throw E.onlinePurchasesBlocked();
        const remaining = Math.max(0, s.card.dailyLimit - this.cardSpentToday);
        if (amount > remaining) throw E.cardLimitExceeded(remaining);
        const avail = (s.accounts.find(a => a.id === 'everyday') || { balance: 0 }).balance;
        if (avail < amount) throw E.insufficientFunds(avail);
      } catch (err) {
        if (err.code !== 'invalidName' && err.code !== 'invalidAmount') {
          s.notices.push(notice(this.now(), 'Card payment declined', Money.format(amount) + ' at ' + name + ': ' + err.message + '.'));
          this._commit(s);
        }
        throw err;
      }
      const t = tx(this.now().toISOString(), 'everyday', -amount, name, CARD_CATEGORIES.includes(category) ? category : 'other', 'cardPurchase', '', 'Card •••• ' + s.card.last4);
      t.isOnline = !!online;
      this._apply(s, t);
      this._commit(s);
      return t;
    }

    // ---- settings ----
    setCardFrozen(frozen) {
      if (!this.state || this.state.card.frozen === frozen) return;
      const s = this._s();
      s.card.frozen = frozen;
      s.notices.push(notice(this.now(), frozen ? 'Card frozen' : 'Card unfrozen', frozen ? 'Card •••• ' + s.card.last4 + ' is frozen. All card payments will be declined.' : 'Card •••• ' + s.card.last4 + ' can be used again.'));
      this._commit(s);
    }
    setOnlinePurchases(on) { if (!this.state || this.state.card.onlinePurchases === on) return; const s = this._s(); s.card.onlinePurchases = on; this._commit(s); }
    setCardLimit(cents) {
      if (!this.state) return;
      if (!(cents >= LIMITS.minCard && cents <= LIMITS.maxCard)) throw E.invalidLimit();
      const s = this._s(); s.card.dailyLimit = cents; this._commit(s);
    }
    setGoal(name, target) {
      if (!this.state) return;
      const clean = String(name || '').trim();
      if ([...clean].length < 1 || [...clean].length > 30 || !(target > 0) || target > MAX_SINGLE) throw E.invalidGoal();
      const s = this._s(); s.goal = { name: clean, target }; this._commit(s);
    }
    updateName(first, last) {
      if (!this.state) return;
      const f = Validation.cleanName(first), l = Validation.cleanName(last);
      if (!f || !l) throw E.invalidName();
      const s = this._s(); s.profile.firstName = f; s.profile.lastName = l; this._commit(s);
    }
    updateNote(id, note) {
      if (!this.state) return;
      const s = this._s(); const t = s.transactions.find(x => x.id === id); if (!t) return;
      t.note = clip60(note); this._commit(s);
    }
    markAllNoticesRead() {
      if (!this.state || !this.state.notices.some(n => !n.read)) return;
      const s = this._s(); s.notices.forEach(n => { n.read = true; }); this._commit(s);
    }
    clearNotices() { if (!this.state) return; const s = this._s(); s.notices = []; this._commit(s); }

    _commit(s) {
      this.state = s;
      if (this.store) {
        try { this.store.save(s); this.lastSaveError = null; }
        catch (e) { this.lastSaveError = "Bread couldn't save your latest changes: " + e.message; }
      }
      this._emit();
    }
    _emit() { this.listeners.forEach(fn => fn()); }
  }

  function tx(date, account, amount, title, category, kind, note, reference, transferGroup) {
    return { id: uuid(), date, account, amount, title, category, kind, note: note || '', reference: reference || '', transferGroup: transferGroup || null, isOnline: false };
  }
  function notice(date, title, body) { return { id: uuid(), date: new Date(date).toISOString(), title, body, read: false }; }
  function maskAccount(n) { return '•••• ' + String(n).slice(-4); }

  function seedHistory(s, now) {
    const daysAgo = (d, hour) => { const day = addDays(startOfDay(now), -d); day.setHours(hour == null ? 12 : hour); return day.toISOString(); };
    const txs = [];
    const add = (d, account, amount, title, cat, kind, hour) =>
      txs.push(tx(daysAgo(d, hour), account, amount, title, cat, kind, '', kind === 'cardPurchase' ? 'Card •••• ' + s.card.last4 : 'Opening history'));
    add(45, 'everyday', 260000, 'Opening balance', 'income', 'opening', 9);
    add(45, 'savings', 600000, 'Opening balance', 'income', 'opening', 9);
    add(45, 'investing', 216040, 'Opening balance', 'income', 'opening', 9);
    add(38, 'everyday', 240000, 'Salary Deposit', 'income', 'income', 8);
    add(36, 'everyday', -8412, 'Whole Foods', 'groceries', 'cardPurchase');
    add(33, 'everyday', -145000, 'Rent', 'bills', 'billPayment', 10);
    add(30, 'everyday', -1099, 'Spotify', 'subscriptions', 'cardPurchase');
    add(27, 'everyday', -3250, 'Lyft', 'transport', 'cardPurchase', 19);
    add(22, 'everyday', -6780, 'Electricity', 'bills', 'billPayment');
    add(15, 'everyday', -4420, "Trader Joe's", 'groceries', 'cardPurchase');
    add(9, 'everyday', 240000, 'Salary Deposit', 'income', 'income', 8);
    add(8, 'everyday', -2895, 'Blue Bottle Coffee', 'dining', 'cardPurchase', 9);
    add(6, 'everyday', -12999, 'Nike', 'shopping', 'cardPurchase', 15);
    add(4, 'everyday', -1850, 'Metro Transit', 'transport', 'cardPurchase', 8);
    add(3, 'everyday', -5623, 'Whole Foods', 'groceries', 'cardPurchase', 18);
    add(2, 'everyday', -4210, "Nando's", 'dining', 'cardPurchase', 20);
    add(1, 'everyday', -1099, 'Netflix', 'subscriptions', 'cardPurchase', 7);
    for (const t of txs) { const a = s.accounts.find(x => x.id === t.account); if (a) a.balance += t.amount; }
    s.transactions.push(...txs);
    s.payees.push({ id: uuid(), name: 'Jordan Lee', routingNumber: '011000015', accountNumber: '40019284' });
  }

  /** localStorage-backed store; unreadable data is kept aside rather than destroyed. */
  function LocalStore(key) {
    key = key || 'bread.ledger.v1';
    return {
      load() {
        let raw = null;
        try { raw = root.localStorage.getItem(key); } catch (e) { return null; }
        if (!raw) return null;
        try {
          const s = JSON.parse(raw);
          if (!s || s.version > 1 || !s.profile || !Array.isArray(s.accounts)) throw new Error('bad');
          return s;
        } catch (e) {
          try { root.localStorage.setItem(key + '.unreadable.' + Date.now(), raw); root.localStorage.removeItem(key); } catch (_) {}
          return null;
        }
      },
      save(s) { root.localStorage.setItem(key, JSON.stringify(s)); },
      erase() { try { root.localStorage.removeItem(key); } catch (e) {} }
    };
  }

  const api = { Money, Bank, BankError, Validation, LocalStore, ACCOUNTS, ACCOUNT_TITLE, CATEGORIES, CARD_CATEGORIES, BILLERS, LIMITS, canPayOut, maskAccount, sameDay, startOfDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BreadEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
