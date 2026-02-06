import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { telegramUserDock, telegramUserPlugin } from "./src/channel.js";
import { setTelegramUserRuntime } from "./src/runtime.js";

const plugin = {
  id: "telegram-user",
  name: "Telegram Personal",
  description: "Telegram personal account messaging via MTProto (GramJS)",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setTelegramUserRuntime(api.runtime);
    api.registerChannel({ plugin: telegramUserPlugin, dock: telegramUserDock });
  },
};

export default plugin;
