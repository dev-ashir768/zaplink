import { Global, Module } from '@nestjs/common';
import { PluginLoaderService } from './plugin-loader.service';

// Global so EngineFactory (in EngineModule) can inject the loader.
@Global()
@Module({
  providers: [PluginLoaderService],
  exports: [PluginLoaderService],
})
export class PluginsModule {}
