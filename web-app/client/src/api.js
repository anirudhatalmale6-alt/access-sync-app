const BASE = '/api';

async function request(url, options = {}) {
  const res = await fetch(BASE + url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || body.message || `HTTP ${res.status}`);
  }

  // Handle CSV downloads
  if (res.headers.get('content-type')?.includes('text/csv')) {
    return res.blob();
  }

  return res.json();
}

export const api = {
  // Tables
  getTables: () => request('/tables'),
  getTableData: (name, params = {}) => {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', params.page);
    if (params.limit) qs.set('limit', params.limit);
    if (params.sort) qs.set('sort', params.sort);
    if (params.order) qs.set('order', params.order);
    if (params.search) qs.set('search', params.search);
    if (params.filters) qs.set('filters', JSON.stringify(params.filters));
    const q = qs.toString();
    return request(`/tables/${encodeURIComponent(name)}${q ? '?' + q : ''}`);
  },
  getTableSchema: (name) => request(`/tables/${encodeURIComponent(name)}/schema`),
  exportTableCSV: (name) => {
    // Direct download via link
    const a = document.createElement('a');
    a.href = `${BASE}/tables/${encodeURIComponent(name)}/export/csv`;
    a.download = `${name}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  // Sync
  getSyncStatus: () => request('/sync/status'),
  getSyncLog: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', params.page);
    if (params.limit) qs.set('limit', params.limit);
    return request('/sync/log?' + qs.toString());
  },
  triggerSync: () => request('/sync/trigger', { method: 'POST' }),

  // Settings
  getSettings: () => request('/settings'),
  updateSettings: (data) => request('/settings', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  testConnection: () => request('/settings/test-connection', { method: 'POST' })
};
