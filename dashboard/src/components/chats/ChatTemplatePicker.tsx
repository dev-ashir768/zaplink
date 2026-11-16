import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { CustomSelect } from '../CustomSelect';
import { useTemplatesQuery } from '../../hooks/queries';
import { filledVars, renderTemplate, templateVariables } from '../../utils/templateRender';

export interface TemplatePick {
  templateId: string;
  vars: Record<string, string>;
  /** The text the gateway will send: header, body and footer rendered and joined. */
  text: string;
}

interface ChatTemplatePickerProps {
  sessionId: string;
  /** Puts the rendered text into the message field, to edit before sending. */
  onInsert: (text: string) => void;
  /** Sends the template through send-template to the open chat. */
  onSend: (pick: TemplatePick) => void;
  onClose: () => void;
  disabled?: boolean;
}

// The composer's template panel: pick one of the session's stored templates, fill its {{variables}}, see the
// rendered message, then send it as a template or insert the text into the field.
export function ChatTemplatePicker({
  sessionId,
  onInsert,
  onSend,
  onClose,
  disabled = false,
}: ChatTemplatePickerProps) {
  const { t } = useTranslation();
  const { data: templates = [], isLoading, error } = useTemplatesQuery(sessionId, !!sessionId);
  const [templateId, setTemplateId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});

  const template = templates.find(tpl => tpl.id === templateId) ?? null;
  const keys = useMemo(() => (template ? templateVariables(template) : []), [template]);
  const vars = filledVars(Object.fromEntries(keys.map(key => [key, values[key] ?? ''])));
  const preview = template ? renderTemplate(template, vars) : null;
  const complete = template !== null && keys.every(key => (values[key] ?? '') !== '');

  return (
    <div className="composer-banner chats-template-picker" role="region" aria-label={t('chats.template.title')}>
      <div className="chats-template-body">
        <div className="chats-template-head">
          <span className="chats-template-title" id="chats-template-label">
            {t('chats.template.title')}
          </span>
          <button type="button" className="btn-banner-close" onClick={onClose} aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </div>

        {error ? (
          <p className="chats-template-note error" role="alert">
            {t('messageTester.template.loadError', { message: error.message })}
          </p>
        ) : !isLoading && templates.length === 0 ? (
          <p className="chats-template-note">
            {t('messageTester.template.none')} <a href="/templates">{t('messageTester.template.create')}</a>
          </p>
        ) : (
          <CustomSelect
            variant="field"
            compact
            ariaLabelledBy="chats-template-label"
            value={template?.id ?? ''}
            disabled={isLoading}
            placeholder={isLoading ? t('messageTester.template.loading') : t('messageTester.template.choose')}
            options={templates.map(tpl => ({ value: tpl.id, label: tpl.name }))}
            onChange={id => {
              setTemplateId(id);
              setValues({});
            }}
            data-testid="chat-template-select"
          />
        )}

        {template && keys.length > 0 && (
          <div className="chats-template-vars">
            {keys.map(key => (
              <label key={key} className="chats-template-var">
                <span>{key}</span>
                <input
                  type="text"
                  value={values[key] ?? ''}
                  onChange={e => setValues(prev => ({ ...prev, [key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
        )}

        {preview && (
          <div className="chats-template-preview" aria-label={t('messageTester.template.preview')} role="note">
            {preview.header && <strong>{preview.header}</strong>}
            <span>{preview.body}</span>
            {preview.footer && <small>{preview.footer}</small>}
          </div>
        )}

        {template && (
          <div className="chats-template-actions">
            {!complete && <span className="chats-template-note">{t('messageTester.template.missing')}</span>}
            <button
              type="button"
              className="btn-secondary"
              disabled={disabled || !preview}
              onClick={() => preview && onInsert(preview.text)}
            >
              {t('chats.template.insert')}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={disabled || !complete || !preview}
              onClick={() => preview && onSend({ templateId: template.id, vars, text: preview.text })}
            >
              {t('chats.template.send')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
