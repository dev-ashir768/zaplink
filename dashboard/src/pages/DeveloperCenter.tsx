import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, ChevronDown, Copy, Link2, Loader2, Play, Search, ShieldCheck } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { API_ORIGIN } from '../services/api';
import { copyToClipboard } from '../utils/clipboard';
import {
  buildUrl,
  codeSample,
  exampleRequest,
  filterEndpoints,
  groupByTag,
  isPublic,
  listEndpoints,
  mediaExample,
  paramExample,
  parseDeepLink,
  requiredRole,
  SAMPLE_LANGUAGES,
  SAMPLE_PHONE,
  schemaFields,
  tokenizeJson,
  typeLabel,
  usesBearer,
  type Endpoint,
  type OpenApiDocument,
  type RequestValues,
  type SampleLanguage,
  type SchemaObject,
} from '../utils/openapi';
import './DeveloperCenter.css';

/** Where the build put the content-hashed openapi.json (vite.config.ts); fetched only when this page opens. */
const SPEC_URL = typeof __OPENAPI_SPEC_URL__ === 'string' ? __OPENAPI_SPEC_URL__ : '/openapi.json';

let specPromise: Promise<OpenApiDocument> | null = null;
function loadSpec(): Promise<OpenApiDocument> {
  specPromise ??= fetch(SPEC_URL).then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<OpenApiDocument>;
  });
  specPromise.catch(() => {
    specPromise = null;
  });
  return specPromise;
}

/** The origin requests are made against: VITE_API_URL for a split deployment, else this page's own. */
function apiOrigin(): string {
  return API_ORIGIN || window.location.origin;
}

const SAMPLE_LABELS: Record<SampleLanguage, string> = {
  curl: 'cURL',
  javascript: 'JavaScript',
  python: 'Python',
  php: 'PHP',
};

function MethodBadge({ method }: { method: string }) {
  return <span className={`dev-method dev-method--${method}`}>{method.toUpperCase()}</span>;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="dev-copy"
      aria-label={label}
      title={label}
      onClick={() => {
        void copyToClipboard(text).then(ok => {
          if (!ok) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span>{copied ? t('developerCenter.copied') : t('developerCenter.copy')}</span>
    </button>
  );
}

export function JsonCode({ value }: { value: string }) {
  return (
    <>
      {tokenizeJson(value).map((tok, i) =>
        tok.kind === 'text' ? (
          tok.text
        ) : (
          <span key={i} className={`dev-json-${tok.kind}`}>
            {tok.text}
          </span>
        ),
      )}
    </>
  );
}

function CodeBlock({ code, json = false, copyLabel }: { code: string; json?: boolean; copyLabel: string }) {
  return (
    <div className="dev-code">
      <CopyButton text={code} label={copyLabel} />
      <pre>
        <code>{json ? <JsonCode value={code} /> : code}</code>
      </pre>
    </div>
  );
}

function FieldTable({ doc, schema }: { doc: OpenApiDocument; schema: SchemaObject | undefined }) {
  const { t } = useTranslation();
  const rows = useMemo(() => schemaFields(doc, schema), [doc, schema]);
  if (rows.length === 0) {
    return (
      <p className="dev-muted">
        {t('developerCenter.schemaType')}: <code>{typeLabel(doc, schema)}</code>
      </p>
    );
  }
  return (
    <div className="dev-table-wrap">
      <table className="dev-table">
        <thead>
          <tr>
            <th>{t('developerCenter.field')}</th>
            <th>{t('developerCenter.type')}</th>
            <th>{t('developerCenter.description')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.path}-${i}`}>
              <td style={{ paddingInlineStart: `${0.75 + r.depth * 1.1}rem` }}>
                <code className="dev-field-name">
                  {r.depth > 0 ? r.path.slice(r.path.lastIndexOf('.') + 1) : r.name}
                </code>
                {r.required && <span className="dev-required">{t('developerCenter.required')}</span>}
                {r.deprecated && <span className="dev-deprecated">{t('developerCenter.deprecated')}</span>}
              </td>
              <td>
                <code className="dev-type">{r.type}</code>
                {r.nullable && <span className="dev-muted"> | null</span>}
              </td>
              <td className="dev-desc">
                {r.description && <div>{r.description}</div>}
                {r.enumValues && (
                  <div className="dev-enum">
                    {t('developerCenter.oneOf')}:{' '}
                    {r.enumValues.map(v => (
                      <code key={v}>{v}</code>
                    ))}
                  </div>
                )}
                {r.constraints && <div className="dev-muted">{r.constraints}</div>}
                {r.example !== undefined && (
                  <div className="dev-muted">
                    {t('developerCenter.example')}: <code>{JSON.stringify(r.example)}</code>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="dev-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function TryIt({ doc, endpoint }: { doc: OpenApiDocument; endpoint: Endpoint }) {
  const { t } = useTranslation();
  const { canWrite } = useRole();
  const initial = useMemo(() => exampleRequest(doc, endpoint), [doc, endpoint]);
  const [values, setValues] = useState<RequestValues>(initial);
  const [bodyText, setBodyText] = useState(() =>
    initial.body === undefined ? '' : JSON.stringify(initial.body, null, 2),
  );
  const [result, setResult] = useState<{ status: number; ms: number; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const mutating = endpoint.method !== 'get';
  const blocked = mutating && !canWrite;

  const setParam = (where: 'path' | 'query' | 'header', name: string, value: string) =>
    setValues(v => ({ ...v, [where]: { ...v[where], [name]: value } }));

  const send = async () => {
    setError(null);
    setResult(null);
    let body: string | undefined;
    if (endpoint.operation.requestBody && bodyText.trim()) {
      try {
        body = JSON.stringify(JSON.parse(bodyText));
      } catch {
        setError(t('developerCenter.invalidJson'));
        return;
      }
    }
    const key = sessionStorage.getItem('zaplink_api_key');
    const headers: Record<string, string> = {};
    if (key) headers['X-API-Key'] = key;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    for (const [k, v] of Object.entries(values.header)) if (v) headers[k] = v;
    setSending(true);
    const started = performance.now();
    try {
      const res = await fetch(buildUrl(apiOrigin(), endpoint.path, values), {
        method: endpoint.method.toUpperCase(),
        headers,
        body,
      });
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Not JSON (e.g. the Prometheus text format): show it as is.
      }
      setResult({ status: res.status, ms: Math.round(performance.now() - started), body: pretty });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const params = endpoint.parameters.filter(p => p.in !== 'cookie');
  return (
    <div className="dev-try">
      <div className="dev-warning" role="note">
        <AlertTriangle size={16} aria-hidden="true" />
        <span>{t('developerCenter.tryWarning')}</span>
      </div>
      {params.length > 0 && (
        <div className="dev-try-grid">
          {params.map(p => {
            const where = p.in as 'path' | 'query' | 'header';
            return (
              <label key={`${p.in}-${p.name}`} className="dev-try-field">
                <span>
                  <code>{p.name}</code> <span className="dev-muted">({p.in})</span>
                  {p.required && <span className="dev-required">{t('developerCenter.required')}</span>}
                </span>
                <input
                  className="dev-input"
                  value={values[where][p.name] ?? ''}
                  placeholder={String(paramExample(doc, p))}
                  onChange={e => setParam(where, p.name, e.target.value)}
                />
              </label>
            );
          })}
        </div>
      )}
      {endpoint.operation.requestBody && (
        <label className="dev-try-field">
          <span>{t('developerCenter.requestBody')} (JSON)</span>
          <textarea
            className="dev-input dev-textarea"
            spellCheck={false}
            rows={Math.min(16, Math.max(4, bodyText.split('\n').length))}
            value={bodyText}
            onChange={e => setBodyText(e.target.value)}
          />
        </label>
      )}
      <div className="dev-try-actions">
        <button type="button" className="btn-primary" disabled={sending || blocked} onClick={() => void send()}>
          {sending ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          {t('developerCenter.send')}
        </button>
        {blocked && <span className="dev-muted">{t('developerCenter.viewerBlocked')}</span>}
      </div>
      {error && (
        <p className="dev-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="dev-try-result" aria-live="polite">
          <div className="dev-try-meta">
            <span className={`dev-status dev-status--${String(result.status)[0]}xx`}>{result.status}</span>
            <span className="dev-muted">{result.ms} ms</span>
          </div>
          {result.body && <CodeBlock code={result.body} json copyLabel={t('developerCenter.copyResponse')} />}
        </div>
      )}
    </div>
  );
}

function EndpointDetail({ doc, endpoint }: { doc: OpenApiDocument; endpoint: Endpoint }) {
  const { t } = useTranslation();
  const [lang, setLang] = useState<SampleLanguage>('curl');
  const [tryOpen, setTryOpen] = useState(false);
  const op = endpoint.operation;
  const origin = apiOrigin();
  const fullUrl = `${origin}${endpoint.path}`;
  const role = requiredRole(op);
  const publicOp = isPublic(doc, op);
  const bearer = usesBearer(op);
  const body = op.requestBody?.content?.['application/json'];
  const bodyExample = useMemo(() => (body ? mediaExample(doc, body) : undefined), [doc, body]);
  const samples = useMemo(
    () =>
      Object.fromEntries(SAMPLE_LANGUAGES.map(l => [l, codeSample(l, doc, endpoint, origin)])) as Record<
        SampleLanguage,
        string
      >,
    [doc, endpoint, origin],
  );
  const shareUrl = `${window.location.origin}/developer?op=${encodeURIComponent(endpoint.id)}`;

  return (
    <article className="dev-detail" aria-labelledby="dev-detail-title">
      <div className="dev-card">
        <div className="dev-detail-head">
          <MethodBadge method={endpoint.method} />
          <h2 id="dev-detail-title" className="dev-detail-title">
            {endpoint.summary || endpoint.path}
          </h2>
          {op.deprecated && <span className="dev-deprecated">{t('developerCenter.deprecated')}</span>}
        </div>
        <div className="dev-url">
          <code>{fullUrl}</code>
          <CopyButton text={fullUrl} label={t('developerCenter.copyUrl')} />
          <CopyButton text={shareUrl} label={t('developerCenter.copyLink')} />
        </div>
        <div className="dev-chips">
          <span className="dev-chip">
            {t('developerCenter.tag')}: <strong>{endpoint.tag}</strong>
          </span>
          <span className="dev-chip">
            operationId: <code>{endpoint.id}</code>
          </span>
          <span className="dev-chip">
            <ShieldCheck size={14} aria-hidden="true" />
            {publicOp
              ? t('developerCenter.noAuth')
              : bearer
                ? 'Authorization: Bearer METRICS_TOKEN'
                : 'X-API-Key: YOUR_API_KEY'}
          </span>
          {role && (
            <span className="dev-chip dev-chip--role">
              {t('developerCenter.requiredRole')}: <strong>{role}</strong>
            </span>
          )}
        </div>
        {op.description && <p className="dev-description">{op.description}</p>}
      </div>

      {endpoint.parameters.length > 0 && (
        <Section title={t('developerCenter.parameters')}>
          <div className="dev-table-wrap">
            <table className="dev-table">
              <thead>
                <tr>
                  <th>{t('developerCenter.name')}</th>
                  <th>{t('developerCenter.in')}</th>
                  <th>{t('developerCenter.type')}</th>
                  <th>{t('developerCenter.description')}</th>
                  <th>{t('developerCenter.example')}</th>
                </tr>
              </thead>
              <tbody>
                {endpoint.parameters.map(p => (
                  <tr key={`${p.in}-${p.name}`}>
                    <td>
                      <code className="dev-field-name">{p.name}</code>
                      {p.required && <span className="dev-required">{t('developerCenter.required')}</span>}
                    </td>
                    <td>{p.in}</td>
                    <td>
                      <code className="dev-type">{typeLabel(doc, p.schema)}</code>
                    </td>
                    <td className="dev-desc">{p.description}</td>
                    <td>
                      <code>{String(paramExample(doc, p))}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {body && (
        <Section
          title={`${t('developerCenter.requestBody')}${op.requestBody?.required ? ` (${t('developerCenter.required')})` : ''}`}
        >
          {op.requestBody?.description && <p className="dev-description">{op.requestBody.description}</p>}
          <FieldTable doc={doc} schema={body.schema} />
          {bodyExample !== undefined && (
            <>
              <h4>{t('developerCenter.exampleBody')}</h4>
              <CodeBlock code={JSON.stringify(bodyExample, null, 2)} json copyLabel={t('developerCenter.copyBody')} />
            </>
          )}
        </Section>
      )}

      <Section title={t('developerCenter.codeSamples')}>
        <div className="dev-tabs" role="tablist" aria-label={t('developerCenter.codeSamples')}>
          {SAMPLE_LANGUAGES.map(l => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={lang === l}
              className={`dev-tab${lang === l ? ' dev-tab--active' : ''}`}
              onClick={() => setLang(l)}
            >
              {SAMPLE_LABELS[l]}
            </button>
          ))}
        </div>
        <div role="tabpanel">
          <CodeBlock code={samples[lang]} copyLabel={t('developerCenter.copyCode')} />
        </div>
      </Section>

      <Section title={t('developerCenter.responses')}>
        {Object.entries(op.responses ?? {}).map(([status, res]) => {
          const media = res.content?.['application/json'];
          const example = media ? mediaExample(doc, media) : undefined;
          return (
            <details key={status} className="dev-response" open={status.startsWith('2')}>
              <summary>
                <span className={`dev-status dev-status--${status[0]}xx`}>{status}</span>
                <span>{res.description}</span>
              </summary>
              {media && (
                <div className="dev-response-body">
                  <FieldTable doc={doc} schema={media.schema} />
                  {example !== undefined && (
                    <CodeBlock
                      code={JSON.stringify(example, null, 2)}
                      json
                      copyLabel={t('developerCenter.copyResponse')}
                    />
                  )}
                </div>
              )}
            </details>
          );
        })}
      </Section>

      <Section title={t('developerCenter.tryIt')}>
        {tryOpen ? (
          <TryIt key={endpoint.id} doc={doc} endpoint={endpoint} />
        ) : (
          <button type="button" className="btn-secondary" onClick={() => setTryOpen(true)}>
            <Play size={16} />
            {t('developerCenter.openTryIt')}
          </button>
        )}
      </Section>
    </article>
  );
}

function Intro({ doc }: { doc: OpenApiDocument }) {
  const { t } = useTranslation();
  const origin = apiOrigin();
  return (
    <details className="dev-card dev-intro" open>
      <summary>
        <h2>{t('developerCenter.introTitle')}</h2>
      </summary>
      <div className="dev-intro-grid">
        <div>
          <h3>{t('developerCenter.baseUrl')}</h3>
          <div className="dev-url">
            <code>{`${origin}/api`}</code>
            <CopyButton text={`${origin}/api`} label={t('developerCenter.copyUrl')} />
          </div>
          <p>{t('developerCenter.baseUrlHelp', { version: doc.info?.version ?? '' })}</p>
        </div>
        <div>
          <h3>{t('developerCenter.authTitle')}</h3>
          <p>
            {t('developerCenter.authHelp')} <code>X-API-Key: YOUR_API_KEY</code>
          </p>
          <p>
            {t('developerCenter.authKeys')} <Link to="/api-keys">{t('nav.apiKeys')}</Link>.
          </p>
          <ul>
            <li>
              <strong>admin</strong>: {t('developerCenter.roleAdmin')}
            </li>
            <li>
              <strong>operator</strong>: {t('developerCenter.roleOperator')}
            </li>
            <li>
              <strong>viewer</strong>: {t('developerCenter.roleViewer')}
            </li>
          </ul>
        </div>
        <div>
          <h3>{t('developerCenter.chatIdTitle')}</h3>
          <ul>
            <li>
              {t('developerCenter.chatIdPerson')} <code>{`${SAMPLE_PHONE}@c.us`}</code>
            </li>
            <li>
              {t('developerCenter.chatIdGroup')} <code>120363000000000000@g.us</code>
            </li>
          </ul>
          <p>{t('developerCenter.chatIdHelp')}</p>
        </div>
        <div>
          <h3>{t('developerCenter.errorsTitle')}</h3>
          <p>{t('developerCenter.errorsHelp')}</p>
          <CodeBlock
            code={JSON.stringify(
              { statusCode: 400, message: 'chatId must be a string', error: 'Bad Request', code: 'OPTIONAL_CODE' },
              null,
              2,
            )}
            json
            copyLabel={t('developerCenter.copyCode')}
          />
          <p>{t('developerCenter.rateLimits')}</p>
        </div>
        <div>
          <h3>{t('developerCenter.webhooksTitle')}</h3>
          <p>
            {t('developerCenter.webhooksHelp')} <Link to="/webhooks">{t('nav.webhooks')}</Link>.
          </p>
        </div>
        <div>
          <h3>{t('developerCenter.wsTitle')}</h3>
          <p>{t('developerCenter.wsHelp')}</p>
          <CodeBlock
            code={`import { io } from 'socket.io-client';\n\nconst socket = io('${origin}/events', {\n  auth: { apiKey: 'YOUR_API_KEY' },\n});\nsocket.on('connect', () => {\n  socket.emit('message', { type: 'subscribe', sessionId: 'my-session', events: ['message.received'] });\n});\nsocket.on('message', event => console.log(event));`}
            copyLabel={t('developerCenter.copyCode')}
          />
        </div>
      </div>
    </details>
  );
}

export function DeveloperCenter() {
  const { t } = useTranslation();
  useDocumentTitle(t('developerCenter.title'));
  const location = useLocation();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<OpenApiDocument | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);

  useEffect(() => {
    let live = true;
    loadSpec()
      .then(d => live && setDoc(d))
      .catch((err: unknown) => live && setLoadError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, []);

  const endpoints = useMemo(() => (doc ? listEndpoints(doc) : []), [doc]);
  const filtered = useMemo(() => filterEndpoints(endpoints, query), [endpoints, query]);
  const groups = useMemo(() => (doc ? groupByTag(doc, filtered) : []), [doc, filtered]);
  const selectedId = parseDeepLink(location.search, location.hash);
  const selected = endpoints.find(e => e.id === selectedId) ?? null;

  const select = useCallback(
    (e: Endpoint) => {
      navigate({ pathname: '/developer', search: `?op=${encodeURIComponent(e.id)}`, hash: `#${e.tag}/${e.id}` });
      setListOpen(false);
    },
    [navigate],
  );

  useEffect(() => {
    if (selected) document.getElementById('dev-detail-title')?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  return (
    <div className="dev-page">
      <PageHeader
        title={t('developerCenter.title')}
        subtitle={t('developerCenter.subtitle', { count: endpoints.length })}
        badge={doc?.info?.version ? <span className="dev-chip">v{doc.info.version}</span> : undefined}
      />
      {loadError && (
        <div className="error-banner" role="alert">
          {t('developerCenter.loadFailed')}: {loadError}
        </div>
      )}
      {!doc && !loadError && (
        <div className="dev-loading">
          <Loader2 className="animate-spin" size={24} />
        </div>
      )}
      {doc && (
        <>
          <Intro doc={doc} />
          <div className="dev-layout">
            <nav
              className={`dev-sidebar${listOpen ? ' dev-sidebar--open' : ''}`}
              aria-label={t('developerCenter.endpoints')}
            >
              <button
                type="button"
                className="dev-sidebar-toggle"
                aria-expanded={listOpen}
                onClick={() => setListOpen(o => !o)}
              >
                {t('developerCenter.endpoints')} ({filtered.length})
                <ChevronDown size={16} aria-hidden="true" />
              </button>
              <div className="dev-sidebar-body">
                <label className="dev-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="search"
                    value={query}
                    placeholder={t('developerCenter.searchPlaceholder')}
                    aria-label={t('developerCenter.searchPlaceholder')}
                    onChange={e => setQuery(e.target.value)}
                  />
                </label>
                {groups.length === 0 && <p className="dev-muted">{t('developerCenter.noResults')}</p>}
                {groups.map(g => (
                  <div key={g.tag} className="dev-group">
                    <h3 className="dev-group-title" title={g.description}>
                      {g.tag} <span className="dev-muted">{g.endpoints.length}</span>
                    </h3>
                    <ul>
                      {g.endpoints.map(e => (
                        <li key={e.id}>
                          <button
                            type="button"
                            className={`dev-op${selected?.id === e.id ? ' dev-op--active' : ''}`}
                            aria-current={selected?.id === e.id ? 'true' : undefined}
                            onClick={() => select(e)}
                          >
                            <MethodBadge method={e.method} />
                            <span className="dev-op-text">
                              <span className="dev-op-path">{e.path.replace(/^\/api/, '')}</span>
                              {e.summary && <span className="dev-op-summary">{e.summary}</span>}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </nav>
            <div className="dev-main">
              {selected ? (
                <EndpointDetail key={selected.id} doc={doc} endpoint={selected} />
              ) : (
                <div className="dev-card dev-empty">
                  <Link2 size={24} aria-hidden="true" />
                  <p>{t('developerCenter.pickEndpoint')}</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
