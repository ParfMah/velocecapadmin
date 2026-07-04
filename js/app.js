/* ============================================================
   app.js — Veloce Capital Admin Mobile PWA
   Application complète : routing, vues, logique métier
   ============================================================ */

'use strict';

/* ════════════════════════════════════════════════════════════
   ÉTAT GLOBAL
   ════════════════════════════════════════════════════════════ */
const State = {
  admin:          null,
  currentView:    'dashboard',
  currentChat:    null,  // session de chat active dans la vue
  socket:         null,
  notifCount:     0,
  chatWaiting:    0,
  requests:       [],
  requestFilter:  'all',
  requestSearch:  '',
  chatSessions:   [],
  chatFilter:     'all',
  contentItems:   [],
  services:       [],
  mediaItems:     [],
};

/* ════════════════════════════════════════════════════════════
   UTILITAIRES
   ════════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);
const el = (tag, cls, html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmtEur = n => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
const fmtDate = d => new Date(d).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'2-digit' });
const fmtTime = d => new Date(d).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
const initials = name => (name || '?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);

const STATUS_LABELS = { new:'Nouveau', in_review:'En cours', accepted:'Accepté', rejected:'Refusé', on_hold:'En attente' };
const STATUS_CLASSES = { new:'badge--new', in_review:'badge--review', accepted:'badge--accepted', rejected:'badge--rejected', on_hold:'badge--hold' };
const LOAN_LABELS = { personal:'Prêt Personnel', auto:'Prêt Auto', works:'Prêt Travaux', immo:'Prêt Immo', regroupement:'Regroupement', other:'Autre' };

/* ── Toast ─────────────────────────────────────────────── */
function toast(msg, type = 'info', duration = 3000) {
  const t = el('div', `toast toast--${type}`, esc(msg));
  $('toast-container').appendChild(t);
  setTimeout(() => t.remove(), duration);
}

/* ── Sheet helper ───────────────────────────────────────── */
function openSheet(titleHtml, bodyHtml) {
  $('sheet-title').innerHTML = titleHtml;
  $('sheet-body').innerHTML = bodyHtml;
  $('sheet-overlay').classList.add('open');
  $('bottom-sheet').classList.add('open');
  $('sheet-body').scrollTop = 0;
}
function closeSheet() {
  $('sheet-overlay').classList.remove('open');
  $('bottom-sheet').classList.remove('open');
}

/* ── Skeleton ───────────────────────────────────────────── */
function skeletonRows(n = 5) {
  return Array.from({ length: n }, () => `
    <div class="skeleton-item">
      <div class="skeleton skeleton-avatar"></div>
      <div class="skeleton-content">
        <div class="skeleton skeleton-line skeleton-line--long"></div>
        <div class="skeleton skeleton-line skeleton-line--short"></div>
      </div>
    </div>`).join('');
}

/* ════════════════════════════════════════════════════════════
   ROUTER
   ════════════════════════════════════════════════════════════ */
function navigate(view) {
  // Masquer toutes les vues
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const viewEl = $(`view-${view}`);
  if (!viewEl) return;
  viewEl.classList.add('active');

  const navEl = $(`nav-${view}`);
  if (navEl) navEl.classList.add('active');

  State.currentView = view;
  updateHeaderTitle(view);

  // Charger les données de la vue
  const loaders = { dashboard: loadDashboard, requests: loadRequests, chat: loadChatSessions, content: loadContent, more: loadMore };
  if (loaders[view]) loaders[view]();
}

function updateHeaderTitle(view) {
  const titles = { dashboard: 'Tableau de bord', requests: 'Demandes', chat: 'Chat en direct', content: 'Contenu & Services', more: 'Plus' };
  $('header-title').textContent = titles[view] || '';
}

/* ════════════════════════════════════════════════════════════
   AUTH
   ════════════════════════════════════════════════════════════ */
async function checkAuth() {
  const token = localStorage.getItem('vc_admin_token');
  if (!token) { showLogin(); return; }
  try {
    const { user } = await API.auth.me();
    State.admin = user;
    showApp();
  } catch {
    localStorage.removeItem('vc_admin_token');
    showLogin();
  }
}

function showLogin() {
  $('screen-login').style.display = 'flex';
  $('app-shell').classList.remove('visible');
}

function showApp() {
  $('screen-login').style.display = 'none';
  $('app-shell').classList.add('visible');
  updateProfile();
  initSocket();
  navigate('dashboard');
}

async function handleLogin(e) {
  e.preventDefault();
  const btn   = $('btn-login');
  const email = $('login-email').value.trim();
  const pass  = $('login-pass').value;
  const errEl = $('login-error');

  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Connexion…';

  try {
    const { token, user } = await API.auth.login(email, pass);
    localStorage.setItem('vc_admin_token', token);
    State.admin = user;
    showApp();
  } catch (err) {
    errEl.textContent = err.message || 'Identifiants incorrects';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Se connecter';
  }
}

function logout() {
  if (!confirm('Voulez-vous vous déconnecter ?')) return;
  API.auth.logout().catch(() => {});
  localStorage.removeItem('vc_admin_token');
  if (State.socket) State.socket.disconnect();
  State.admin = null;
  showLogin();
}

function updateProfile() {
  const el = $('profile-cell');
  if (!el || !State.admin) return;
  el.innerHTML = `
    <div class="profile-card">
      <div class="profile-avatar">${initials(State.admin.name)}</div>
      <div class="profile-info">
        <h3>${esc(State.admin.name)}</h3>
        <p>${esc(State.admin.email)}</p>
      </div>
      <span class="profile-badge">${esc(State.admin.role || 'Admin')}</span>
    </div>`;
}

/* ════════════════════════════════════════════════════════════
   SOCKET.IO (Chat en temps réel)
   ════════════════════════════════════════════════════════════ */
function initSocket() {
  if (!window.io) return;
  const token = localStorage.getItem('vc_admin_token');
  const SOCKET_URL = API.BASE.replace(/\/api$/, '');

  State.socket = window.io(`${SOCKET_URL}/admin`, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 5,
  });

  State.socket.on('connect', () => console.log('[Socket] Admin connecté'));

  State.socket.on('chat:session_updated', (data) => {
    const idx = State.chatSessions.findIndex(s => s.sessionId === data.sessionId);
    if (idx > -1) {
      Object.assign(State.chatSessions[idx], data);
    } else {
      State.chatSessions.unshift({ ...data, createdAt: new Date() });
    }
    renderChatList();
    updateChatBadge();

    // Notification si nouveau chat en attente
    if (data.status === 'waiting') {
      toast(`💬 Nouveau chat : ${data.clientName || 'Visiteur'}`, 'info', 5000);
    }
  });

  State.socket.on('chat:message', ({ sessionId, message }) => {
    if (State.currentChat?.sessionId === sessionId && message.sender === 'client') {
      appendChatMessage(message);
      updateChatMsgRead(sessionId);
    }
    const session = State.chatSessions.find(s => s.sessionId === sessionId);
    if (session) {
      session._lastMsg = message.content;
      if (State.currentView !== 'chat' || State.currentChat?.sessionId !== sessionId) {
        session._unread = (session._unread || 0) + 1;
      }
    }
    renderChatList();
    updateChatBadge();
  });

  State.socket.on('chat:client_typing', ({ sessionId, isTyping }) => {
    if (State.currentChat?.sessionId === sessionId) {
      const ti = $('chat-typing');
      if (ti) ti.classList.toggle('visible', isTyping);
    }
  });

  State.socket.on('chat:ended', ({ sessionId }) => {
    const s = State.chatSessions.find(s => s.sessionId === sessionId);
    if (s) s.status = 'ended';
    if (State.currentChat?.sessionId === sessionId) {
      appendSystemMsg('Ce chat a été clôturé.');
      const inp = $('chat-input-msg');
      const snd = $('chat-send-btn');
      if (inp) inp.disabled = true;
      if (snd) snd.disabled = true;
    }
    renderChatList();
    updateChatBadge();
  });
}

/* ════════════════════════════════════════════════════════════
   DASHBOARD
   ════════════════════════════════════════════════════════════ */
async function loadDashboard() {
  const container = $('dashboard-stats');
  if (!container) return;
  container.innerHTML = skeletonRows(2);

  try {
    const { kpis, recentApplications } = await API.dashboard.stats();
    renderDashboardStats(kpis);
    renderRecentRequests(recentApplications);
  } catch (err) {
    container.innerHTML = `<p class="p-16 color-red">${esc(err.message)}</p>`;
  }
}

function renderDashboardStats(kpis) {
  const c = $('dashboard-stats');
  if (!c) return;
  const trend = kpis.newApplicationsPrevMonth
    ? Math.round(((kpis.newApplicationsThisMonth - kpis.newApplicationsPrevMonth) / kpis.newApplicationsPrevMonth) * 100)
    : 0;
  const trendEl = trend >= 0
    ? `<span class="stat-trend stat-trend--up">↑ +${trend}% ce mois</span>`
    : `<span class="stat-trend stat-trend--down">↓ ${trend}% ce mois</span>`;

  c.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon stat-icon--navy">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div class="stat-value">${kpis.totalApplications}</div>
        <div class="stat-label">Total demandes</div>
        ${trendEl}
      </div>
      <div class="stat-card">
        <div class="stat-icon stat-icon--green">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>
        </div>
        <div class="stat-value">${fmtEur(kpis.totalFunded)}</div>
        <div class="stat-label">Total financé</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon stat-icon--gold">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div class="stat-value">${State.chatWaiting}</div>
        <div class="stat-label">Chats en attente</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon stat-icon--red">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 17H2a3 3 0 0 0 3-3V9a7 7 0 0 1 14 0v5a3 3 0 0 0 3 3zm-8.27 4a2 2 0 0 1-3.46 0"/></svg>
        </div>
        <div class="stat-value">${kpis.abandons24h}</div>
        <div class="stat-label">Abandons 24h</div>
      </div>
    </div>`;
}

function renderRecentRequests(items) {
  const c = $('recent-requests');
  if (!c) return;
  if (!items?.length) { c.innerHTML = '<p class="p-16 text-center" style="color:var(--muted)">Aucune demande récente</p>'; return; }
  c.innerHTML = `<div class="card">${items.slice(0, 5).map(r => `
    <div class="list-item" onclick="openRequestDetail('${r._id}')">
      <div class="list-avatar">${initials(r.firstname + ' ' + r.lastname)}</div>
      <div class="list-content">
        <div class="list-title">${esc(r.firstname)} ${esc(r.lastname)}</div>
        <div class="list-subtitle">${esc(LOAN_LABELS[r.loanType] || r.loanType)}</div>
      </div>
      <div class="list-right">
        <span class="badge ${STATUS_CLASSES[r.status] || ''}">${esc(STATUS_LABELS[r.status] || r.status)}</span>
        <span class="list-amount">${fmtEur(r.amount)}</span>
      </div>
    </div>`).join('')}</div>`;
}

/* ════════════════════════════════════════════════════════════
   DEMANDES
   ════════════════════════════════════════════════════════════ */
async function loadRequests() {
  const list = $('requests-list');
  if (!list) return;
  list.innerHTML = skeletonRows(6);

  try {
    const params = { page: 1, limit: 30 };
    if (State.requestFilter !== 'all') params.status = State.requestFilter;
    if (State.requestSearch) params.search = State.requestSearch;
    const { items } = await API.requests.list(params);
    State.requests = items;
    renderRequestsList();
  } catch (err) {
    list.innerHTML = `<p class="p-16 color-red">${esc(err.message)}</p>`;
  }
}

function renderRequestsList() {
  const c = $('requests-list');
  if (!c) return;
  const items = State.requests;
  if (!items.length) {
    c.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      <h3>Aucune demande</h3><p>Aucun résultat pour ce filtre.</p></div>`;
    return;
  }
  c.innerHTML = `<div class="card">${items.map(r => `
    <div class="list-item" onclick="openRequestDetail('${r._id}')">
      <div class="list-avatar">${initials(r.firstname + ' ' + r.lastname)}</div>
      <div class="list-content">
        <div class="list-title">${esc(r.firstname)} ${esc(r.lastname)}</div>
        <div class="list-subtitle">${esc(r.reference)} · ${esc(LOAN_LABELS[r.loanType] || r.loanType)}</div>
      </div>
      <div class="list-right">
        <span class="badge ${STATUS_CLASSES[r.status] || ''}">${esc(STATUS_LABELS[r.status] || r.status)}</span>
        <span class="list-amount">${fmtEur(r.amount)}</span>
        <span class="list-time">${fmtDate(r.createdAt)}</span>
      </div>
    </div>`).join('')}</div>`;
}

async function openRequestDetail(id) {
  openSheet('Chargement…', '<div style="text-align:center;padding:32px"><div class="skeleton" style="height:200px;border-radius:12px;"></div></div>');
  try {
    const r = await API.requests.get(id);
    const statusOptions = Object.entries(STATUS_LABELS).map(([val, lbl]) =>
      `<option value="${val}" ${r.status === val ? 'selected' : ''}>${lbl}</option>`).join('');

    openSheet(
      `<span class="badge ${STATUS_CLASSES[r.status]}">${esc(STATUS_LABELS[r.status])}</span> ${esc(r.firstname)} ${esc(r.lastname)}`,
      `<div class="info-row"><span class="info-label">Référence</span><span class="info-value fw-700">${esc(r.reference)}</span></div>
      <div class="info-row"><span class="info-label">Email</span><span class="info-value">${esc(r.email)}</span></div>
      <div class="info-row"><span class="info-label">Téléphone</span><span class="info-value">${esc(r.phone)}</span></div>
      <div class="info-row"><span class="info-label">Pays / Ville</span><span class="info-value">${esc(r.country)}, ${esc(r.city)}</span></div>
      <div class="divider"></div>
      <div class="info-row"><span class="info-label">Type de prêt</span><span class="info-value">${esc(LOAN_LABELS[r.loanType] || r.loanType)}</span></div>
      <div class="info-row"><span class="info-label">Montant</span><span class="info-value fw-700 color-green">${fmtEur(r.amount)}</span></div>
      <div class="info-row"><span class="info-label">Durée</span><span class="info-value">${r.duration} mois</span></div>
      <div class="info-row"><span class="info-label">Revenus</span><span class="info-value">${fmtEur(r.income)}/mois</span></div>
      <div class="info-row"><span class="info-label">Charges</span><span class="info-value">${fmtEur(r.charges || 0)}/mois</span></div>
      <div class="info-row"><span class="info-label">Profession</span><span class="info-value">${esc(r.profession)}</span></div>
      <div class="info-row"><span class="info-label">Date</span><span class="info-value">${fmtDate(r.createdAt)}</span></div>
      <div class="divider"></div>
      <div class="field-group mt-8">
        <label class="field-label">Changer le statut</label>
        <select class="field-select" id="detail-status">${statusOptions}</select>
      </div>
      <div class="field-group">
        <label class="field-label">Note admin</label>
        <textarea class="field-textarea" id="detail-note" placeholder="Ajoutez une note…">${esc(r.adminNote || '')}</textarea>
      </div>
      <div class="btn-row">
        <button class="btn btn--primary" onclick="saveRequestStatus('${r._id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
          Enregistrer
        </button>
        <button class="btn btn--outline" onclick="confirmDeleteRequest('${r._id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          Supprimer
        </button>
      </div>`
    );
  } catch (err) {
    toast(err.message, 'error');
    closeSheet();
  }
}

async function saveRequestStatus(id) {
  const status    = $('detail-status')?.value;
  const adminNote = $('detail-note')?.value;
  try {
    await API.requests.updateStatus(id, status, adminNote);
    toast('Statut mis à jour ✓', 'success');
    closeSheet();
    loadRequests();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function confirmDeleteRequest(id) {
  if (!confirm('Supprimer définitivement cette demande ?')) return;
  try {
    await API.requests.remove(id);
    toast('Demande supprimée', 'success');
    closeSheet();
    loadRequests();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ════════════════════════════════════════════════════════════
   CHAT
   ════════════════════════════════════════════════════════════ */
async function loadChatSessions() {
  const c = $('chat-sessions-list');
  if (!c) return;
  c.innerHTML = skeletonRows(4);
  try {
    const { items } = await API.chat.sessions({ limit: 30 });
    State.chatSessions = items;
    renderChatList();
    updateChatBadge();
    // Charger stats chat
    const stats = await API.chat.stats();
    State.chatWaiting = stats.waiting || 0;
  } catch (err) {
    c.innerHTML = `<p class="p-16 color-red">${esc(err.message)}</p>`;
  }
}

function renderChatList() {
  const c = $('chat-sessions-list');
  if (!c) return;

  let items = State.chatSessions;
  if (State.chatFilter !== 'all') items = items.filter(s => s.status === State.chatFilter);

  if (!items.length) {
    c.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <h3>Aucun chat</h3><p>Aucune session pour ce filtre.</p></div>`;
    return;
  }

  c.innerHTML = items.map(s => {
    const STATUS_CHAT = { waiting: '<span class="badge badge--waiting">En attente</span>', active: '<span class="badge badge--active">Actif</span>', ended: '<span class="badge badge--ended">Terminé</span>' };
    const unread = s._unread > 0 ? `<span class="nav-badge" style="position:static;margin-left:4px;">${s._unread}</span>` : '';
    return `
    <div class="chat-session-item" onclick="openChatSession('${s.sessionId}')">
      <div class="chat-avatar">${initials(s.clientName)}${s.status === 'active' ? '<div class="chat-online-dot"></div>' : ''}</div>
      <div class="chat-session-info">
        <div class="chat-session-name">${esc(s.clientName)} ${unread}</div>
        <div class="chat-session-preview">${esc(s._lastMsg || s.clientSubject || 'Support en ligne')}</div>
      </div>
      <div class="chat-session-meta">
        ${STATUS_CHAT[s.status] || ''}
        <span class="chat-session-time">${fmtTime(s.createdAt)}</span>
      </div>
    </div>`;
  }).join('');
}

function updateChatBadge() {
  const waiting = State.chatSessions.filter(s => s.status === 'waiting').length;
  const badge   = $('nav-badge-chat');
  if (badge) {
    badge.textContent = waiting || '';
    badge.style.display = waiting > 0 ? 'flex' : 'none';
  }
  State.chatWaiting = waiting;
}

async function openChatSession(sessionId) {
  State.currentChat = null;
  const mainContainer = $('view-chat');

  mainContainer.innerHTML = `
    <div class="chat-view-container">
      <div class="chat-subheader">
        <div style="display:flex;align-items:center;gap:10px;">
          <button class="btn btn--outline btn--sm" onclick="backToChatList()">← Retour</button>
          <div class="chat-client-info"><h4 id="chat-client-name">Chargement…</h4><p id="chat-client-meta"></p></div>
        </div>
        <button class="btn btn--danger btn--sm" id="btn-end-chat" onclick="endCurrentChat()">Clôturer</button>
      </div>
      <div class="chat-messages" id="chat-messages">
        <div class="typing-indicator" id="chat-typing"><div class="t-dot"></div><div class="t-dot"></div><div class="t-dot"></div><span style="font-size:12px;color:var(--muted);margin-left:6px;">client écrit…</span></div>
      </div>
      <div class="chat-input-bar">
        <textarea class="chat-msg-input" id="chat-input-msg" placeholder="Votre réponse…" rows="1"></textarea>
        <button class="btn-send-msg" id="chat-send-btn" onclick="sendChatMessage()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>`;

  try {
    const session = await API.chat.session(sessionId);
    State.currentChat = session;

    // Marquer unread à 0
    const s = State.chatSessions.find(s => s.sessionId === sessionId);
    if (s) s._unread = 0;
    updateChatBadge();

    $('chat-client-name').textContent = session.clientName;
    $('chat-client-meta').textContent = `${session.clientSubject || 'Support'} · ${fmtTime(session.startedAt)}`;

    if (session.status === 'ended') {
      $('btn-end-chat').disabled = true;
      $('chat-input-msg').disabled = true;
      $('chat-send-btn').disabled = true;
    }

    session.messages?.forEach(m => appendChatMessage(m));
    scrollChatBottom();

    // Rejoindre via socket
    if (State.socket) State.socket.emit('admin:join_chat', { sessionId });

  } catch (err) {
    toast(err.message, 'error');
    backToChatList();
  }
}

function backToChatList() {
  if (State.currentChat && State.socket) {
    State.socket.emit('admin:leave_chat', { sessionId: State.currentChat.sessionId });
  }
  State.currentChat = null;
  loadChatSessions();
  navigate('chat');
}

function appendChatMessage(msg) {
  const c = $('chat-messages');
  if (!c) return;
  const ti = $('chat-typing');

  if (msg.sender === 'system') {
    const e = el('div', 'msg-wrap system');
    e.innerHTML = `<div class="msg-bubble">${esc(msg.content)}</div>`;
    c.insertBefore(e, ti);
  } else {
    const time = fmtTime(msg.timestamp || new Date());
    const e = el('div', `msg-wrap ${msg.sender}`);
    if (msg.sender === 'client') {
      e.innerHTML = `<span class="msg-time">${esc(msg.senderName || 'Client')}</span><div class="msg-bubble">${esc(msg.content)}</div><span class="msg-time">${time}</span>`;
    } else {
      e.innerHTML = `<div class="msg-bubble">${esc(msg.content)}</div><span class="msg-time">${time}</span>`;
    }
    c.insertBefore(e, ti);
  }
  scrollChatBottom();
}

function appendSystemMsg(text) {
  appendChatMessage({ sender: 'system', content: text });
}

function scrollChatBottom() {
  const c = $('chat-messages');
  if (c) requestAnimationFrame(() => { c.scrollTop = c.scrollHeight; });
}

function updateChatMsgRead(sessionId) {
  if (State.socket) State.socket.emit('admin:read_messages', { sessionId });
}

let chatTypingTimer = null;
function sendChatMessage() {
  const input   = $('chat-input-msg');
  const content = input?.value?.trim();
  if (!content || !State.currentChat || !State.socket) return;

  State.socket.emit('admin:message', {
    sessionId: State.currentChat.sessionId,
    content,
    adminName: State.admin?.name || 'Conseiller Veloce Capital',
  });

  // Affichage optimiste immédiat
  appendChatMessage({ sender: 'admin', content, senderName: State.admin?.name, timestamp: new Date() });

  input.value = '';
  input.style.height = 'auto';
  State.socket.emit('admin:typing', { sessionId: State.currentChat.sessionId, isTyping: false });
  clearTimeout(chatTypingTimer);
}

async function endCurrentChat() {
  if (!State.currentChat) return;
  if (!confirm('Clôturer ce chat ? Un récapitulatif sera envoyé au client.')) return;
  if (State.socket) {
    State.socket.emit('admin:end_chat', { sessionId: State.currentChat.sessionId });
  } else {
    try { await API.chat.end(State.currentChat.sessionId); } catch {}
  }
}

/* ════════════════════════════════════════════════════════════
   CONTENU & SERVICES (Vue "Contenu")
   ════════════════════════════════════════════════════════════ */
async function loadContent() {
  // Charge l'onglet actif (contenu ou services)
  const tab = State.contentTab || 'content';
  if (tab === 'content') await loadContentItems();
  else await loadServices();
}

async function loadContentItems() {
  const c = $('content-list');
  if (!c) return;
  c.innerHTML = skeletonRows(5);
  try {
    const items = await API.content.list({ lang: 'fr' });
    State.contentItems = items;
    renderContentList();
  } catch (err) {
    c.innerHTML = `<p class="p-16 color-red">${esc(err.message)}</p>`;
  }
}

function renderContentList() {
  const c = $('content-list');
  if (!c) return;
  if (!State.contentItems.length) {
    c.innerHTML = `<div class="empty-state"><h3>Aucun contenu</h3><p>Le CMS est vide.</p></div>`;
    return;
  }
  const grouped = {};
  State.contentItems.forEach(item => {
    const sec = item.section || 'general';
    if (!grouped[sec]) grouped[sec] = [];
    grouped[sec].push(item);
  });
  c.innerHTML = Object.entries(grouped).map(([sec, items]) => `
    <div class="page-section">
      <div class="section-title">${esc(sec)}</div>
      <div class="card">${items.map(item => `
        <div class="content-item" onclick="editContent('${item._id}')">
          <div class="content-key">${esc(item.key)} <span style="color:var(--border)">|</span> ${esc(item.lang)}</div>
          <div class="content-val">${esc(item.value)}</div>
        </div>`).join('')}
      </div>
    </div>`).join('');
}

function editContent(id) {
  const item = State.contentItems.find(i => i._id === id);
  if (!item) return;
  openSheet(
    `Modifier le contenu`,
    `<div class="field-group">
      <label class="field-label">Clé</label>
      <input class="field-input" value="${esc(item.key)}" disabled style="opacity:0.5">
    </div>
    <div class="field-group">
      <label class="field-label">Langue</label>
      <input class="field-input" value="${esc(item.lang)}" disabled style="opacity:0.5">
    </div>
    <div class="field-group">
      <label class="field-label">Valeur</label>
      <textarea class="field-textarea" id="edit-content-val" style="min-height:140px">${esc(item.value)}</textarea>
    </div>
    <button class="btn btn--primary btn--full" onclick="saveContent('${id}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
      Enregistrer
    </button>`
  );
}

async function saveContent(id) {
  const value = $('edit-content-val')?.value;
  try {
    await API.content.update(id, { value });
    const idx = State.contentItems.findIndex(i => i._id === id);
    if (idx > -1) State.contentItems[idx].value = value;
    toast('Contenu mis à jour ✓', 'success');
    closeSheet();
    renderContentList();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadServices() {
  const c = $('services-list');
  if (!c) return;
  c.innerHTML = skeletonRows(4);
  try {
    const items = await API.services.list();
    State.services = items;
    renderServicesList();
  } catch (err) {
    c.innerHTML = `<p class="p-16 color-red">${esc(err.message)}</p>`;
  }
}

function renderServicesList() {
  const c = $('services-list');
  if (!c) return;
  if (!State.services.length) { c.innerHTML = '<div class="empty-state"><h3>Aucune offre</h3></div>'; return; }
  c.innerHTML = `<div class="card">${State.services.map(s => `
    <div class="service-card" onclick="editService('${s._id}')">
      <div class="service-dot ${s.isActive ? 'on' : 'off'}"></div>
      <div class="service-info">
        <div class="service-name">${esc(s.name)}</div>
        <div class="service-rate">TAEG ${s.rateMin}% – ${s.rateMax || '...'}%</div>
      </div>
      <div class="service-amount">${fmtEur(s.amountMin)} – ${fmtEur(s.amountMax)}</div>
    </div>`).join('')}</div>`;
}

function editService(id) {
  const s = State.services.find(i => i._id === id);
  if (!s) return;
  openSheet(
    `Offre : ${esc(s.name)}`,
    `<div class="info-row"><span class="info-label">Statut</span>
      <button class="btn btn--sm ${s.isActive ? 'btn--danger' : 'btn--primary'}" onclick="toggleService('${s._id}')">
        ${s.isActive ? 'Désactiver' : 'Activer'}
      </button>
    </div>
    <div class="field-group mt-16">
      <label class="field-label">Taux min (TAEG %)</label>
      <input class="field-input" id="svc-rate-min" type="number" step="0.1" value="${s.rateMin}">
    </div>
    <div class="field-group">
      <label class="field-label">Taux max (TAEG %)</label>
      <input class="field-input" id="svc-rate-max" type="number" step="0.1" value="${s.rateMax || ''}">
    </div>
    <div class="field-group">
      <label class="field-label">Montant min (€)</label>
      <input class="field-input" id="svc-amt-min" type="number" value="${s.amountMin}">
    </div>
    <div class="field-group">
      <label class="field-label">Montant max (€)</label>
      <input class="field-input" id="svc-amt-max" type="number" value="${s.amountMax}">
    </div>
    <div class="field-group">
      <label class="field-label">Description</label>
      <textarea class="field-textarea" id="svc-desc">${esc(s.description || '')}</textarea>
    </div>
    <button class="btn btn--primary btn--full mt-8" onclick="saveService('${s._id}')">Enregistrer</button>`
  );
}

async function toggleService(id) {
  try {
    const res = await API.services.toggle(id);
    const s = State.services.find(i => i._id === id);
    if (s) s.isActive = res.isActive;
    toast(`Offre ${res.isActive ? 'activée' : 'désactivée'} ✓`, 'success');
    closeSheet();
    renderServicesList();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function saveService(id) {
  const data = {
    rateMin:    parseFloat($('svc-rate-min')?.value),
    rateMax:    parseFloat($('svc-rate-max')?.value) || null,
    amountMin:  parseInt($('svc-amt-min')?.value),
    amountMax:  parseInt($('svc-amt-max')?.value),
    description: $('svc-desc')?.value,
  };
  try {
    await API.services.update(id, data);
    const idx = State.services.findIndex(i => i._id === id);
    if (idx > -1) Object.assign(State.services[idx], data);
    toast('Offre mise à jour ✓', 'success');
    closeSheet();
    renderServicesList();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ════════════════════════════════════════════════════════════
   PLUS — Médiathèque + Paramètres
   ════════════════════════════════════════════════════════════ */
function loadMore() {
  updateProfile();
}

async function loadMediaView() {
  const c = $('media-grid-container');
  if (!c) return;
  c.innerHTML = '<p class="p-16 text-center" style="color:var(--muted)">Chargement…</p>';
  try {
    const { items } = await API.media.list({ limit: 60 });
    State.mediaItems = items;
    renderMediaGrid();
  } catch (err) {
    c.innerHTML = `<p class="p-16 color-red">${esc(err.message)}</p>`;
  }
}

function renderMediaGrid() {
  const c = $('media-grid-container');
  if (!c) return;
  const upload = `<label class="media-upload-btn" for="media-upload-input">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    Ajouter</label>
    <input type="file" id="media-upload-input" accept="image/*" style="display:none" onchange="handleMediaUpload(this)">`;

  c.innerHTML = `<div class="media-grid">${upload}${State.mediaItems.map(m => `
    <div class="media-thumb" onclick="previewMedia('${m._id}')">
      <img src="${esc(m.url)}" alt="${esc(m.alt)}" loading="lazy">
    </div>`).join('')}</div>`;
}

async function handleMediaUpload(input) {
  const file = input.files?.[0];
  if (!file) return;
  toast('Upload en cours…', 'info');
  try {
    const media = await API.media.upload(file);
    State.mediaItems.unshift(media);
    renderMediaGrid();
    toast('Image uploadée ✓', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
  input.value = '';
}

function previewMedia(id) {
  const m = State.mediaItems.find(i => i._id === id);
  if (!m) return;
  openSheet(
    'Aperçu média',
    `<img src="${esc(m.url)}" alt="${esc(m.alt)}" style="width:100%;border-radius:var(--radius-md);display:block;margin-bottom:16px">
    <div class="info-row"><span class="info-label">Fichier</span><span class="info-value">${esc(m.originalName)}</span></div>
    <div class="info-row"><span class="info-label">Taille</span><span class="info-value">${(m.size / 1024).toFixed(0)} Ko</span></div>
    <div class="info-row"><span class="info-label">URL</span><span class="info-value" style="font-size:11px;word-break:break-all;">${esc(m.url)}</span></div>
    <div class="field-group mt-16">
      <label class="field-label">Texte alternatif (SEO)</label>
      <input class="field-input" id="media-alt" value="${esc(m.alt || '')}">
    </div>
    <div class="btn-row">
      <button class="btn btn--primary" onclick="saveMediaAlt('${id}')">Enregistrer alt</button>
      <button class="btn btn--danger" onclick="deleteMedia('${id}')">Supprimer</button>
    </div>`
  );
}

async function saveMediaAlt(id) {
  try {
    await API.media.update(id, $('media-alt')?.value);
    toast('Alt mis à jour ✓', 'success');
    closeSheet();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteMedia(id) {
  if (!confirm('Supprimer ce fichier définitivement ?')) return;
  try {
    await API.media.remove(id);
    State.mediaItems = State.mediaItems.filter(m => m._id !== id);
    toast('Fichier supprimé', 'success');
    closeSheet();
    renderMediaGrid();
  } catch (err) { toast(err.message, 'error'); }
}

function openChangePassword() {
  openSheet(
    'Modifier le mot de passe',
    `<div class="field-group">
      <label class="field-label">Mot de passe actuel</label>
      <input class="field-input" type="password" id="pwd-current" placeholder="••••••••">
    </div>
    <div class="field-group">
      <label class="field-label">Nouveau mot de passe</label>
      <input class="field-input" type="password" id="pwd-new" placeholder="8 caractères minimum">
    </div>
    <button class="btn btn--primary btn--full mt-8" onclick="saveNewPassword()">Modifier</button>`
  );
}

async function saveNewPassword() {
  const cur = $('pwd-current')?.value;
  const nw  = $('pwd-new')?.value;
  if (!cur || !nw || nw.length < 8) { toast('Remplissez les deux champs (8 caractères min)', 'error'); return; }
  try {
    await API.auth.changePassword(cur, nw);
    toast('Mot de passe modifié ✓', 'success');
    closeSheet();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openApiConfig() {
  openSheet(
    'Configuration API',
    `<p style="font-size:13px;color:var(--muted);margin-bottom:16px;">URL du serveur backend Veloce Capital</p>
    <div class="field-group">
      <label class="field-label">URL API</label>
      <input class="field-input" type="url" id="api-url-input" value="${esc(API.BASE)}" placeholder="https://api.votredomaine.com/api">
    </div>
    <button class="btn btn--primary btn--full mt-8" onclick="saveApiUrl()">Enregistrer et relancer</button>`
  );
}

function saveApiUrl() {
  const val = $('api-url-input')?.value?.trim();
  if (!val) return;
  localStorage.setItem('vc_api_url', val);
  toast('URL sauvegardée. Rechargement…', 'success');
  setTimeout(() => location.reload(), 1200);
}

/* ════════════════════════════════════════════════════════════
   INITIALISATION
   ════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  /* Appliquer l'URL API personnalisée si sauvegardée */
  const savedUrl = localStorage.getItem('vc_api_url');
  if (savedUrl) window.VC_API_URL = savedUrl;

  /* Cacher le splash après 1s */
  setTimeout(() => $('app-splash')?.classList.add('hidden'), 800);
  setTimeout(() => { const s = $('app-splash'); if (s) s.style.display = 'none'; }, 1300);

  /* Auth */
  await checkAuth();

  /* Login form */
  $('login-form')?.addEventListener('submit', handleLogin);

  /* Bottom nav */
  ['dashboard', 'requests', 'chat', 'content', 'more'].forEach(view => {
    $(`nav-${view}`)?.addEventListener('click', () => navigate(view));
  });

  /* Sheet overlay click → fermer */
  $('sheet-overlay')?.addEventListener('click', closeSheet);
  $('sheet-close-btn')?.addEventListener('click', closeSheet);

  /* Chat input enter */
  document.addEventListener('keydown', e => {
    const input = $('chat-input-msg');
    if (e.target === input && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
    if (e.target === input && State.currentChat && State.socket) {
      State.socket.emit('admin:typing', { sessionId: State.currentChat.sessionId, isTyping: true });
      clearTimeout(chatTypingTimer);
      chatTypingTimer = setTimeout(() => {
        if (State.currentChat && State.socket)
          State.socket.emit('admin:typing', { sessionId: State.currentChat.sessionId, isTyping: false });
      }, 2000);
    }
  });

  /* Content tabs */
  $('tab-content')?.addEventListener('click', () => { State.contentTab = 'content'; setContentTab('content'); loadContentItems(); });
  $('tab-services')?.addEventListener('click', () => { State.contentTab = 'services'; setContentTab('services'); loadServices(); });
  $('tab-media')?.addEventListener('click', () => { State.contentTab = 'media'; setContentTab('media'); loadMediaView(); });

  /* Requests filter chips */
  document.querySelectorAll('[data-req-filter]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-req-filter]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      State.requestFilter = chip.dataset.reqFilter;
      loadRequests();
    });
  });

  /* Requests search */
  let searchTimer;
  $('req-search')?.addEventListener('input', e => {
    clearTimeout(searchTimer);
    State.requestSearch = e.target.value;
    searchTimer = setTimeout(loadRequests, 400);
  });

  /* Chat filter chips */
  document.querySelectorAll('[data-chat-filter]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-chat-filter]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      State.chatFilter = chip.dataset.chatFilter;
      renderChatList();
    });
  });

  /* PWA install */
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = $('btn-install');
    if (btn) btn.style.display = 'flex';
  });
  $('btn-install')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') toast('Application installée ✓', 'success');
    deferredPrompt = null;
  });

  /* Service Worker */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
});

function setContentTab(tab) {
  ['content', 'services', 'media'].forEach(t => {
    const btn = $(`tab-${t}`);
    const panel = $(`panel-${t}`);
    if (btn) btn.classList.toggle('active', t === tab);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
  });
}

/* Exposer les fonctions nécessaires aux handlers inline */
window.openRequestDetail = openRequestDetail;
window.saveRequestStatus = saveRequestStatus;
window.confirmDeleteRequest = confirmDeleteRequest;
window.openChatSession = openChatSession;
window.backToChatList = backToChatList;
window.sendChatMessage = sendChatMessage;
window.endCurrentChat = endCurrentChat;
window.editContent = editContent;
window.saveContent = saveContent;
window.editService = editService;
window.toggleService = toggleService;
window.saveService = saveService;
window.handleMediaUpload = handleMediaUpload;
window.previewMedia = previewMedia;
window.saveMediaAlt = saveMediaAlt;
window.deleteMedia = deleteMedia;
window.openChangePassword = openChangePassword;
window.saveNewPassword = saveNewPassword;
window.openApiConfig = openApiConfig;
window.saveApiUrl = saveApiUrl;
window.logout = logout;
window.closeSheet = closeSheet;
