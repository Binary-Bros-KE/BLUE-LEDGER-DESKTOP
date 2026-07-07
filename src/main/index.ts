import electron from "electron";
import { bootstrap } from "./app/bootstrap";

const { app } = electron;

if (!app.isPackaged) {
  app.commandLine.appendSwitch("disable-crash-reporter");
}

void bootstrap();

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
