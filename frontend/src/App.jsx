
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';

const NAV = [
  ['overview', 'Overview', '▦'],
  ['issues', 'Issue explorer', '◎'],
  ['docs', 'Knowledge search', '⌕'],
  ['trace', 'Release trace', '⑂'],
];

function Status({ value }) {
  return <span className={'status ' + (value === 'open' ? 'open' : 'closed')}>● {value || 'unknown'}</span>;
}

function Empty({ title, text }) {
  return <div className="empty"><div className="empty-symbol">⌁</div><strong>{title}</strong><p>{text}</p></div>;
}

function IssueTable({ issues, onSelect }) {
  if (!issues.length) return <Empty title="No issues found" text="Try another keyword, status or label." />;
  return <div className="table-scroll"><table>
    <thead><tr><th>ISSUE</th><th>STATUS</th><th>LABELS</th><th>REVISION</th></tr></thead>
    <tbody>{issues.map((issue) =>
      <tr key={issue.id || issue._id} tabIndex={0}
        onClick={() => onSelect(issue)}
        onKeyDown={(event) => { if (event.key === 'Enter') onSelect(issue); }}>
        <td><small>#{issue.number}</small><b>{issue.title}</b><span className="dim truncate">{issue.body || 'No description'}</span></td>
        <td><Status value={issue.status} /></td>
        <td><div className="labels">{(issue.labels || []).slice(0,3).map((tag) => <span key={tag} className="label-chip">{tag}</span>)}</div></td>
        <td><span className="revision">v{issue.source_version || issue.current_revision || 1}</span></td>
      </tr>
    )}</tbody>
  </table></div>;
}

export default function App() {
  const [view, setView] = useState('overview');
  const [repositories, setRepositories] = useState([]);
  const [repoId, setRepoId] = useState('');
  const [issues, setIssues] = useState([]);
  const [matches, setMatches] = useState([]);
  const [selected, setSelected] = useState(null);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('all');
  const [label, setLabel] = useState('');
  const [docKeyword, setDocKeyword] = useState('authentication');
  const [release, setRelease] = useState('');
  const [documents, setDocuments] = useState([]);
  const [traceId, setTraceId] = useState('issue_42');
  const [trace, setTrace] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  const [viewer, setViewer] = useState(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginUsername, setLoginUsername] = useState('demo_reader_1');
  const [loginPassword, setLoginPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const accessEpoch = useRef(0);

  const repository = repositories.find((item) => item._id === repoId);
  const summary = useMemo(() => ({
    all: issues.length,
    open: issues.filter((item) => item.status === 'open').length,
    closed: issues.filter((item) => item.status === 'closed').length,
  }), [issues]);

  const loadRepositories = useCallback(async () => {
    const epoch = accessEpoch.current;
    setBusy('repositories'); setError('');
    try {
      const data = await api.repositories(token);
      if (epoch !== accessEpoch.current) return;
      const items = data.repositories || [];
      setRepositories(items);
      setRepoId((current) => items.some((item) => item._id === current) ? current : (items[0]?._id || ''));
    } catch (e) { if (epoch === accessEpoch.current) setError(e.message); }
    finally { if (epoch === accessEpoch.current) setBusy(''); }
  }, [token]);

  function resetRepositoryData() {
    accessEpoch.current += 1;
    setRepoId('');
    setRepositories([]);
    setIssues([]);
    setMatches([]);
    setSelected(null);
    setDocuments([]);
    setTrace(null);
    setError('');
  }

  async function signIn(event) {
    event.preventDefault();
    if (!loginUsername.trim() || !loginPassword) return;
    setAuthError('');
    setAuthBusy(true);
    try {
      const data = await api.login(loginUsername.trim(), loginPassword);
      resetRepositoryData();
      setToken(data.token);
      setViewer(data.user);
      setLoginPassword('');
      setLoginOpen(false);
    } catch (e) {
      setAuthError(e.message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    const oldToken = token;
    resetRepositoryData();
    setViewer(null);
    setToken('');
    setLoginPassword('');
    setAuthError('');
    try {
      if (oldToken) await api.logout(oldToken);
    } catch (e) {
      setError('Signed out locally. Server logout could not be confirmed: ' + e.message);
    }
  }

  useEffect(() => { loadRepositories(); }, [loadRepositories]);

  useEffect(() => {
    setIssues([]); setMatches([]); setTrace(null); setDocuments([]); setSelected(null);
    if (!repoId) return;
    let active = true;
    api.issues(repoId, token).then((data) => {
      if (active) setIssues(data.issues || []);
    }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [repoId, token]);

  async function searchIssues(event) {
    event?.preventDefault();
    if (!repoId) return;
    const epoch = accessEpoch.current;
    setBusy('issues'); setError('');
    try {
      const data = await api.searchIssues(repoId, keyword.trim(), status, label.trim(), token);
      if (epoch === accessEpoch.current) setMatches(data.results || []);
    } catch (e) { if (epoch === accessEpoch.current) setError(e.message); }
    finally { if (epoch === accessEpoch.current) setBusy(''); }
  }

  useEffect(() => {
    if (view !== 'issues' || !repoId) return;
    let active = true;
    api.searchIssues(repoId, '', 'all', '', token).then((data) => {
      if (active) setMatches(data.results || []);
    }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [repoId, view, token]);

  async function searchDocuments(event) {
    event.preventDefault();
    if (!repoId || !docKeyword.trim()) return;
    const epoch = accessEpoch.current;
    setBusy('docs'); setError('');
    try {
      const data = await api.searchDocs(repoId, docKeyword.trim(), release.trim(), token);
      if (epoch === accessEpoch.current) setDocuments(data.results || []);
    } catch (e) { if (epoch === accessEpoch.current) setError(e.message); }
    finally { if (epoch === accessEpoch.current) setBusy(''); }
  }

  async function traceIssue(id) {
    const target = id || traceId;
    if (!target.trim()) return;
    const epoch = accessEpoch.current;
    setTraceId(target); setView('trace'); setBusy('trace'); setError('');
    try {
      const result = await api.trace(target, token);
      if (epoch === accessEpoch.current) setTrace(result);
    }
    catch (e) {
      if (epoch === accessEpoch.current) { setTrace(null); setError(e.message); }
    }
    finally { if (epoch === accessEpoch.current) setBusy(''); }
  }

  async function refresh() {
    await loadRepositories();
    if (repoId) {
      const epoch = accessEpoch.current;
      try {
        const data = await api.issues(repoId, token);
        if (epoch === accessEpoch.current) setIssues(data.issues || []);
      }
      catch (e) { if (epoch === accessEpoch.current) setError(e.message); }
    }
  }

  const headings = {
    overview: ['Repository overview', 'One workspace for engineering issues, evidence and decisions.'],
    issues: ['Issue explorer', 'Search repository activity with the Elasticsearch index.'],
    docs: ['Knowledge search', 'Find documentation with precise source-reference metadata.'],
    trace: ['Release traceability', 'Follow an issue through pull requests, commits and releases.'],
  };
  const [title, subtitle] = headings[view];

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><span className="mark">◈</span><div><b>atlas<span>.</span></b><small>REPOSITORY INTELLIGENCE</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>{NAV.map(([id, name, symbol]) => <button key={id} type="button" onClick={() => setView(id)} className={view === id ? 'active' : ''}><span className="nav-symbol">{symbol}</span>{name}</button>)}</nav>
      <div className="sidebar-bottom"><b>NoSQL Project 19</b><small>Local prototype · repository access</small></div>
    </aside>
    <main className="main">
      <header className="topbar"><div>Workspace <span>/</span> <b>{title}</b></div><div className="top-actions">
        <span className="public-indicator">{viewer ? '● Signed in: ' + viewer.username : '● Public mode'}</span>
        <button onClick={refresh} disabled={busy === 'repositories'}>↻ Refresh</button>
        {viewer
          ? <button type="button" onClick={signOut} className="auth-action">Sign out</button>
          : <button type="button" onClick={() => { setAuthError(''); setLoginOpen(true); }} className="auth-action">Sign in</button>}
        <span className="avatar">{viewer ? viewer.username[0].toUpperCase() : 'D'}</span>
      </div></header>
      <div className="content">
        <div className="heading-row"><div><span className="eyebrow">PROJECT INTELLIGENCE / {view.toUpperCase()}</span><h1>{title}</h1><p>{subtitle}</p></div>
        <label className="repository-selector">ACTIVE REPOSITORY
          <select value={repoId} onChange={(e) => setRepoId(e.target.value)} disabled={!repositories.length}>
          {repositories.map((item) => <option value={item._id} key={item._id}>{item.name}</option>)}
          {!repositories.length && <option value="">No public repositories</option>}
          </select>
        </label></div>

        {error && <div className="error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}

        {view === 'overview' && <>
          <section className="metrics">
            {[
              ['▤', 'Tracked issues', summary.all, 'Authoritative MongoDB records'],
              ['●', 'Open issues', summary.open, 'Currently active'],
              ['✓', 'Closed issues', summary.closed, 'Resolved and tracked'],
              ['◈', 'Accessible repositories', repositories.length, viewer ? 'Public and permitted private' : 'Public repositories'],
            ].map(([icon, label, number, description]) => <article className="metric" key={label}><div className="metric-icon">{icon}</div><span>{label}</span><strong>{number}</strong><small>{description}</small></article>)}
          </section>
          <div className="overview-grid"><section className="panel">
            <div className="panel-header"><div><h2>Recent issues</h2><p>Latest repository activity</p></div><button className="text-action" onClick={() => setView('issues')}>View all →</button></div>
            <IssueTable issues={[...issues].sort((a,b) => b.number - a.number).slice(0,5)} onSelect={(item) => {setSelected(item);setView('issues');}} />
          </section><section className="panel">
            <div className="panel-header"><div><h2>Connected architecture</h2><p>Multi-model data services</p></div></div>
            <div className="architecture">
              {[
                ['M','MongoDB','Source of truth and transactions'],
                ['E','Elasticsearch','Full-text search and retrieval'],
                ['N','Neo4j','Graph relationships and tracing'],
                ['K','Apache Kafka','Asynchronous event delivery'],
              ].map(([icon,name,description]) => <div key={name}><span className="service-icon">{icon}</span><div><b>{name}</b><small>{description}</small></div><em>Configured</em></div>)}
            </div><p className="disclaimer">Configured describes the system design, not a live health check.</p>
          </section></div>
          <section className="hero"><div><span className="eyebrow">RESEARCH WORKFLOW</span><h2>From a bug report to the release that fixed it.</h2><p>Search, inspect documentation evidence and trace source-control decisions.</p></div><button className="primary" onClick={() => setView('issues')}>Explore issues →</button></section>
        </>}

        {view === 'issues' && <>
          <section className="panel"><div className="panel-header"><div><h2>Search issues</h2><p>Query Elasticsearch by keyword, repository, status and label</p></div></div>
          <form className="filters" onSubmit={searchIssues}>
            <label className="grow">KEYWORD<input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Search issues..." /></label>
            <label>STATUS<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All</option><option value="open">Open</option><option value="closed">Closed</option></select></label>
            <label>LABEL<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. bug" /></label>
            <button className="primary" type="submit" disabled={!repoId || busy === 'issues'}>{busy === 'issues' ? 'Searching...' : 'Search issues'}</button>
          </form></section>
          <section className="panel"><div className="panel-header"><div><h2>Search results</h2><p>{matches.length} matches · select an issue to inspect</p></div></div><IssueTable issues={matches} onSelect={setSelected} /></section>
          {selected && <section className="panel detail"><div className="panel-header"><div><small>ISSUE #{selected.number}</small><h2>{selected.title}</h2></div><button className="text-action" onClick={() => setSelected(null)}>Close</button></div>
          <div className="detail-content"><Status value={selected.status} /><span className="revision">Revision {selected.source_version || selected.current_revision || 1}</span><p>{selected.body || 'No description provided.'}</p><button className="secondary" onClick={() => traceIssue(selected.id || selected._id)}>Trace to release →</button></div></section>}
        </>}

        {view === 'docs' && <>
          <section className="panel"><div className="panel-header"><div><h2>Search knowledge</h2><p>Results include document, revision and line-range references</p></div></div><form className="filters" onSubmit={searchDocuments}>
            <label className="grow">SEARCH PHRASE<input value={docKeyword} onChange={(e) => setDocKeyword(e.target.value)} required /></label>
            <label>RELEASE (OPTIONAL)<input value={release} onChange={(e) => setRelease(e.target.value)} placeholder="release_21" /></label>
            <button className="primary" type="submit" disabled={!repoId || busy === 'docs'}>{busy === 'docs' ? 'Searching...' : 'Search docs'}</button>
          </form></section>
          {documents.length ? <div className="documents">{documents.map((doc) => <article className="panel document" key={doc.id}><span className="eyebrow">DOCUMENT</span><h2>{doc.title || doc.document_id || 'Untitled'}</h2><small>{doc.section || 'General'}</small><p>{doc.content}</p><div className="citation"><b>Source</b> {doc.citation?.document_id || doc.document_id || 'unknown'} · revision {doc.citation?.revision ?? doc.revision ?? '?'} · lines {doc.citation?.start_line ?? '?'}–{doc.citation?.end_line ?? '?'}</div></article>)}</div>
          : <section className="panel"><Empty title="Find documented evidence" text="Search to retrieve indexed documentation and citation metadata." /></section>}
        </>}

        {view === 'trace' && <>
          <section className="panel"><div className="panel-header"><div><h2>Trace an issue</h2><p>Find issue → pull request → commit → release paths</p></div></div><form className="filters" onSubmit={(event) => {event.preventDefault();traceIssue();}}>
            <label className="grow">ISSUE ID<input value={traceId} onChange={(e) => setTraceId(e.target.value)} placeholder="issue_42" required /></label>
            <button className="primary" type="submit" disabled={busy === 'trace'}>{busy === 'trace' ? 'Tracing...' : 'Trace issue'}</button></form></section>
          {trace ? <section className="panel"><div className="panel-header"><div><h2>{trace.issue?.title || 'Issue'}</h2><p>{trace.count} linked path(s) · {trace.verified_release_paths ?? 0} verified release(s) · {trace.partial_paths ?? 0} path(s) awaiting release evidence</p></div></div>
            {trace.paths?.length ? trace.paths.map((path, i) => <div className="trace-path" key={i}>
              <div><small>PULL REQUEST</small><strong>#{path.pull_request?.number ?? '—'}</strong><p>{path.pull_request?.title || 'No title'}</p></div><span>→</span>
              <div><small>COMMIT</small><strong>{path.commit?.sha || '—'}</strong><p>{path.commit?.message || 'No message'}</p></div><span>→</span>
              <div className={!path.release ? 'unverified-release' : ''}><small>{path.release_verified ? 'VERIFIED RELEASE' : path.release ? 'RECORDED RELEASE' : 'RELEASE NOT VERIFIED'}</small><strong>{path.release?.tag || 'No verified release'}</strong><p>{path.release?.id || 'This commit has no confirmed release link yet.'}</p>{path.release && !path.release_verified && <p>Release evidence not independently verified.</p>}</div>
            </div>) : <Empty title="No issue-to-PR relationship recorded" text="No linked pull request and merge commit were found for this issue in the imported graph." />}
          </section> : <section className="panel"><Empty title="Explore release history" text="Enter an issue ID to inspect its recorded source-control relationships." /></section>}
        </>}

        <footer>Student proof of concept · Private data requires a session and explicit access grant · Derived indexes are eventually consistent · Source-line metadata requires provenance verification.</footer>
      </div>
    </main>
    {loginOpen && <div className="auth-overlay">
      <form className="login-dialog" onSubmit={signIn} aria-label="Sign in to Atlas">
        <div className="auth-title-row"><div><span className="eyebrow">ATLAS ACCESS</span><h2>Sign in</h2><p>Use your existing local test account.</p></div>
          <button type="button" className="auth-close" onClick={() => { setLoginPassword(''); setAuthError(''); setLoginOpen(false); }} aria-label="Close sign-in form">×</button>
        </div>
        {authError && <div className="error" role="alert">{authError}</div>}
        <label>USERNAME<input autoComplete="username" value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} required maxLength={32} /></label>
        <label>PASSWORD<input type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required /></label>
        <button className="primary" type="submit" disabled={authBusy}>{authBusy ? 'Signing in...' : 'Sign in'}</button>
        <p className="auth-note">The session token is kept in memory only. Closing or refreshing this page signs you out. Do not use your development key here.</p>
      </form>
    </div>}
  </div>;
}
