import { NextResponse } from 'next/server';
import clientPromise from "@/lib/mongodb";

export async function GET(request: Request) {
  try {
    //use the shared singleton MongoClient instance to connect to the database
    const client = await clientPromise; 
    const db = client.db("honeypot_db"); 
    
    //fetch the 120 most recent logs from the traffic collection sorted by timestamp in descending order 
    const logs = await db.collection("traffic")
      .find({})
      .sort({ timestamp: -1 })
      .limit(120)
      .toArray();
    //map each document into the expected event format for the frontend, converting ObjectId to string and ensuring payloadSize is always a number 
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
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}