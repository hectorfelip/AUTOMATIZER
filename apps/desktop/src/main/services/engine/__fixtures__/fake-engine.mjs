// Motor falso para testar o EngineClient contra comportamentos que o motor real não produz.
// Modo via FAKE_MODE: ok | garbage | oversize | split | ignore-ping | hang | crash-loop | bad-protocol | old-python | silent
import readline from "node:readline";

const mode = process.env.FAKE_MODE ?? "ok";
let eventId = 0;
const msg = (type, requestId = "", payload = {}) => JSON.stringify({ type, requestId, eventId: ++eventId, payload }) + "\n";
const ready = (over = {}) =>
  msg("ready", "", { engineVersion: "fake", protocolVersion: 1, python: "3.13.0", platform: "fake", actions: ["flow.wait"], optionalModules: {}, ...over });

if (mode === "crash-loop") {
  console.error("Traceback: ModuleNotFoundError: No module named 'automation_engine'");
  process.exit(1);
}
if (mode === "silent") setInterval(() => {}, 1000); // nunca manda 'ready'
else if (mode === "garbage") {
  process.stdout.write("isto não é json\n{\"type\":\"voar\"}\n[1,2]\n\n");
  process.stdout.write(ready());
} else if (mode === "bad-protocol") process.stdout.write(ready({ protocolVersion: 99 }));
else if (mode === "old-python") process.stdout.write(ready({ python: "3.8.10" }));
else if (mode === "split") {
  for (const b of Buffer.from(ready())) process.stdout.write(Buffer.from([b])); // um byte por vez
} else process.stdout.write(ready());

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.type === "ping" && mode !== "ignore-ping" && mode !== "hang") {
    if (mode === "oversize") {
      process.stdout.write("x".repeat(1_200_000) + "\n"); // linha gigante...
    }
    process.stdout.write(msg("pong", m.requestId, { uptimeMs: 1, activeExecutions: 0 })); // ...e depois uma válida
  } else if (m.type === "execute_action" && mode !== "hang") { // "hang": aceita a ação e nunca responde
    process.stdout.write(msg("action_completed", m.requestId, { executionId: m.payload.executionId, nodeId: m.payload.nodeId, status: "success", outputs: { echo: m.payload.config } }));
  } else if (m.type === "shutdown") {
    process.stdout.write(msg("bye", m.requestId));
    process.exit(0);
  }
});
