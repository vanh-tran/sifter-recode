import { MongoClient } from 'mongodb';

let client: MongoClient | null = null;

export async function getMongoDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGODB_URI');
  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
  }
  return client.db(process.env.MONGODB_DB_NAME ?? 'sifter');
}
