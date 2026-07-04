/* ============================================================
   api.js — Client API Veloce Capital Admin Mobile
   Tous les appels backend centralisés ici
   ============================================================ */

const API = (() => {
  // ── Configuration ──────────────────────────────────────────
  // Modifiez cette URL pour pointer vers votre serveur backend
  const BASE = window.VC_API_URL || 'http://localhost:3000/api';

  const token = () => localStorage.getItem('vc_admin_token') || '';

  const headers = (extra = {}) => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token()}`,
    ...extra,
  });

  async function request(method, path, body = null) {
    const opts = { method, headers: headers() };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${BASE}${path}`, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Erreur ${res.status}`);
    return data;
  }

  const get    = (path)        => request('GET',    path);
  const post   = (path, body)  => request('POST',   path, body);
  const patch  = (path, body)  => request('PATCH',  path, body);
  const put    = (path, body)  => request('PUT',    path, body);
  const del    = (path)        => request('DELETE', path);

  // ── Auth ────────────────────────────────────────────────────
  const auth = {
    login:          (email, password)   => post('/admin/login', { email, password }),
    me:             ()                  => get('/admin/me'),
    logout:         ()                  => post('/admin/logout'),
    changePassword: (currentPassword, newPassword) =>
      patch('/admin/me/password', { currentPassword, newPassword }),
  };

  // ── Dashboard ───────────────────────────────────────────────
  const dashboard = {
    stats: () => get('/admin/dashboard'),
  };

  // ── Demandes de prêt ─────────────────────────────────────────
  const requests = {
    list:         (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return get(`/admin/requests${q ? '?' + q : ''}`);
    },
    get:          (id)           => get(`/admin/requests/${id}`),
    updateStatus: (id, status, adminNote) =>
      patch(`/admin/requests/${id}/status`, { status, adminNote }),
    updateNote:   (id, adminNote) =>
      patch(`/admin/requests/${id}/note`, { adminNote }),
    remove:       (id)           => del(`/admin/requests/${id}`),
    exportCSV:    ()             => `${BASE}/admin/requests/export?token=${token()}`,
  };

  // ── Chat ─────────────────────────────────────────────────────
  const chat = {
    sessions: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return get(`/admin/chat/sessions${q ? '?' + q : ''}`);
    },
    session:  (sessionId)   => get(`/admin/chat/sessions/${sessionId}`),
    end:      (sessionId)   => patch(`/admin/chat/sessions/${sessionId}/end`),
    remove:   (sessionId)   => del(`/admin/chat/sessions/${sessionId}`),
    stats:    ()            => get('/admin/chat/stats'),
  };

  // ── Services (offres de prêts) ────────────────────────────────
  const services = {
    list:   ()         => get('/admin/services'),
    get:    (id)       => get(`/admin/services/${id}`),
    create: (data)     => post('/admin/services', data),
    update: (id, data) => put(`/admin/services/${id}`, data),
    toggle: (id)       => patch(`/admin/services/${id}/toggle`),
    remove: (id)       => del(`/admin/services/${id}`),
  };

  // ── Contenu CMS ───────────────────────────────────────────────
  const content = {
    list:   (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return get(`/admin/content${q ? '?' + q : ''}`);
    },
    get:    (id)        => get(`/admin/content/${id}`),
    upsert: (data)      => put('/admin/content/upsert', data),
    update: (id, data)  => put(`/admin/content/${id}`, data),
    remove: (id)        => del(`/admin/content/${id}`),
  };

  // ── Médias ────────────────────────────────────────────────────
  const media = {
    list:   (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return get(`/admin/media${q ? '?' + q : ''}`);
    },
    upload: async (file, alt = '') => {
      const form = new FormData();
      form.append('file', file);
      if (alt) form.append('alt', alt);
      const res = await fetch(`${BASE}/admin/media/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token()}` },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Erreur upload');
      return data;
    },
    update: (id, alt)   => patch(`/admin/media/${id}`, { alt }),
    remove: (id)        => del(`/admin/media/${id}`),
  };

  return { auth, dashboard, requests, chat, services, content, media, BASE };
})();
