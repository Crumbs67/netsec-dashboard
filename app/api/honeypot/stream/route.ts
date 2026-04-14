import { getFeed, startSyntheticLoop, subscribeToFeed } from "@/lib/honeypot-feed";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function toEventBlock(eventName: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(request: Request) {
  startSyntheticLoop();

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe = () => {};
  const cleanup = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }

    unsubscribe();
  };

  request.signal.addEventListener("abort", cleanup);

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        toEventBlock("snapshot", {
          generatedAt: new Date().toISOString(),
          events: getFeed(120),
        }),
      );

      unsubscribe = subscribeToFeed((event) => {
        controller.enqueue(toEventBlock("event", { event }));
      });

      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`event: ping\ndata: ${Date.now()}\n\n`));
      }, 15000);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}