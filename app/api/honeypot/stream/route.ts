import { MongoClient } from "mongodb";
export const dynamic = "force-dynamic";
const encoder = new TextEncoder();
function toEventBlock(eventName: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(request: Request) {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db("honeypot_db");
  const collection = db.collection("traffic");
  
  // 1. Pindahkan deklarasi heartbeat ke lingkup yang bisa diakses cancel()
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const changeStream = collection.watch();

  const cleanup = () => {
    if (heartbeat) clearInterval(heartbeat); // Bersihkan interval
    client.close();
    changeStream.close();
  };

  request.signal.addEventListener("abort", cleanup);

  const stream = new ReadableStream({
    async start(controller) {
      const lastLogs = await collection.find({}).sort({ _id: -1 }).limit(20).toArray();
      controller.enqueue(toEventBlock("snapshot", {
        generatedAt: new Date().toISOString(),
        events: lastLogs.reverse(),
      }));

      changeStream.on("change", (change) => {
        if (change.operationType === "insert") {
          try {
            controller.enqueue(toEventBlock("event", { event: change.fullDocument }));
          } catch (e) {
            console.log("Stream sudah tertutup, tidak bisa kirim data.");
          }
        }
      });

      // 2. Assign ke variabel heartbeat yang di atas
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`event: ping\ndata: ${Date.now()}\n\n`));
        } catch (e) {
         }
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
      "Connection": "keep-alive",
    },
  });
}