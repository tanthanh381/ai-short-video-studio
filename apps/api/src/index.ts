import { getConfig } from "./config";
import { createAdminClient } from "./db";
import { createApp } from "./app";

const config = getConfig();
const app = createApp(config, createAdminClient(config));
(app as unknown as { startDailyTrends?: () => () => void }).startDailyTrends?.();
app.listen(config.PORT, () => {
  console.log(
    JSON.stringify({
      level: "info",
      message: "api_started",
      port: config.PORT,
    }),
  );
});
