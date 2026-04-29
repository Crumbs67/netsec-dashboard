import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb'; 
import clientPromise from '@/lib/mongodb';

export async function GET() {
  try {
    // KITA TAMBAHKAN 'as MongoClient' DI SINI
    // Ini gunanya untuk memaksa TypeScript mengenali tipe datanya
    const client = (await clientPromise) as MongoClient;
    
    const db = client.db("honeypot_db");
    
    const logs = await db.collection("traffic")
      .find({})
      .sort({ _id: -1 })
      .limit(20)
      .toArray();

    return NextResponse.json(logs);
  } catch (e) {
    console.error("Database error:", e); // Tambahin log biar gampang debug kalau error
    return NextResponse.json({ error: 'Gagal ambil data' }, { status: 500 });
  }
}