import { NextResponse } from 'next/server';
import clientPromise from "@/lib/mongodb";

export async function GET(request: Request) {
  try {
    // Gunakan clientPromise yang sudah kita buat (Singleton)
    const client = await clientPromise; 
    const db = client.db("honeypot_db"); 
    
    // Ambil 120 log terbaru dari koleksi 'traffic'
    const logs = await db.collection("traffic")
      .find({})
      .sort({ timestamp: -1 })
      .limit(120)
      .toArray();
    // Mapping data
    const formattedEvents = logs.map(doc => ({
        id: doc._id.toString(),
        timestamp: doc.timestamp,
        srcIp: doc.srcIp,
        country: doc.country,
        protocol: doc.protocol,
        port: doc.port,
        service: doc.service,
        severity: doc.severity,
        action: doc.action,
        payloadSize: doc.payloadSize || 0
    }));

    return NextResponse.json({
        generatedAt: new Date().toISOString(),
        events: formattedEvents
    });
  } catch (e) {
    console.error("Database error:", e);
    return NextResponse.json({ error: 'Gagal ambil data' }, { status: 500 });
  }
}