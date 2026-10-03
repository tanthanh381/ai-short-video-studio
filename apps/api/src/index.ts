import { getConfig } from "./config";
import { createAdminClient } from "./db";
import { createApp } from "./app";

const config = getConfig();
const app = createApp(config, createAdminClient(config));
app.listen(config.PORT, () => {
  console.log(
    JSON.stringify({
      level: "info",
      message: "api_started",
      port: config.PORT,
    }),
  );
});
