// Client copy of the gateway's template rendering (src/common/utils/template-render.ts and the send-template path in
// message-send.service.ts), so a send can ask for each variable and preview the text it will send.

/** The gateway's renderer pattern: `{{key}}` (canonical) and the legacy single-brace `{key}`. */
export const TEMPLATE_PLACEHOLDER_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}|\{(\w+)\}/g;

export interface TemplateParts {
  header?: string | null;
  body: string;
  footer?: string | null;
}

/** The variable names a template uses across header, body and footer, each once, in order of appearance. */
export function templateVariables(template: TemplateParts): string[] {
  const seen = new Set<string>();
  for (const part of [template.header, template.body, template.footer]) {
    if (!part) continue;
    for (const [, doubleKey, singleKey] of part.matchAll(TEMPLATE_PLACEHOLDER_PATTERN))
      seen.add(doubleKey ?? singleKey);
  }
  return [...seen];
}

/** The values worth sending: own, non-empty entries only, so an unfilled placeholder stays literal as on the gateway. */
export function filledVars(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''));
}

/** One part rendered as the gateway renders it: known keys substituted, unknown ones left as written. */
export function renderTemplatePart(text: string, values: Record<string, string>): string {
  return text.replace(
    TEMPLATE_PLACEHOLDER_PATTERN,
    (match, doubleKey: string | undefined, singleKey: string | undefined) => {
      const key = (doubleKey ?? singleKey)!;
      return Object.hasOwn(values, key) && values[key] !== '' ? values[key] : match;
    },
  );
}

/** Header, body and footer rendered, and the text the gateway sends: the non-empty parts joined by a blank line. */
export function renderTemplate(
  template: TemplateParts,
  values: Record<string, string>,
): { header: string; body: string; footer: string; text: string } {
  const header = template.header ? renderTemplatePart(template.header, values) : '';
  const body = renderTemplatePart(template.body, values);
  const footer = template.footer ? renderTemplatePart(template.footer, values) : '';
  const text = [header, body, footer].filter(part => part.length > 0).join('\n\n');
  return { header, body, footer, text };
}
