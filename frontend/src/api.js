const ROOT = import.meta.env.VITE_API_BASE_URL || '';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(path, { token, method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(ROOT + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
  });

  const data = await response.json().catch(() => {
    throw new ApiError('Server returned invalid JSON', response.status);
  });

  if (!response.ok || data.success === false) {
    throw new ApiError(data.error || `Request failed: HTTP ${response.status}`, response.status);
  }

  return data;
}

const params = (entries) => new URLSearchParams(
  Object.entries(entries).filter(([, value]) => value !== '' && value !== undefined && value !== 'all')
);

export const api = {
  login: (username, password) =>
    request('/api/auth/login', { method: 'POST', body: { username, password } }),
  me: (token) => request('/api/auth/me', { token }),
  logout: (token) => request('/api/auth/logout', { token, method: 'POST' }),
  repositories: (token) => request('/api/repositories', { token }),
  issues: (repo, token) => request('/api/issues?' + params({ repository_id: repo }), { token }),
  searchIssues: (repo, q, status, label, token) =>
    request('/api/issues/search?' + params({ repository_id: repo, q, status, label }), { token }),
  searchDocs: (repo, q, release, token) =>
    request('/api/search?' + params({ repository_id: repo, q, release_id: release }), { token }),
  trace: (id, token) => request('/api/issues/' + encodeURIComponent(id) + '/trace', { token }),
};
