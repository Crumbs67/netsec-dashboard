import { MongoClient } from "mongodb";

if (!process.env.MONGODB_URI) {
  throw new Error('Invalid/Missing environment variable: "mongodb+srv://orleanwesley_db_user:wesley.966@cluster0.ztwkyfi.mongodb.net/honeypot_db');
}

const uri = process.env.MONGODB_URI;
const options = {};

let client: MongoClient;
let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === "development") {
  // Simpan instance di global biar gak mati pas Next.js Hot Reload
  if (!(global as any)._mongoClientPromise) {
    client = new MongoClient(uri, options);
    (global as any)._mongoClientPromise = client.connect();
  }
  clientPromise = (global as any)._mongoClientPromise;
} else {
  // Untuk Production
  client = new MongoClient(uri, options);
  clientPromise = client.connect();
}

export default clientPromise;