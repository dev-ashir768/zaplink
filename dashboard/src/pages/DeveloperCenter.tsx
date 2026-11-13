import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  CircleUser,
  Contact,
  Copy,
  Cpu,
  Gauge,
  Globe,
  HeartPulse,
  Image,
  KeyRound,
  Link2,
  ListTree,
  Loader2,
  Menu,
  MessageSquare,
  Phone,
  Play,
  Radio,
  ScrollText,
  Search,
  Server,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Tag,
  Users,
  Webhook,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { ENGINE_LABELS, isEngineId } from '../utils/engineCapabilities';
import { API_ORIGIN } from '../services/api';
import { copyToClipboard } from '../utils/clipboard';
import {
  buildUrl,
  codeSample,
  exampleRequest,
  endpointRunsOn,
  filterEndpoints,
  operationEngines,
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
  type FieldRow,
  type OpenApiDocument,
  type RequestValues,
  type SampleLanguage,
  type SchemaObject,
} from '../utils/openapi';
import './DeveloperCenter.css';

/** Where the build put the content-hashed openapi.json (vite.config.ts); fetched only when this page opens. */
const SPEC_URL = typeof __OPENAPI_SPEC_URL__ === 'string' ? __OPENAPI_SPEC_URL__ : '/openapi.json';
const INTRO_KEY = 'zaplink_dev_intro_collapsed';

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

const TAG_ICONS: Record<string, LucideIcon> = {
  audit: ScrollText,
  auth: KeyRound,
  calls: Phone,
  catalog: ShoppingBag,
  channels: Radio,
  contacts: Contact,
  groups: Users,
  health: HeartPulse,
  infrastructure: Server,
  labels: Tag,
  media: Image,
  messages: MessageSquare,
  metrics: Gauge,
  profile: CircleUser,
  search: Search,
  sessions: Smartphone,
  settings: Settings,
  statistics: BarChart3,
  status: Activity,
  templates: BookOpen,
  webhooks: Webhook,
};

function readIntroCollapsed(): boolean {
  try {
    return window.localStorage.getItem(INTRO_KEY) === '1';
  } catch {
    return false;
  }
}

function writeIntroCollapsed(v: boolean): void {
  try {
    window.localStorage.setItem(INTRO_KEY, v ? '1' : '0');
  } catch {
    // Storage blocked: the choice just isn't remembered.
  }
}

function statusClass(status: string | number): string {
  const first = String(status)[0];
  return `dev-status dev-status--${/[1-5]/.test(first) ? first : 'd'}xx`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function MethodBadge({ method }: { method: string }) {
  return <span className={`dev-method dev-method--${method}`}>{method.toUpperCase()}</span>;
}

/** The path in monospace, with {params} highlighted. */
function PathText({ path }: { path: string }) {
  return (
    <>
      {path.split(/(\{[^}]+\})/).map((part, i) =>
        part.startsWith('{') ? (
          <span key={i} className="dev-path-param">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

function CopyButton({ text, label, compact = false }: { text: string; label: string; compact?: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`dev-copy${copied ? ' dev-copy--done' : ''}${compact ? ' dev-copy--compact' : ''}`}
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
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {!compact && <span>{copied ? t('developerCenter.copied') : t('developerCenter.copy')}</span>}
      {compact && copied && <span className="dev-sr-live">{t('developerCenter.copied')}</span>}
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

function CodeBlock({
  code,
  json = false,
  copyLabel,
  title,
}: {
  code: string;
  json?: boolean;
  copyLabel: string;
  title?: ReactNode;
}) {
  return (
    <div className="dev-code">
      <div className="dev-code-bar">
        <span className="dev-code-title">{title}</span>
        <CopyButton text={code} label={copyLabel} />
      </div>
      <pre>
        <code>{json ? <JsonCode value={code} /> : code}</code>
      </pre>
    </div>
  );
}

/** A row's own name (the last path segment) for nested rows. */
function rowName(r: FieldRow): string {
  return r.depth > 0 ? r.path.slice(r.path.lastIndexOf('.') + 1) : r.name;
}

/** Nested schema fields as a readable property list; rows with children can be folded. */
function PropertyList({ doc, schema }: { doc: OpenApiDocument; schema: SchemaObject | undefined }) {
  const { t } = useTranslation();
  const rows = useMemo(() => schemaFields(doc, schema), [doc, schema]);
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  if (rows.length === 0) {
    return (
      <p className="dev-muted">
        {t('developerCenter.schemaType')}: <code className="dev-type">{typeLabel(doc, schema)}</code>
      </p>
    );
  }
  const visible: Array<{ row: FieldRow; index: number; hasChildren: boolean }> = [];
  let hideBelow = Infinity;
  rows.forEach((row, index) => {
    if (row.depth > hideBelow) return;
    hideBelow = Infinity;
    const hasChildren = (rows[index + 1]?.depth ?? -1) > row.depth;
    visible.push({ row, index, hasChildren });
    if (hasChildren && folded.has(`${row.path}-${index}`)) hideBelow = row.depth;
  });
  const toggle = (key: string) =>
    setFolded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <ul className="dev-props">
      {visible.map(({ row: r, index, hasChildren }) => {
        const key = `${r.path}-${index}`;
        const open = !folded.has(key);
        return (
          <li key={key} className="dev-prop" style={{ ['--depth' as string]: r.depth }}>
            {Array.from({ length: r.depth }, (_, i) => (
              <span key={i} className="dev-prop-guide" style={{ ['--guide' as string]: i }} aria-hidden="true" />
            ))}
            <div className="dev-prop-head">
              {hasChildren ? (
                <button
                  type="button"
                  className="dev-prop-toggle"
                  aria-expanded={open}
                  aria-label={rowName(r)}
                  onClick={() => toggle(key)}
                >
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              ) : (
                <span className="dev-prop-toggle-spacer" aria-hidden="true" />
              )}
              <code className="dev-field-name">{rowName(r)}</code>
              <span className="dev-type">
                {r.type}
                {r.nullable && ' | null'}
              </span>
              {r.required && <span className="dev-required">{t('developerCenter.required')}</span>}
              {r.deprecated && <span className="dev-deprecated">{t('developerCenter.deprecated')}</span>}
            </div>
            {(r.description || r.enumValues || r.constraints || r.example !== undefined) && (
              <div className="dev-prop-body">
                {r.description && <p className="dev-desc">{r.description}</p>}
                {r.enumValues && (
                  <div className="dev-enum">
                    <span className="dev-muted">{t('developerCenter.oneOf')}:</span>
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
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="dev-section">
      <div className="dev-section-head">
        <h3>{title}</h3>
        {aside}
      </div>
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
  const [result, setResult] = useState<{ status: number; ms: number; size: number; body: string } | null>(null);
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
      setResult({
        status: res.status,
        ms: Math.round(performance.now() - started),
        size: new TextEncoder().encode(text).length,
        body: pretty,
      });
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
                <span className="dev-try-label">
                  <code>{p.name}</code>
                  <span className="dev-in">{p.in}</span>
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
          <span className="dev-try-label">{t('developerCenter.requestBody')} (JSON)</span>
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
            <span className={statusClass(result.status)}>{result.status}</span>
            <span className="dev-meta-item">{result.ms} ms</span>
            <span className="dev-meta-item">{formatBytes(result.size)}</span>
          </div>
          {result.body && <CodeBlock code={result.body} json copyLabel={t('developerCenter.copyResponse')} />}
        </div>
      )}
    </div>
  );
}

/** The sticky right-hand panel: request sample per language and the example responses. */
function CodePanel({ doc, endpoint }: { doc: OpenApiDocument; endpoint: Endpoint }) {
  const { t } = useTranslation();
  const [lang, setLang] = useState<SampleLanguage>('curl');
  const origin = apiOrigin();
  const samples = useMemo(
    () =>
      Object.fromEntries(SAMPLE_LANGUAGES.map(l => [l, codeSample(l, doc, endpoint, origin)])) as Record<
        SampleLanguage,
        string
      >,
    [doc, endpoint, origin],
  );
  const examples = useMemo(
    () =>
      Object.entries(endpoint.operation.responses ?? {})
        .map(([status, res]) => {
          const media = res.content?.['application/json'];
          const example = media ? mediaExample(doc, media) : undefined;
          return { status, example };
        })
        .filter(e => e.example !== undefined),
    [doc, endpoint],
  );
  const [status, setStatus] = useState(() => examples[0]?.status);
  const current = examples.find(e => e.status === status) ?? examples[0];

  return (
    <aside className="dev-panel" aria-label={t('developerCenter.codeSamples')}>
      <div className="dev-panel-card">
        <div className="dev-panel-head">
          <span className="dev-panel-title">{t('developerCenter.request')}</span>
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
        </div>
        <div role="tabpanel" className="dev-panel-body">
          <CopyButton text={samples[lang]} label={t('developerCenter.copyCode')} compact />
          <pre>
            <code>{samples[lang]}</code>
          </pre>
        </div>
      </div>
      {current && (
        <div className="dev-panel-card">
          <div className="dev-panel-head">
            <span className="dev-panel-title">{t('developerCenter.response')}</span>
            <div className="dev-tabs" role="tablist" aria-label={t('developerCenter.responses')}>
              {examples.map(e => (
                <button
                  key={e.status}
                  type="button"
                  role="tab"
                  aria-selected={current.status === e.status}
                  className={`dev-tab dev-tab--status${current.status === e.status ? ' dev-tab--active' : ''}`}
                  onClick={() => setStatus(e.status)}
                >
                  <span className={`dev-dot dev-dot--${e.status[0]}xx`} aria-hidden="true" />
                  {e.status}
                </button>
              ))}
            </div>
          </div>
          <div role="tabpanel" className="dev-panel-body">
            <CopyButton
              text={JSON.stringify(current.example, null, 2)}
              label={t('developerCenter.copyResponse')}
              compact
            />
            <pre>
              <code>
                <JsonCode value={JSON.stringify(current.example, null, 2)} />
              </code>
            </pre>
          </div>
        </div>
      )}
    </aside>
  );
}

function EndpointDetail({ doc, endpoint }: { doc: OpenApiDocument; endpoint: Endpoint }) {
  const { t } = useTranslation();
  const [tryOpen, setTryOpen] = useState(false);
  const op = endpoint.operation;
  const origin = apiOrigin();
  const fullUrl = `${origin}${endpoint.path}`;
  const role = requiredRole(op);
  const publicOp = isPublic(doc, op);
  const bearer = usesBearer(op);
  const body = op.requestBody?.content?.['application/json'];
  const bodyExample = useMemo(() => (body ? mediaExample(doc, body) : undefined), [doc, body]);
  const shareUrl = `${window.location.origin}/developer?op=${encodeURIComponent(endpoint.id)}`;
  const responses = Object.entries(op.responses ?? {});
  const [activeStatus, setActiveStatus] = useState(
    () => responses.find(([s]) => s.startsWith('2'))?.[0] ?? responses[0]?.[0],
  );
  const activeResponse = responses.find(([s]) => s === activeStatus)?.[1];
  const activeMedia = activeResponse?.content?.['application/json'];
  const TagIcon = TAG_ICONS[endpoint.tag] ?? Boxes;

  return (
    <article className="dev-detail" aria-labelledby="dev-detail-title">
      <div className="dev-detail-main">
        <header className="dev-detail-header">
          <div className="dev-breadcrumb">
            <TagIcon size={14} aria-hidden="true" />
            <span>{endpoint.tag}</span>
            {op.deprecated && <span className="dev-deprecated">{t('developerCenter.deprecated')}</span>}
          </div>
          <h2 id="dev-detail-title" className="dev-detail-title">
            {endpoint.summary || endpoint.path}
          </h2>
          <div className="dev-url">
            <MethodBadge method={endpoint.method} />
            <code className="dev-url-path" title={fullUrl}>
              <PathText path={endpoint.path} />
            </code>
            <span className="dev-url-actions">
              <CopyButton text={fullUrl} label={t('developerCenter.copyUrl')} compact />
              <CopyButton text={shareUrl} label={t('developerCenter.copyLink')} compact />
            </span>
          </div>
          <div className="dev-chips">
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
            <span className="dev-chip dev-chip--quiet">
              operationId: <code>{endpoint.id}</code>
            </span>
          </div>
          {op.description && <p className="dev-description">{op.description}</p>}
        </header>

        {endpoint.parameters.length > 0 && (
          <Section title={t('developerCenter.parameters')}>
            <ul className="dev-props dev-props--flat">
              {endpoint.parameters.map(p => (
                <li key={`${p.in}-${p.name}`} className="dev-prop">
                  <div className="dev-prop-head">
                    <code className="dev-field-name">{p.name}</code>
                    <span className="dev-type">{typeLabel(doc, p.schema)}</span>
                    <span className="dev-in">{p.in}</span>
                    {p.required && <span className="dev-required">{t('developerCenter.required')}</span>}
                  </div>
                  <div className="dev-prop-body">
                    {p.description && <p className="dev-desc">{p.description}</p>}
                    <div className="dev-muted">
                      {t('developerCenter.example')}: <code>{String(paramExample(doc, p))}</code>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {body && (
          <Section
            title={t('developerCenter.requestBody')}
            aside={
              <span className="dev-section-meta">
                application/json
                {op.requestBody?.required && <span className="dev-required">{t('developerCenter.required')}</span>}
              </span>
            }
          >
            {op.requestBody?.description && <p className="dev-description">{op.requestBody.description}</p>}
            <PropertyList doc={doc} schema={body.schema} />
            {bodyExample !== undefined && (
              <details className="dev-example">
                <summary>
                  <ChevronRight size={14} aria-hidden="true" />
                  {t('developerCenter.exampleBody')}
                </summary>
                <CodeBlock
                  code={JSON.stringify(bodyExample, null, 2)}
                  json
                  copyLabel={t('developerCenter.copyBody')}
                  title="JSON"
                />
              </details>
            )}
          </Section>
        )}

        {responses.length > 0 && (
          <Section title={t('developerCenter.responses')}>
            <div className="dev-status-tabs" role="tablist" aria-label={t('developerCenter.responses')}>
              {responses.map(([status]) => (
                <button
                  key={status}
                  type="button"
                  role="tab"
                  aria-selected={status === activeStatus}
                  className={`${statusClass(status)} dev-status-tab${status === activeStatus ? ' dev-status-tab--active' : ''}`}
                  onClick={() => setActiveStatus(status)}
                >
                  {status}
                </button>
              ))}
            </div>
            {activeResponse && (
              <div role="tabpanel" className="dev-response">
                <p className="dev-response-desc">{activeResponse.description}</p>
                {activeMedia ? (
                  <PropertyList key={activeStatus} doc={doc} schema={activeMedia.schema} />
                ) : (
                  <p className="dev-muted">{t('developerCenter.noBody')}</p>
                )}
              </div>
            )}
          </Section>
        )}

        <section className="dev-section dev-try-card">
          <div className="dev-section-head">
            <h3>
              <Zap size={16} aria-hidden="true" />
              {t('developerCenter.tryIt')}
            </h3>
          </div>
          {tryOpen ? (
            <TryIt key={endpoint.id} doc={doc} endpoint={endpoint} />
          ) : (
            <button type="button" className="btn-secondary dev-try-open" onClick={() => setTryOpen(true)}>
              <Play size={16} />
              {t('developerCenter.openTryIt')}
            </button>
          )}
        </section>
      </div>
      <CodePanel key={endpoint.id} doc={doc} endpoint={endpoint} />
    </article>
  );
}

function IntroCard({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="dev-intro-card">
      <div className="dev-intro-icon" aria-hidden="true">
        <Icon size={18} />
      </div>
      <h3>{title}</h3>
      <div className="dev-intro-text">{children}</div>
    </div>
  );
}

function Intro({ doc }: { doc: OpenApiDocument }) {
  const { t } = useTranslation();
  const origin = apiOrigin();
  const [collapsed, setCollapsed] = useState(readIntroCollapsed);
  const toggle = () =>
    setCollapsed(c => {
      writeIntroCollapsed(!c);
      return !c;
    });
  return (
    <section className="dev-intro" aria-labelledby="dev-intro-title">
      <button type="button" className="dev-intro-toggle" aria-expanded={!collapsed} onClick={toggle}>
        <h2 id="dev-intro-title">{t('developerCenter.introTitle')}</h2>
        <span className="dev-muted">{collapsed ? t('developerCenter.showIntro') : t('developerCenter.hideIntro')}</span>
        <ChevronDown size={16} aria-hidden="true" className="dev-intro-chevron" />
      </button>
      {!collapsed && (
        <div className="dev-intro-grid">
          <IntroCard icon={KeyRound} title={t('developerCenter.authTitle')}>
            <p>{t('developerCenter.authHelp')}</p>
            <code className="dev-inline-block">X-API-Key: YOUR_API_KEY</code>
            <p>
              {t('developerCenter.authKeys')} <Link to="/api-keys">{t('nav.apiKeys')}</Link>.
            </p>
            <ul className="dev-roles">
              <li>
                <span className="dev-role">admin</span> {t('developerCenter.roleAdmin')}
              </li>
              <li>
                <span className="dev-role">operator</span> {t('developerCenter.roleOperator')}
              </li>
              <li>
                <span className="dev-role">viewer</span> {t('developerCenter.roleViewer')}
              </li>
            </ul>
          </IntroCard>
          <IntroCard icon={Globe} title={t('developerCenter.baseUrl')}>
            <div className="dev-url dev-url--small">
              <code className="dev-url-path">{`${origin}/api`}</code>
              <CopyButton text={`${origin}/api`} label={t('developerCenter.copyUrl')} compact />
            </div>
            <p>{t('developerCenter.baseUrlHelp', { version: doc.info?.version ?? '' })}</p>
          </IntroCard>
          <IntroCard icon={Phone} title={t('developerCenter.chatIdTitle')}>
            <p>{t('developerCenter.chatIdPerson')}</p>
            <code className="dev-inline-block">{`${SAMPLE_PHONE}@c.us`}</code>
            <p>{t('developerCenter.chatIdGroup')}</p>
            <code className="dev-inline-block">120363000000000000@g.us</code>
            <p>{t('developerCenter.chatIdHelp')}</p>
          </IntroCard>
          <IntroCard icon={AlertTriangle} title={t('developerCenter.errorsTitle')}>
            <p>{t('developerCenter.errorsHelp')}</p>
            <CodeBlock
              code={JSON.stringify(
                { statusCode: 400, message: 'chatId must be a string', error: 'Bad Request', code: 'OPTIONAL_CODE' },
                null,
                2,
              )}
              json
              copyLabel={t('developerCenter.copyCode')}
              title="JSON"
            />
            <p>{t('developerCenter.rateLimits')}</p>
          </IntroCard>
          <IntroCard icon={Bell} title={t('developerCenter.webhooksTitle')}>
            <p>
              {t('developerCenter.webhooksHelp')} <Link to="/webhooks">{t('nav.webhooks')}</Link>.
            </p>
          </IntroCard>
          <IntroCard icon={Radio} title={t('developerCenter.wsTitle')}>
            <p>{t('developerCenter.wsHelp')}</p>
            <CodeBlock
              code={`import { io } from 'socket.io-client';\n\nconst socket = io('${origin}/events', {\n  auth: { apiKey: 'YOUR_API_KEY' },\n});\nsocket.on('connect', () => {\n  socket.emit('message', { type: 'subscribe', sessionId: 'my-session', events: ['message.received'] });\n});\nsocket.on('message', event => console.log(event));`}
              copyLabel={t('developerCenter.copyCode')}
              title="JavaScript"
            />
          </IntroCard>
        </div>
      )}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="dev-skeleton" aria-busy="true">
      <div className="dev-layout">
        <div className="dev-skel-col">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="dev-skel dev-skel--line" />
          ))}
        </div>
        <div className="dev-skel-col">
          <div className="dev-skel dev-skel--title" />
          <div className="dev-skel dev-skel--block" />
          <div className="dev-skel dev-skel--block" />
        </div>
      </div>
    </div>
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsedTags, setCollapsedTags] = useState<Set<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let live = true;
    loadSpec()
      .then(d => live && setDoc(d))
      .catch((err: unknown) => live && setLoadError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, []);

  // Cmd/Ctrl+K anywhere, or "/" outside a text field, focuses the search; Escape closes the drawer.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === 'Escape') {
        setDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { engineType } = useRole();
  const activeEngine = isEngineId(engineType) ? engineType : null;
  const [showAllEngines, setShowAllEngines] = useState(false);
  const allEndpoints = useMemo(() => (doc ? listEndpoints(doc) : []), [doc]);
  // By default only the operations the ACTIVE engine can serve are listed; the others answer 501.
  const hiddenCount = useMemo(
    () => allEndpoints.filter(e => !endpointRunsOn(e, activeEngine)).length,
    [allEndpoints, activeEngine],
  );
  const endpoints = useMemo(
    () => (showAllEngines ? allEndpoints : allEndpoints.filter(e => endpointRunsOn(e, activeEngine))),
    [allEndpoints, showAllEngines, activeEngine],
  );
  const filtered = useMemo(() => filterEndpoints(endpoints, query), [endpoints, query]);
  const groups = useMemo(() => (doc ? groupByTag(doc, filtered) : []), [doc, filtered]);
  const tagCount = useMemo(() => new Set(endpoints.map(e => e.tag)).size, [endpoints]);
  const selectedId = parseDeepLink(location.search, location.hash);
  const selected = endpoints.find(e => e.id === selectedId) ?? null;
  const searching = query.trim() !== '';

  const select = useCallback(
    (e: Endpoint) => {
      navigate({ pathname: '/developer', search: `?op=${encodeURIComponent(e.id)}`, hash: `#${e.tag}/${e.id}` });
      setDrawerOpen(false);
    },
    [navigate],
  );

  const toggleTag = (tag: string) =>
    setCollapsedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  // Up/down moves between the visible endpoint buttons in the sidebar.
  const onNavKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(navRef.current?.querySelectorAll<HTMLButtonElement>('.dev-op') ?? [])];
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = at === -1 ? 0 : e.key === 'ArrowDown' ? Math.min(items.length - 1, at + 1) : Math.max(0, at - 1);
    items[next].focus();
  };

  useEffect(() => {
    if (selected) document.getElementById('dev-detail-title')?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  const origin = apiOrigin();

  return (
    <div className="dev-page">
      <PageHeader
        title={t('developerCenter.title')}
        subtitle={t('developerCenter.tagline')}
        badge={doc?.info?.version ? <span className="dev-version">v{doc.info.version}</span> : undefined}
      />
      <div className="dev-toolbar">
        <label className="dev-search">
          <Search size={18} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder={t('developerCenter.searchPlaceholder')}
            aria-label={t('developerCenter.searchPlaceholder')}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && filtered[0]) select(filtered[0]);
            }}
          />
          <kbd className="dev-kbd" aria-hidden="true">
            ⌘K
          </kbd>
        </label>
        <div className="dev-toolbar-meta">
          <div className="dev-base-chip">
            <Globe size={14} aria-hidden="true" />
            <code>{`${origin}/api`}</code>
            <CopyButton text={`${origin}/api`} label={t('developerCenter.copyUrl')} compact />
          </div>
          <div className="dev-stat">
            <strong>{doc ? endpoints.length : '–'}</strong> {t('developerCenter.statEndpoints')}
          </div>
          <div className="dev-stat">
            <strong>{doc ? tagCount : '–'}</strong> {t('developerCenter.statTags')}
          </div>
          {activeEngine && (
            <span className="dev-engine-chip" title={t('developerCenter.engineChipHint')}>
              <Cpu size={14} aria-hidden="true" />
              {t('developerCenter.showingFor', { engine: ENGINE_LABELS[activeEngine] })}
            </span>
          )}
          {activeEngine && hiddenCount > 0 && (
            <label className="dev-engine-toggle">
              <input type="checkbox" checked={showAllEngines} onChange={e => setShowAllEngines(e.target.checked)} />
              {t('developerCenter.showAllEngines', { count: hiddenCount })}
            </label>
          )}
        </div>
      </div>

      {loadError && (
        <div className="error-banner" role="alert">
          {t('developerCenter.loadFailed')}: {loadError}
        </div>
      )}
      {!doc && !loadError && <Skeleton />}
      {doc && (
        <>
          <Intro doc={doc} />
          <div className="dev-mobile-bar">
            <button
              type="button"
              className="dev-drawer-btn"
              aria-expanded={drawerOpen}
              aria-controls="dev-sidebar"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu size={16} aria-hidden="true" />
              {t('developerCenter.endpoints')} ({filtered.length})
            </button>
          </div>
          <div className="dev-layout">
            {drawerOpen && <div className="dev-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
            <nav
              id="dev-sidebar"
              ref={navRef}
              className={`dev-sidebar${drawerOpen ? ' dev-sidebar--open' : ''}`}
              aria-label={t('developerCenter.endpoints')}
              onKeyDown={onNavKey}
            >
              <div className="dev-sidebar-top">
                <span className="dev-sidebar-heading">
                  <ListTree size={14} aria-hidden="true" />
                  {t('developerCenter.endpoints')}
                  <span className="dev-count">{filtered.length}</span>
                </span>
                <button
                  type="button"
                  className="dev-icon-btn dev-drawer-close"
                  aria-label={t('developerCenter.close')}
                  onClick={() => setDrawerOpen(false)}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              <div className="dev-sidebar-body">
                {groups.length === 0 && <p className="dev-muted dev-no-results">{t('developerCenter.noResults')}</p>}
                {groups.map(g => {
                  const open = searching || !collapsedTags.has(g.tag);
                  const Icon = TAG_ICONS[g.tag] ?? Boxes;
                  return (
                    <div key={g.tag} className="dev-group">
                      <h3 className="dev-group-title" title={g.description}>
                        <button
                          type="button"
                          className="dev-group-btn"
                          aria-expanded={open}
                          onClick={() => toggleTag(g.tag)}
                        >
                          <Icon size={15} aria-hidden="true" className="dev-group-icon" />
                          <span className="dev-group-name">{g.tag}</span>
                          <span className="dev-count">{g.endpoints.length}</span>
                          <ChevronDown size={14} aria-hidden="true" className="dev-group-chevron" />
                        </button>
                      </h3>
                      {open && (
                        <ul>
                          {g.endpoints.map(e => (
                            <li key={e.id}>
                              <button
                                type="button"
                                className={`dev-op${selected?.id === e.id ? ' dev-op--active' : ''}`}
                                aria-current={selected?.id === e.id ? 'true' : undefined}
                                title={e.path}
                                onClick={() => select(e)}
                              >
                                <MethodBadge method={e.method} />
                                <span className="dev-op-text">
                                  <span className="dev-op-summary">{e.summary || e.path}</span>
                                  <span className="dev-op-path">{e.path.replace(/^\/api/, '')}</span>
                                  {!endpointRunsOn(e, activeEngine) && (
                                    <span className="dev-op-engine">
                                      {t('developerCenter.needsEngine', {
                                        engine: (operationEngines(e.operation) ?? [])
                                          .map(id => (isEngineId(id) ? ENGINE_LABELS[id] : id))
                                          .join(' / '),
                                      })}
                                    </span>
                                  )}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </nav>
            <div className="dev-main">
              {selected ? (
                <EndpointDetail key={selected.id} doc={doc} endpoint={selected} />
              ) : (
                <div className="dev-empty">
                  <div className="dev-empty-icon" aria-hidden="true">
                    <Link2 size={22} />
                  </div>
                  <p>{t('developerCenter.pickEndpoint')}</p>
                  <p className="dev-muted">
                    <kbd className="dev-kbd">/</kbd> {t('developerCenter.searchHint')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
