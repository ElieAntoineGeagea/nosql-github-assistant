const ROOT = import.meta.env.VITE_API_BASE_URL || '';

async function get(path) {
  const response = await fetch(ROOT + path, { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => {
    throw new Error('Server returned invalid JSON');
  });
  if (!response.ok || data.success === false) {
    throw new Error(data.error || 'Request failed: HTTP ' + response.status);
  }
  return data;
}

const params = (entries) => new URLSearchParams(
  Object.entries(entries).filter(([, value]) => value !== '' && value !== undefined && value !== 'all')
);

export const api = {
  repositories: () => get('/api/repositories'),
  issues: (repo) => get('/api/issues?' + params({ repository_id: repo })),
  searchIssues: (repo, q, status, label) => get('/api/issues/search?' + params({repository_id: repo,q,status,label})),
  searchDocs: (repo, q, release) => get('/api/search?' + params({repository_id:repo,q,release_id:release})),
  trace: (id) => get('/api/issues/' + encodeURIComponent(id) + '/trace'),
};
