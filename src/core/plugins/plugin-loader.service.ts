import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createLogger } from '../../common/services/logger.service';
import {
  IPlugin,
  PluginContext,
  PluginInstance,
  PluginLogger,
  PluginManifest,
  PluginStatus,
  PluginType,
} from './plugin.interfaces';

/**
 * Holds the built-in engine plugins and runs their load/enable/disable hooks. EngineFactory registers
 * both engines at boot and enables the configured one.
 */
@Injectable()
export class PluginLoaderService implements OnModuleDestroy {
  private readonly logger = createLogger('PluginLoader');
  private readonly plugins = new Map<string, PluginInstance>();

  registerBuiltInPlugin(manifest: PluginManifest, instance: IPlugin, config: Record<string, unknown> = {}): void {
    this.plugins.set(manifest.id, {
      manifest,
      status: PluginStatus.INSTALLED,
      config,
      instance,
      loadedAt: new Date(),
    });
  }

  async enablePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
    if (plugin.status === PluginStatus.ENABLED) return;

    const context = this.contextFor(plugin);
    try {
      await plugin.instance?.onLoad?.(context);
      await plugin.instance?.onEnable?.(context);
      plugin.status = PluginStatus.ENABLED;
      plugin.enabledAt = new Date();
      plugin.error = undefined;
    } catch (error) {
      plugin.status = PluginStatus.ERROR;
      plugin.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async disablePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || plugin.status !== PluginStatus.ENABLED) return;
    await plugin.instance?.onDisable?.(this.contextFor(plugin));
    plugin.status = PluginStatus.DISABLED;
  }

  getPlugin(pluginId: string): PluginInstance | undefined {
    return this.plugins.get(pluginId);
  }

  getPluginsByType(type: PluginType): PluginInstance[] {
    return [...this.plugins.values()].filter(p => p.manifest.type === type);
  }

  isPluginEnabled(pluginId: string): boolean {
    return this.plugins.get(pluginId)?.status === PluginStatus.ENABLED;
  }

  async onModuleDestroy(): Promise<void> {
    for (const id of this.plugins.keys()) {
      try {
        await this.disablePlugin(id);
      } catch (error) {
        this.logger.warn(`Failed to disable plugin ${id} at shutdown`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private contextFor(plugin: PluginInstance): PluginContext {
    const log = createLogger(`Plugin:${plugin.manifest.id}`);
    const logger: PluginLogger = {
      log: (message, meta) => log.log(message, meta),
      debug: (message, meta) => log.debug(message, meta),
      warn: (message, meta) => log.warn(message, meta),
      error: (message, error, meta) => log.error(message, error instanceof Error ? error.message : error, meta),
    };
    return { pluginId: plugin.manifest.id, manifest: plugin.manifest, config: plugin.config, logger };
  }
}
