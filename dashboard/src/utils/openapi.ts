// Pure helpers behind the Developer Center: walk the gateway's OpenAPI 3 document (the root
// openapi.json, bundled at build time), resolve $ref/allOf/oneOf/anyOf, flatten schemas into
// readable field rows, build example values and code samples, and filter the endpoint list.
// No React and no DOM, so node:test exercises them directly.

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
export const HTTP_METHODS: readonly HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];

export interface SchemaObject {
  $ref?: string;
  type?: string | string[];
  format?: string;
  description?: string;
  example?: unknown;
  default?: unknown;
  enum?: unknown[];
  nullable?: boolean;
  deprecated?: boolean;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  items?: SchemaObject;
  additionalProperties?: boolean | SchemaObject;
  allOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  minItems?: number;
  pattern?: string;
}

export interface ParameterObject {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: SchemaObject;
  example?: unknown;
}

export interface MediaTypeObject {
  schema?: SchemaObject;
  example?: unknown;
  examples?: Record<string, { summary?: string; value?: unknown }>;
}

export interface ResponseObject {
  description?: string;
  content?: Record<string, MediaTypeObject>;
}

export interface OperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: ParameterObject[];
  requestBody?: { required?: boolean; description?: string; content?: Record<string, MediaTypeObject> };
  responses?: Record<string, ResponseObject>;
  security?: Array<Record<string, string[]>>;
  deprecated?: boolean;
  /** Engines that can serve this operation; absent means every engine (the server's x-engines extension). */
  'x-engines'?: string[];
}

export interface OpenApiDocument {
  openapi?: string;
  info?: { title?: string; description?: string; version?: string };
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, Partial<Record<HttpMethod, OperationObject>> & { parameters?: ParameterObject[] }>;
  components?: { schemas?: Record<string, SchemaObject>; securitySchemes?: Record<string, unknown> };
  security?: Array<Record<string, string[]>>;
}

/** One endpoint as the page lists it. */
export interface Endpoint {
  id: string;
  method: HttpMethod;
  path: string;
  tag: string;
  summary: string;
  operation: OperationObject;
  parameters: ParameterObject[];
}

/** Resolves a local `#/components/...` pointer; anything else (or a dangling ref) yields undefined. */
export function resolveRef<T = SchemaObject>(doc: OpenApiDocument, ref: string): T | undefined {
  if (!ref.startsWith('#/')) return undefined;
  let node: unknown = doc;
  for (const raw of ref.slice(2).split('/')) {
    const part = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node as T | undefined;
}

export function refName(ref: string): string {
  return ref.slice(ref.lastIndexOf('/') + 1);
}

/**
 * Follows $ref and merges allOf into one schema. Sibling keywords of a $ref/allOf (e.g. the
 * description Nest puts next to `allOf: [{$ref}]`) win over the referenced schema's own.
 * `seen` stops self-referencing schemas from recursing forever.
 */
export function deref(
  doc: OpenApiDocument,
  schema: SchemaObject | undefined,
  seen: Set<string> = new Set(),
): SchemaObject {
  if (!schema) return {};
  let base: SchemaObject = schema;
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return { type: 'object', description: `(recursive ${refName(schema.$ref)})` };
    const target = resolveRef(doc, schema.$ref);
    const { $ref: _ref, ...rest } = schema;
    void _ref;
    base = { ...deref(doc, target, new Set([...seen, schema.$ref])), ...rest };
  }
  if (base.allOf && base.allOf.length > 0) {
    const { allOf, ...rest } = base;
    let merged: SchemaObject = {};
    for (const part of allOf) {
      const p = deref(doc, part, seen);
      merged = {
        ...merged,
        ...p,
        properties: { ...merged.properties, ...p.properties },
        required: [...(merged.required ?? []), ...(p.required ?? [])],
      };
    }
    base = {
      ...merged,
      ...rest,
      properties: { ...merged.properties, ...rest.properties },
      required: [...(merged.required ?? []), ...(rest.required ?? [])],
    };
    if (Object.keys(base.properties ?? {}).length === 0) delete base.properties;
    if ((base.required ?? []).length === 0) delete base.required;
  }
  return base;
}

/** A short human type label: `string<date-time>`, `array<MessageDto>`, `"a" | "b"`, `string | string[]`. */
export function typeLabel(doc: OpenApiDocument, schema: SchemaObject | undefined): string {
  if (!schema) return 'any';
  if (schema.$ref && !schema.allOf) {
    const target = deref(doc, schema);
    if (target.enum) return 'enum';
    if (target.type && target.type !== 'object') return typeLabel(doc, target);
    return refName(schema.$ref);
  }
  if (schema.allOf?.length === 1 && schema.allOf[0].$ref && !schema.properties) {
    return typeLabel(doc, schema.allOf[0]);
  }
  const variants = schema.oneOf ?? schema.anyOf;
  if (variants) return variants.map(v => typeLabel(doc, v)).join(' | ');
  if (schema.enum) return 'enum';
  const type = Array.isArray(schema.type) ? schema.type.join(' | ') : schema.type;
  if (type === 'array') return `${typeLabel(doc, schema.items)}[]`;
  if (!type) return schema.properties ? 'object' : 'any';
  return schema.format ? `${type}<${schema.format}>` : type;
}

/** One row of the readable field table. `depth` indents nested properties (`a.b`, `items[].c`). */
export interface FieldRow {
  name: string;
  path: string;
  depth: number;
  type: string;
  required: boolean;
  description?: string;
  enumValues?: string[];
  example?: unknown;
  constraints?: string;
  nullable?: boolean;
  deprecated?: boolean;
}

function constraintsOf(s: SchemaObject): string | undefined {
  const parts: string[] = [];
  if (s.minLength !== undefined) parts.push(`min length ${s.minLength}`);
  if (s.maxLength !== undefined) parts.push(`max length ${s.maxLength}`);
  if (s.minimum !== undefined) parts.push(`min ${s.minimum}`);
  if (s.maximum !== undefined) parts.push(`max ${s.maximum}`);
  if (s.minItems !== undefined) parts.push(`min items ${s.minItems}`);
  if (s.maxItems !== undefined) parts.push(`max items ${s.maxItems}`);
  if (s.pattern) parts.push(`pattern ${s.pattern}`);
  if (s.default !== undefined) parts.push(`default ${JSON.stringify(s.default)}`);
  return parts.length ? parts.join(', ') : undefined;
}

const MAX_FIELD_DEPTH = 6;

/** Flattens an object/array schema into rows, recursing into nested objects, array items and variants. */
export function schemaFields(
  doc: OpenApiDocument,
  schema: SchemaObject | undefined,
  prefix = '',
  depth = 0,
  seen: Set<string> = new Set(),
): FieldRow[] {
  if (!schema || depth > MAX_FIELD_DEPTH) return [];
  const nextSeen = schema.$ref ? new Set([...seen, schema.$ref]) : seen;
  if (schema.$ref && seen.has(schema.$ref)) return [];
  const s = deref(doc, schema, seen);
  if (s.type === 'array' || s.items) {
    return schemaFields(doc, s.items, `${prefix}[]`, depth, nextSeen);
  }
  const variants = s.oneOf ?? s.anyOf;
  if (variants && !s.properties) {
    // Show the fields of every object variant; scalar variants are already in the type label.
    return variants.flatMap(v => schemaFields(doc, v, prefix, depth, nextSeen));
  }
  const rows: FieldRow[] = [];
  const required = new Set(s.required ?? []);
  for (const [name, raw] of Object.entries(s.properties ?? {})) {
    const prop = deref(doc, raw, nextSeen);
    const path = prefix ? `${prefix}.${name}` : name;
    rows.push({
      name,
      path,
      depth,
      type: typeLabel(doc, raw),
      required: required.has(name),
      description: raw.description ?? prop.description,
      enumValues: (prop.enum ?? (prop.items ? deref(doc, prop.items, nextSeen).enum : undefined))?.map(String),
      example: raw.example ?? prop.example,
      constraints: constraintsOf(prop),
      nullable: prop.nullable,
      deprecated: prop.deprecated,
    });
    const childRef = raw.$ref ?? (raw.allOf?.length === 1 ? raw.allOf[0].$ref : undefined) ?? prop.items?.$ref;
    if (childRef && nextSeen.has(childRef)) continue;
    if (prop.items) {
      const item = deref(doc, prop.items, nextSeen);
      if (item.properties || item.oneOf || item.anyOf)
        rows.push(...schemaFields(doc, prop.items, `${path}[]`, depth + 1, nextSeen));
    } else if (prop.properties || prop.oneOf || prop.anyOf) {
      rows.push(...schemaFields(doc, raw, path, depth + 1, nextSeen));
    }
  }
  return rows;
}

// The bundled spec's examples use Indonesian numbers (62...). The company's developers work with Pakistan
// (+92) numbers, so generated examples swap a 62-prefixed phone/WID for the canonical PK sample.
export const SAMPLE_PHONE = '923001234567';
const ID_PHONE = /^(\+?)62\d{5,13}(@c\.us|@s\.whatsapp\.net)?$/;

export function localizeExample(value: unknown): unknown {
  if (typeof value === 'string') {
    const m = ID_PHONE.exec(value);
    if (m) return `${m[1]}${SAMPLE_PHONE}${m[2] ?? ''}`;
    // A sample number embedded in a longer id, e.g. `true_628123456789@c.us_3EB0...`.
    return value.replace(/(^|[^\d])628\d{8,11}(?=@)/g, `$1${SAMPLE_PHONE}`);
  }
  if (Array.isArray(value)) return value.map(localizeExample);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, localizeExample(v)]));
  }
  return value;
}

function scalarExample(s: SchemaObject, name: string): unknown {
  const type = Array.isArray(s.type) ? s.type[0] : s.type;
  switch (type) {
    case 'integer':
    case 'number':
      return s.minimum ?? 1;
    case 'boolean':
      return true;
    case 'string':
      if (s.format === 'date-time') return '2026-01-01T00:00:00.000Z';
      if (s.format === 'date') return '2026-01-01';
      if (s.format === 'uri' || s.format === 'url' || /url$/i.test(name)) return 'https://example.com/resource';
      if (s.format === 'uuid') return '3fa85f64-5717-4562-b3fc-2c963f66afa6';
      if (s.format === 'email') return 'dev@example.com';
      if (/chatid$/i.test(name)) return `${SAMPLE_PHONE}@c.us`;
      if (/phone|number$/i.test(name)) return SAMPLE_PHONE;
      return 'string';
    default:
      return null;
  }
}

/**
 * Builds an example value for a schema: the schema's own `example` first, then `default`, the first
 * enum value, and finally a type-shaped placeholder. Objects list required properties and every
 * property that carries an example, so the result reads like a realistic request.
 */
export function exampleFromSchema(
  doc: OpenApiDocument,
  schema: SchemaObject | undefined,
  name = '',
  depth = 0,
  seen: Set<string> = new Set(),
): unknown {
  if (!schema || depth > MAX_FIELD_DEPTH) return undefined;
  if (schema.$ref && seen.has(schema.$ref)) return {};
  const nextSeen = schema.$ref ? new Set([...seen, schema.$ref]) : seen;
  const s = deref(doc, schema, seen);
  if (s.example !== undefined) return localizeExample(s.example);
  if (s.default !== undefined) return s.default;
  if (s.enum?.length) return s.enum[0];
  const variants = s.oneOf ?? s.anyOf;
  if (variants?.length && !s.properties) return exampleFromSchema(doc, variants[0], name, depth, nextSeen);
  if (s.type === 'array' || s.items) {
    const item = exampleFromSchema(doc, s.items, name, depth + 1, nextSeen);
    return item === undefined ? [] : [item];
  }
  if (s.properties || s.type === 'object') {
    const required = new Set(s.required ?? []);
    const out: Record<string, unknown> = {};
    const entries = Object.entries(s.properties ?? {});
    // Small objects are shown whole; big DTOs only with their required and exemplified fields.
    const showAll = entries.length <= 4 || depth > 0;
    for (const [key, raw] of entries) {
      const prop = deref(doc, raw, nextSeen);
      if (!showAll && !required.has(key) && raw.example === undefined && prop.example === undefined) continue;
      if (prop.deprecated && !required.has(key)) continue;
      const value = exampleFromSchema(doc, { ...raw, example: raw.example ?? prop.example }, key, depth + 1, nextSeen);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
  return scalarExample(s, name);
}

/** The example for a media type: an explicit `example`, the first named `examples` entry, or one built from the schema. */
export function mediaExample(doc: OpenApiDocument, media: MediaTypeObject | undefined): unknown {
  if (!media) return undefined;
  if (media.example !== undefined) return localizeExample(media.example);
  const first = media.examples ? Object.values(media.examples)[0] : undefined;
  if (first?.value !== undefined) return localizeExample(first.value);
  return exampleFromSchema(doc, media.schema);
}

export function paramExample(doc: OpenApiDocument, p: ParameterObject): unknown {
  if (p.example !== undefined) return localizeExample(p.example);
  const fromSchema = exampleFromSchema(doc, p.schema, p.name);
  if (fromSchema !== undefined && fromSchema !== 'string') return fromSchema;
  if (/sessionid/i.test(p.name)) return 'my-session';
  if (/chatid|contactid|groupid/i.test(p.name))
    return /group/i.test(p.name) ? '120363000000000000@g.us' : `${SAMPLE_PHONE}@c.us`;
  if (/number|phone/i.test(p.name)) return SAMPLE_PHONE;
  if (/id$/i.test(p.name)) return `${p.name}-123`;
  return fromSchema ?? 'value';
}

/** Lists every operation of the document, with path-level parameters merged into each. */
export function listEndpoints(doc: OpenApiDocument): Endpoint[] {
  const out: Endpoint[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const own = operation.parameters ?? [];
      const inherited = (item.parameters ?? []).filter(p => !own.some(o => o.name === p.name && o.in === p.in));
      out.push({
        id: operation.operationId ?? `${method}-${path}`,
        method,
        path,
        tag: operation.tags?.[0] ?? 'other',
        summary: operation.summary ?? '',
        operation,
        parameters: [...inherited, ...own],
      });
    }
  }
  return out;
}

/** Engines that can serve an operation, or null when it works on every engine. */
export function operationEngines(op: OperationObject): string[] | null {
  const engines = op['x-engines'];
  return Array.isArray(engines) ? engines : null;
}

/** Whether an operation runs on the given engine. An unknown (null) engine keeps every operation. */
export function endpointRunsOn(endpoint: Endpoint, engine: string | null): boolean {
  const engines = operationEngines(endpoint.operation);
  return engines === null || engine === null || engines.includes(engine);
}

/** Case-insensitive match on path, summary, tag and operationId; every whitespace-separated term must hit. */
export function filterEndpoints(endpoints: Endpoint[], query: string): Endpoint[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return endpoints;
  return endpoints.filter(e => {
    const hay = `${e.method} ${e.path} ${e.summary} ${e.tag} ${e.id}`.toLowerCase();
    return terms.every(t => hay.includes(t));
  });
}

/** Groups endpoints by tag, in the document's tag order, then any tag the document does not declare. */
export function groupByTag(
  doc: OpenApiDocument,
  endpoints: Endpoint[],
): Array<{ tag: string; description?: string; endpoints: Endpoint[] }> {
  const groups = new Map<string, Endpoint[]>();
  for (const e of endpoints) groups.set(e.tag, [...(groups.get(e.tag) ?? []), e]);
  const declared = (doc.tags ?? []).map(t => t.name);
  const order = [
    ...declared.filter(t => groups.has(t)),
    ...[...groups.keys()].filter(t => !declared.includes(t)).sort(),
  ];
  return order.map(tag => ({
    tag,
    description: doc.tags?.find(t => t.name === tag)?.description,
    endpoints: groups.get(tag) ?? [],
  }));
}

/** The role an operation needs, when its description or 403 response states one (the spec has no field for it). */
export function requiredRole(op: OperationObject): 'admin' | 'operator' | 'viewer' | null {
  const text = `${op.description ?? ''} ${op.responses?.['403']?.description ?? ''}`;
  const m = /(?:lacks(?: the)?|requires an?|requires the)\s+(ADMIN|OPERATOR|VIEWER)\b/i.exec(text);
  return m ? (m[1].toLowerCase() as 'admin' | 'operator' | 'viewer') : null;
}

/** Whether the operation is public (no API key), as `security: []` declares. */
export function isPublic(doc: OpenApiDocument, op: OperationObject): boolean {
  const sec = op.security ?? doc.security ?? [];
  return sec.length === 0;
}

/** Whether the operation is authenticated with the metrics bearer token instead of the API key. */
export function usesBearer(op: OperationObject): boolean {
  return (op.security ?? []).some(s => 'metrics-bearer' in s);
}

// --------------------------------------------------------------------------------------------
// Request building and code samples
// --------------------------------------------------------------------------------------------

export interface RequestValues {
  path: Record<string, string>;
  query: Record<string, string>;
  header: Record<string, string>;
  body?: unknown;
}

function stringify(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** Example values for every parameter and the body; optional query params are left out to keep samples short. */
export function exampleRequest(doc: OpenApiDocument, endpoint: Endpoint): RequestValues {
  const values: RequestValues = { path: {}, query: {}, header: {} };
  for (const p of endpoint.parameters) {
    if (p.in === 'path') values.path[p.name] = stringify(paramExample(doc, p));
    else if (p.in === 'query' && p.required) values.query[p.name] = stringify(paramExample(doc, p));
    else if (p.in === 'header' && p.required) values.header[p.name] = stringify(paramExample(doc, p));
  }
  const json = endpoint.operation.requestBody?.content?.['application/json'];
  if (json) values.body = mediaExample(doc, json);
  return values;
}

/** The full URL: path params substituted (URL-encoded), empty query values dropped. */
export function buildUrl(origin: string, path: string, values: Pick<RequestValues, 'path' | 'query'>): string {
  const filled = path.replace(/\{([^}]+)\}/g, (_, name: string) =>
    values.path[name] !== undefined && values.path[name] !== '' ? encodeURIComponent(values.path[name]) : `{${name}}`,
  );
  const qs = Object.entries(values.query)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${origin.replace(/\/+$/, '')}${filled}${qs ? `?${qs}` : ''}`;
}

export type SampleLanguage = 'curl' | 'javascript' | 'python' | 'php';
export const SAMPLE_LANGUAGES: readonly SampleLanguage[] = ['curl', 'javascript', 'python', 'php'];

/** The placeholder every sample carries; the user's real key is never inserted. */
export const API_KEY_PLACEHOLDER = 'YOUR_API_KEY';

function authHeader(op: OperationObject, publicOp: boolean): [string, string] | null {
  if (publicOp) return null;
  if (usesBearer(op)) return ['Authorization', 'Bearer YOUR_METRICS_TOKEN'];
  return ['X-API-Key', API_KEY_PLACEHOLDER];
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function phpValue(v: unknown, indent: string): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const inner = `${indent}    `;
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return `[\n${v.map(x => `${inner}${phpValue(x, inner)}`).join(',\n')},\n${indent}]`;
  }
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length === 0) return 'new stdClass()';
  return `[\n${entries.map(([k, x]) => `${inner}'${k}' => ${phpValue(x, inner)}`).join(',\n')},\n${indent}]`;
}

function pyValue(v: unknown, indent: string): string {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  const inner = `${indent}    `;
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return `[\n${v.map(x => `${inner}${pyValue(x, inner)}`).join(',\n')},\n${indent}]`;
  }
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length === 0) return '{}';
  return `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pyValue(x, inner)}`).join(',\n')},\n${indent}}`;
}

/** Generates a runnable sample for one operation in the given language. */
export function codeSample(
  lang: SampleLanguage,
  doc: OpenApiDocument,
  endpoint: Endpoint,
  origin: string,
  values: RequestValues = exampleRequest(doc, endpoint),
): string {
  const url = buildUrl(origin, endpoint.path, values);
  const method = endpoint.method.toUpperCase();
  const auth = authHeader(endpoint.operation, isPublic(doc, endpoint.operation));
  const hasBody = values.body !== undefined && endpoint.operation.requestBody !== undefined;
  const headers: Array<[string, string]> = [];
  if (auth) headers.push(auth);
  if (hasBody) headers.push(['Content-Type', 'application/json']);
  for (const [k, v] of Object.entries(values.header)) if (v !== '') headers.push([k, v]);
  const bodyJson = hasBody ? JSON.stringify(values.body, null, 2) : '';

  switch (lang) {
    case 'curl': {
      const lines = [`curl -X ${method} ${shellQuote(url)}`];
      for (const [k, v] of headers) lines.push(`  -H ${shellQuote(`${k}: ${v}`)}`);
      if (hasBody) lines.push(`  -d ${shellQuote(bodyJson)}`);
      return lines.join(' \\\n');
    }
    case 'javascript': {
      const h = headers.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
      const body = hasBody ? `\n  body: JSON.stringify(${bodyJson.replace(/\n/g, '\n  ')}),` : '';
      return [
        `const response = await fetch(${JSON.stringify(url)}, {`,
        `  method: ${JSON.stringify(method)},`,
        headers.length ? `  headers: {\n${h}\n  },${body}` : body.trimStart(),
        `});`,
        `const data = await response.json();`,
        `console.log(response.status, data);`,
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'python': {
      const h = headers.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
      const lines = ['import requests', '', `url = ${JSON.stringify(url)}`];
      if (headers.length) lines.push(`headers = {\n${h}\n}`);
      if (hasBody) lines.push(`payload = ${pyValue(values.body, '')}`);
      const args = ['url', headers.length ? 'headers=headers' : '', hasBody ? 'json=payload' : ''].filter(Boolean);
      lines.push(
        '',
        `response = requests.${endpoint.method}(${args.join(', ')})`,
        'print(response.status_code, response.json())',
      );
      return lines.join('\n');
    }
    case 'php': {
      const h = headers.map(([k, v]) => `        '${k}: ${v.replace(/'/g, "\\'")}',`).join('\n');
      const lines = [
        '<?php',
        `$ch = curl_init('${url.replace(/'/g, "\\'")}');`,
        'curl_setopt_array($ch, [',
        '    CURLOPT_RETURNTRANSFER => true,',
        `    CURLOPT_CUSTOMREQUEST => '${method}',`,
      ];
      if (headers.length) lines.push(`    CURLOPT_HTTPHEADER => [\n${h}\n    ],`);
      if (hasBody) lines.push(`    CURLOPT_POSTFIELDS => json_encode(${phpValue(values.body, '    ')}),`);
      lines.push(
        ']);',
        '$response = curl_exec($ch);',
        '$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);',
        'curl_close($ch);',
        'echo $status, PHP_EOL, $response;',
      );
      return lines.join('\n');
    }
  }
}

// --------------------------------------------------------------------------------------------
// JSON syntax highlighting (tokens only; the component maps them to spans)
// --------------------------------------------------------------------------------------------

export type JsonTokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct' | 'text';
export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

const JSON_TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}[\],:])/g;

/** Splits JSON-ish text into highlight tokens; whatever does not match passes through as plain text. */
export function tokenizeJson(text: string): JsonToken[] {
  const out: JsonToken[] = [];
  let last = 0;
  for (const m of text.matchAll(JSON_TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    if (m[1] !== undefined) {
      out.push({ kind: m[2] ? 'key' : 'string', text: m[1] });
      if (m[2]) out.push({ kind: 'punct', text: m[2] });
    } else if (m[3] !== undefined) out.push({ kind: 'number', text: m[3] });
    else if (m[4] !== undefined) out.push({ kind: 'boolean', text: m[4] });
    else if (m[5] !== undefined) out.push({ kind: 'null', text: m[5] });
    else out.push({ kind: 'punct', text: m[6] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** Parses a deep link: `?op=<operationId>` wins, then a `#tag/<operationId>` hash. */
export function parseDeepLink(search: string, hash: string): string | null {
  const op = new URLSearchParams(search).get('op');
  if (op) return op;
  const h = decodeURIComponent(hash.replace(/^#/, ''));
  if (!h) return null;
  const slash = h.indexOf('/');
  return slash >= 0 ? h.slice(slash + 1) || null : null;
}
