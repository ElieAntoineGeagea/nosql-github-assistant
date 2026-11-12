
import { useCallback, useEffect, useMemo, useState } from 'react';
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

  const repository = repositories.find((item) => item._id === repoId);
  const summary = useMemo(() => ({
    all: issues.length,
    open: issues.filter((item) => item.status === 'open').length,
    closed: issues.filter((item) => item.status === 'closed').length,
  }), [issues]);

  const loadRepositories = useCallback(async () => {
    setBusy('repositories'); setError('');
    try {
      const data = await api.repositories();
      const items = data.repositories || [];
      setRepositories(items);
      setRepoId((current) => items.some((item) => item._id === current) ? current : (items[0]?._id || ''));
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }, []);

  useEffect(() => { loadRepositories(); }, [loadRepositories]);

  useEffect(() => {
    setIssues([]); setMatches([]); setTrace(null); setDocuments([]); setSelected(null);
    if (!repoId) return;
    let active = true;
    api.issues(repoId).then((data) => {
      if (active) setIssues(data.issues || []);
    }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [repoId]);

  async function searchIssues(event) {
    event?.preventDefault();
    if (!repoId) return;
    setBusy('issues'); setError('');
    try {
      const data = await api.searchIssues(repoId, keyword.trim(), status, label.trim());
      setMatches(data.results || []);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  useEffect(() => {
    if (view !== 'issues' || !repoId) return;
    let active = true;
    api.searchIssues(repoId, '', 'all', '').then((data) => {
      if (active) setMatches(data.results || []);
    }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [repoId, view]);

  async function searchDocuments(event) {
    event.preventDefault();
    if (!repoId || !docKeyword.trim()) return;
    setBusy('docs'); setError('');
    try {
      const data = await api.searchDocs(repoId, docKeyword.trim(), release.trim());
      setDocuments(data.results || []);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function traceIssue(id) {
    const target = id || traceId;
    if (!target.trim()) return;
    setTraceId(target); setView('trace'); setBusy('trace'); setError('');
    try { setTrace(await api.trace(target)); }
    catch (e) { setTrace(null); setError(e.message); }
    finally { setBusy(''); }
  }

  async function refresh() {
    await loadRepositories();
    if (repoId) {
      try { const data = await api.issues(repoId); setIssues(data.issues || []); }
      catch (e) { setError(e.message); }
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
      <div className="sidebar-bottom"><b>NoSQL Project 19</b><small>Local prototype · public data</small></div>
    </aside>
    <main className="main">
      <header className="topbar"><div>Workspace <span>/</span> <b>{title}</b></div><div className="top-actions"><span className="public-indicator">● Public mode</span><button onClick={refresh} disabled={busy === 'repositories'}>↻ Refresh</button><span className="avatar">D</span></div></header>
      <div className="content">
        <div className="heading-row"><div><span className="eyebrow">PROJECT INTELLIGENCE / {view.toUpperCase()}</span><h1>{title}</h1><p>{subtitle}</p></div>
        <label className="repository-selector">ACTIVE REPOSITORY
          <select value={repoId} onChange={(e) => setRepoId(e.target.value)} disabled={!repositories.length}>
          {repositories.map((item) => <option value={item._id} key={item._id}>{item.name}</option>)}
          {!repositories.length && <option value="">No public repositories</option>}
          </select>
        </label></div>

        {error && <div className="error" role="alert"><span>{error}. Check that the Express server is running.</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}

        {view === 'overview' && <>
          <section className="metrics">
            {[
              ['▤', 'Tracked issues', summary.all, 'Authoritative MongoDB records'],
              ['●', 'Open issues', summary.open, 'Currently active'],
              ['✓', 'Closed issues', summary.closed, 'Resolved and tracked'],
              ['◈', 'Public repositories', repositories.length, 'Available to this workspace'],
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
          {trace ? <section className="panel"><div className="panel-header"><div><h2>{trace.issue?.title || 'Issue'}</h2><p>{trace.count} matching paths</p></div></div>
            {trace.paths?.length ? trace.paths.map((path, i) => <div className="trace-path" key={i}>
              <div><small>PULL REQUEST</small><strong>#{path.pull_request?.number ?? '—'}</strong><p>{path.pull_request?.title || 'No title'}</p></div><span>→</span>
              <div><small>COMMIT</small><strong>{path.commit?.sha || '—'}</strong><p>{path.commit?.message || 'No message'}</p></div><span>→</span>
              <div><small>RELEASE</small><strong>{path.release?.tag || '—'}</strong><p>{path.release?.id || 'Not available'}</p></div>
            </div>) : <Empty title="No fix path recorded" text="This issue exists but no matching release path is stored yet." />}
          </section> : <section className="panel"><Empty title="Explore release history" text="Enter an issue ID to inspect its recorded source-control relationships." /></section>}
        </>}

        <footer>Student proof of concept · Public access only · Derived indexes are eventually consistent · Source-line metadata requires provenance verification.</footer>
      </div>
    </main>
  </div>;
}
