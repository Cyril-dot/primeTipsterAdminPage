/* ═══════════════════════════════════════════════════════
   GStake Admin — API Integration Layer
   ═══════════════════════════════════════════════════════ */

const API_BASE          = 'https://kikiwebbackend-iysi.onrender.com/api/v1';
const ADMIN_API         = 'https://kikiwebbackend-iysi.onrender.com/api/v1/admin';
const CORRECT_SCORE_API = 'https://kikiwebbackend-iysi.onrender.com/api/admin/correct-score';

/* ── Auth helpers ── */

function getToken() {
  return localStorage.getItem('gstake_admin_token')
      || localStorage.getItem('gstake_token')
      || null;
}

function getAdminData() {
  try {
    return JSON.parse(
      localStorage.getItem('gstake_admin') ||
      localStorage.getItem('gstake_user') ||
      '{}'
    );
  } catch {
    return {};
  }
}

function requireAuth() {
  const token = getToken();
  if (!token) {
    window.location.href = 'admin-login.html';
    return false;
  }
  return true;
}

/* ── Core fetch wrapper ── */
async function apiFetch(url, options = {}) {
  const token = getToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  console.debug('[apiFetch]', options.method || 'GET', url,
    token ? '(token present)' : '⚠️ NO TOKEN');

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem('gstake_admin_token');
    localStorage.removeItem('gstake_admin');
    window.location.href = 'admin-login.html';
    throw new Error('Session expired. Please sign in again.');
  }

  // DELETE often returns 200 with no body — handle gracefully
  const text = await res.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = {}; }
  }

  if (!res.ok) {
    console.error('[apiFetch] error response:', data, '| raw:', text);

    let detail = '';
    if (data.data && typeof data.data === 'object') {
      detail = Object.entries(data.data)
        .map(([field, msg]) => `${field}: ${msg}`)
        .join('; ');
    }

    const message = data.message || data.error || `Request failed (${res.status})`;
    throw new Error(detail ? `${message} — ${detail}` : message);
  }

  return data.data !== undefined ? data.data : data;
}

/* ══════════════════════════════════════════════════════
   AUTH
══════════════════════════════════════════════════════ */

/** POST /api/v1/admin/login */
async function apiAdminLogin(email, password) {
  const data = await apiFetch(`${ADMIN_API}/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  localStorage.setItem('gstake_admin_token', data.token);
  localStorage.setItem('gstake_admin', JSON.stringify(data));
  return data;
}

/** POST /api/v1/admin/register */
async function apiAdminRegister(fullName, email, password) {
  return apiFetch(`${ADMIN_API}/register`, {
    method: 'POST',
    body: JSON.stringify({ fullName, email, password }),
  });
}

/** GET /api/v1/admin/me */
async function apiGetMyProfile() {
  return apiFetch(`${ADMIN_API}/me`);
}

/* ══════════════════════════════════════════════════════
   USERS
══════════════════════════════════════════════════════ */

/** GET /api/v1/admin/users */
async function apiGetAllUsers() {
  return apiFetch(`${ADMIN_API}/users`);
}

/** GET /api/v1/admin/users/{userId} */
async function apiGetUserById(userId) {
  return apiFetch(`${ADMIN_API}/users/${userId}`);
}

/* ══════════════════════════════════════════════════════
   GAMES
══════════════════════════════════════════════════════ */

/** GET /api/v1/admin/games */
async function apiGetAllGames() {
  return apiFetch(`${ADMIN_API}/games`);
}

/** GET /api/v1/games/public/{gameId} */
async function apiGetGameById(gameId) {
  return apiFetch(`${API_BASE}/games/public/${gameId}`);
}

/** POST /api/v1/admin/games */
async function apiAddGame(payload) {
  return apiFetch(`${ADMIN_API}/games`, {
    method: 'POST',
    body: JSON.stringify(normaliseGamePayload(payload)),
  });
}

/** PATCH /api/v1/admin/games/{gameId} */
async function apiUpdateGame(gameId, payload) {
  // Only send fields the backend UpdateGameRequest DTO accepts
  const { homeTeam, awayTeam, matchDate, bookingCode,
          oddsHomeWin, oddsDraw, oddsAwayWin } = payload;

  const clean = { homeTeam, awayTeam, matchDate, oddsHomeWin, oddsDraw, oddsAwayWin };
  if (bookingCode) clean.bookingCode = bookingCode;

  return apiFetch(`${ADMIN_API}/games/${gameId}`, {
    method: 'PATCH',
    body: JSON.stringify(normaliseGamePayload(clean)),
  });
}

/** PATCH /api/v1/admin/games/{gameId}/status?status=LIVE */
async function apiUpdateGameStatus(gameId, status) {
  return apiFetch(`${ADMIN_API}/games/${gameId}/status?status=${status}`, {
    method: 'PATCH',
  });
}

/**
 * DELETE /api/v1/admin/games/{gameId}
 * Backend: wipes betSelections first, then deletes game — safe for any status.
 */
async function apiDeleteGame(gameId) {
  if (!gameId) throw new Error('No gameId provided to apiDeleteGame');
  console.debug('[apiDeleteGame] deleting:', gameId);
  return apiFetch(`${ADMIN_API}/games/${gameId}`, { method: 'DELETE' });
}

/**
 * Delete every game sequentially.
 * Returns { deleted, failed, errors[] }
 */
async function apiDeleteAllGames(games, onProgress) {
  let deleted = 0, failed = 0;
  const errors = [];

  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    if (onProgress) onProgress(i + 1, games.length, g);
    try {
      await apiDeleteGame(g.id);
      deleted++;
    } catch (err) {
      failed++;
      errors.push({ game: g, message: err.message });
      console.warn('[apiDeleteAllGames] failed for', g.id, err.message);
    }
  }

  return { deleted, failed, errors };
}

/** POST /api/v1/admin/games/{gameId}/result */
async function apiEnterResult(gameId, homeScore, awayScore) {
  return apiFetch(`${ADMIN_API}/games/${gameId}/result`, {
    method: 'POST',
    body: JSON.stringify({ homeScore, awayScore }),
  });
}

/** POST /api/v1/admin/games/{gameId}/cancel */
async function apiCancelGame(gameId) {
  return apiFetch(`${ADMIN_API}/games/${gameId}/cancel`, { method: 'POST' });
}

/**
 * Normalise a game payload:
 *  - matchDate → full "YYYY-MM-DDTHH:mm:ss" (Spring LocalDateTime format)
 *  - odds      → floats, not strings
 *  - bookingCode → omit if empty (backend auto-generates)
 */
function normaliseGamePayload(payload) {
  const p = { ...payload };

  if (p.matchDate) {
    p.matchDate = p.matchDate.replace('Z', '').split('.')[0];
    if (p.matchDate.length === 16) p.matchDate += ':00';
  }

  ['oddsHomeWin', 'oddsDraw', 'oddsAwayWin'].forEach(k => {
    if (p[k] !== undefined && p[k] !== null) p[k] = parseFloat(p[k]);
  });

  if (!p.bookingCode) delete p.bookingCode;

  return p;
}

/* ══════════════════════════════════════════════════════
   CORRECT SCORE MARKET
══════════════════════════════════════════════════════ */

/** POST /api/admin/correct-score/{gameId}/generate */
async function apiGenerateCSOptions(gameId) {
  return apiFetch(`${CORRECT_SCORE_API}/${gameId}/generate`, { method: 'POST' });
}

/** POST /api/admin/correct-score/{gameId}/lock */
async function apiLockCSMarket(gameId) {
  return apiFetch(`${CORRECT_SCORE_API}/${gameId}/lock`, { method: 'POST' });
}

/** POST /api/admin/correct-score/{gameId}/reveal */
async function apiRevealCSMarket(gameId, homeScore, awayScore) {
  return apiFetch(`${CORRECT_SCORE_API}/${gameId}/reveal`, {
    method: 'POST',
    body: JSON.stringify({ homeScore, awayScore }),
  });
}

/* ══════════════════════════════════════════════════════
   BET SLIPS
══════════════════════════════════════════════════════ */

/** GET /api/v1/bets/slip/{reference} */
async function apiGetSlipByReference(reference) {
  return apiFetch(`${API_BASE}/bets/slip/${reference}`);
}

/* ══════════════════════════════════════════════════════
   WALLET / TRANSACTIONS
══════════════════════════════════════════════════════ */

/** GET /api/v1/wallet/transactions */
async function apiGetTransactions() {
  return apiFetch(`${API_BASE}/wallet/transactions`);
}

/* ══════════════════════════════════════════════════════
   LOGOUT
══════════════════════════════════════════════════════ */
function adminLogout() {
  localStorage.removeItem('gstake_admin_token');
  localStorage.removeItem('gstake_admin');
  window.location.href = 'admin-login.html';
}
