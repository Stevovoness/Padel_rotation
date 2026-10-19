import { render } from "preact";
import { registerSW } from "virtual:pwa-register";
import { App } from "./app";
import "./ui/styles.css";

registerSW({ immediate: true });
render(<App />, document.getElementById("app")!);
