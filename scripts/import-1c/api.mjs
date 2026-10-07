// Клиент Go BFF для загрузчика 1С: логин по email/паролю (из окружения),
// обновление токена на 401, таймаут 5 минут (потолок chi.Timeout сервера),
// повтор только для GET. Ошибки RFC 7807 превращаются в Error со статусом.

const TIMEOUT_MS = 300_000;
const GET_RETRIES = 3;

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class HubApi {
  constructor({ baseUrl, email, password }) {
    if (!baseUrl) throw new Error('TENDERHUB_API_URL не задан');
    if (!email || !password) throw new Error('TENDERHUB_EMAIL / TENDERHUB_PASSWORD не заданы');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.email = email;
    this.password = password;
    this.access = null;
    this.refresh = null;
  }

  async login() {
    const res = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });
    if (!res.ok) throw new ApiError(res.status, `вход не выполнен (HTTP ${res.status})`);
    const p = await res.json();
    this.access = p.access_token;
    this.refresh = p.refresh_token ?? null;
  }

  async refreshTokens() {
    if (!this.refresh) return this.login();
    const res = await fetch(`${this.baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.refresh }),
    });
    if (!res.ok) return this.login();
    const p = await res.json();
    this.access = p.access_token;
    this.refresh = p.refresh_token ?? this.refresh;
    return undefined;
  }

  async call(method, path, body, { retried = false, attempt = 1 } = {}) {
    if (!this.access) await this.login();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.access}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (method === 'GET' && attempt < GET_RETRIES) {
        await sleep(1000 * attempt);
        return this.call(method, path, body, { retried, attempt: attempt + 1 });
      }
      throw new ApiError(0, `${method} ${path}: сеть — ${err.message}`);
    }
    clearTimeout(timer);
    if (res.status === 401 && !retried) {
      await this.refreshTokens();
      return this.call(method, path, body, { retried: true, attempt });
    }
    if (res.status >= 500 && method === 'GET' && attempt < GET_RETRIES) {
      await sleep(1000 * attempt);
      return this.call(method, path, body, { retried, attempt: attempt + 1 });
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const detail = json?.detail ?? json?.title ?? text.slice(0, 300);
      throw new ApiError(res.status, `${method} ${path}: HTTP ${res.status} — ${detail}`, json);
    }
    return json;
  }

  get(path) { return this.call('GET', path); }
  post(path, body) { return this.call('POST', path, body); }
  patch(path, body) { return this.call('PATCH', path, body); }
  del(path) { return this.call('DELETE', path); }

  /** Все страницы курсорного списка {data, next_cursor}. */
  async getAllPages(path) {
    const out = [];
    let cursor = '';
    for (;;) {
      const sep = path.includes('?') ? '&' : '?';
      const page = await this.get(`${path}${sep}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      out.push(...(page?.data ?? []));
      if (!page?.next_cursor) return out;
      cursor = page.next_cursor;
    }
  }

  // ─── Справочники ───────────────────────────────────────────────────────────
  listTenders() { return this.getAllPages('/api/v1/tenders'); }
  async listUnits() { return (await this.get('/api/v1/nomenclatures/units')).data ?? []; }
  async listNames(kind) { return (await this.get(`/api/v1/nomenclatures/${kind}-names`)).data ?? []; }
  createName(kind, name, unit) { return this.post(`/api/v1/nomenclatures/${kind}-names`, { name, unit }); }
  importUnits(units) { return this.post('/api/v1/units/import-batch', { units }); }
  async listCostCategories() { return (await this.get('/api/v1/cost-categories')).data ?? []; }
  async listDetailCostCategories() { return (await this.get('/api/v1/detail-cost-categories')).data ?? []; }
  async listRegistry() { return (await this.get('/api/v1/tender-registry')).data ?? []; }
  patchRegistry(id, fields) { return this.patch(`/api/v1/tender-registry/${id}/fields`, fields); }
  async listProjects() { return (await this.get('/api/v1/projects')).data ?? []; }
  async listTimelineGroups(tenderId) { return (await this.get(`/api/v1/timeline/tenders/${tenderId}/groups`)).data ?? []; }

  // ─── Тендер, позиции, импорт ───────────────────────────────────────────────
  async createTender(body) { return (await this.post('/api/v1/tenders', body)).data; }
  adminPatchTender(id, patch) { return this.patch(`/api/v1/tenders/${id}/admin-fields`, patch); }
  deleteTender(id) { return this.del(`/api/v1/tenders/${id}`); }
  bulkPositions(tenderId, positions) { return this.post('/api/v1/positions/bulk', { tender_id: tenderId, positions }); }
  listPositions(tenderId) { return this.getAllPages(`/api/v1/tenders/${tenderId}/positions`); }
  importBoq(payload) { return this.post('/api/v1/imports/boq', payload); }
}
