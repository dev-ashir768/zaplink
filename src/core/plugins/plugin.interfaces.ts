/**
 * The built-in WhatsApp engines (whatsapp-web.js, Baileys) are registered as engine plugins. This is
 * all that remains of the plugin system: no third-party plugins are installed or loaded.
 */

export enum PluginType {
  ENGINE = 'engine',
}

export enum PluginStatus {
  INSTALLED = 'installed',
  ENABLED = 'enabled',
  DISABLED = 'disabled',
  ERROR = 'error',
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  type: PluginType;
  description?: string;
  main: string;
  provides?: string[];
}

export interface PluginLogger {
  log: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, error?: unknown, meta?: Record<string, unknown>) => void;
}

/** What an engine plugin is handed on load/enable/disable. */
export interface PluginContext {
  pluginId: string;
  manifest: PluginManifest;
  config: Record<string, unknown>;
  logger: PluginLogger;
}

export interface IPlugin {
  onLoad?: (context: PluginContext) => Promise<void>;
  onEnable?: (context: PluginContext) => Promise<void>;
  onDisable?: (context: PluginContext) => Promise<void>;
}

export interface IEnginePlugin extends IPlugin {
  type: PluginType.ENGINE;
  createEngine: (config: Record<string, unknown>) => unknown;
  getFeatures: () => string[];
  // The underlying library (e.g. { name: 'whatsapp-web.js', version: '1.34.7' }), distinct from the manifest version.
  getEngineLibrary?: () => { name: string; version: string };
}

export interface PluginInstance {
  manifest: PluginManifest;
  status: PluginStatus;
  config: Record<string, unknown>;
  instance: IPlugin | null;
  error?: string;
  loadedAt?: Date;
  enabledAt?: Date;
}
