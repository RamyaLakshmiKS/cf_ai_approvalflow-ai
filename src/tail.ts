/**
 * Tail Worker for approvalflow-ai
 *
 * Receives tail events (logs, diagnostics, errors) from the main Worker and
 * emits them as structured JSON. Extend the body of each handler to forward
 * to an external sink (Axiom, Grafana, Honeycomb, etc.).
 *
 * Deploy separately:
 *   wrangler deploy --config wrangler.tail.jsonc
 *
 * Then uncomment "tail_consumers" in wrangler.jsonc.
 */

export default {
  async tail(events: TraceItem[]): Promise<void> {
    for (const event of events) {
      // Agent SDK diagnostics channel events (RPC, state, chat, tool calls, etc.)
      for (const msg of event.diagnosticsChannelEvents ?? []) {
        const entry = {
          type: "agent-diagnostic",
          channel: msg.channel,
          message: msg.message,
          timestamp: msg.timestamp,
          scriptName: event.scriptName,
          outcome: event.outcome
        };
        console.log(JSON.stringify(entry));
      }

      // Worker-level logs from console.log / console.error in the main Worker
      for (const log of event.logs ?? []) {
        const entry = {
          type: "worker-log",
          level: log.level,
          message: log.message,
          timestamp: log.timestamp,
          scriptName: event.scriptName,
          outcome: event.outcome
        };
        if (log.level === "error" || log.level === "warn") {
          console.error(JSON.stringify(entry));
        } else {
          console.log(JSON.stringify(entry));
        }
      }

      // Unhandled exceptions
      if (event.outcome === "exception" && event.exceptions?.length) {
        for (const ex of event.exceptions) {
          console.error(
            JSON.stringify({
              type: "worker-exception",
              name: ex.name,
              message: ex.message,
              scriptName: event.scriptName,
              outcome: event.outcome
            })
          );
        }
      }
    }
  }
};
