/* Runs the on-device AI (WebLLM, Apache-2.0) in the background so the page stays smooth. */
import { WebWorkerMLCEngineHandler } from "./webllm.js";
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = msg => handler.onmessage(msg);
