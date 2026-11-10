# Community Integrations

Third-party integrations and adapters built by the community on top of ZapLink's REST API.

> **Looking for Chatwoot, Typebot, and other first-party integrations?** Those ship as official
> sandboxed plugins on the Integration Fabric — see the [ZapLink-plugins](https://github.com/rmyndharis/OpenWA-plugins)
> catalog. This page lists only community-built projects.

> ⚠️ **These projects are community-maintained and are not affiliated with or endorsed by ZapLink.**
> They may lag behind ZapLink API changes. Verify compatibility and review the source before using
> them in production.

| Integration               | Platform                                                      | Source                                                                                                                                                                                                                     | Notes                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ioBroker.zaplink**      | [ioBroker](https://www.iobroker.net/) (home / IoT automation) | [ThorstenBoettler/ioBroker.zaplink](https://github.com/ThorstenBoettler/ioBroker.zaplink) · [npm](https://www.npmjs.com/package/iobroker.zaplink)                                                                          | Send text / image / video / audio / document messages to chats and groups through ZapLink's REST API, with Blockly blocks. Early stage.                                                          |
| **zaplink-n8n-workflows** | [n8n](https://n8n.io/) (workflow automation)                  | [Abhishekrajpurohit/zaplink-n8n-workflows](https://github.com/Abhishekrajpurohit/zaplink-n8n-workflows) · [workflow](https://github.com/Abhishekrajpurohit/zaplink-n8n-workflows/blob/main/workflows/whatsapp-ai-bot.json) | Import-ready n8n workflow on the `message.received` webhook and `send-text` endpoint: AI replies via a local Ollama model, for direct messages from one contact and `@agent` mentions in groups. |

Maintain an integration built on ZapLink and want it listed here? Open a PR adding a row (or an issue), including the repository link and a one-line description.

For the first-party n8n nodes, see [n8n Integration](./22-n8n-integration.md).
