import * as workerThreads from "worker_threads";
import ELK from "elkjs/lib/elk.bundled.js";

const elk = new ELK();

workerThreads.parentPort?.on("message", async (message) => {
  if (message.type === "dispose") {
    process.exit(0);
    return;
  }
  if (message.type === "layout") {
    try {
      const result = await elk.layout(message.graph);
      workerThreads.parentPort.postMessage({ type: "result", id: message.id, result });
    } catch (error) {
      workerThreads.parentPort.postMessage({
        type: "error",
        id: message.id,
        error: String(error?.message ?? error),
      });
    }
  }
});
