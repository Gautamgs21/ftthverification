export const config = {
  maxDuration: 60, // Allow up to 60 seconds
};

import { MongoClient } from 'mongodb';
// This reuses the database connection for speed
let cachedClient = null;

export default async function handler(req, res) {
  // CORS headers allow your frontend (index.html) to talk to this API
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle browser preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) return res.status(500).json({ error: 'Database connection string missing' });

  try {
    if (!cachedClient) {
      const client = new MongoClient(uri);
      await client.connect();
      cachedClient = client;
    }

    // ⚠️ THESE MUST MATCH YOUR MONGODB NAMES
    // From your screenshots, the database is 'ftthdb' and collection is 'data'
    const database = cachedClient.db('ftthdb'); 
    const collection = database.collection('data'); 

    // --- GET: When your HTML asks for data ---
    if (req.method === 'GET') {
      const data = await collection.findOne({ id: 'main_db' });
      if (!data) {
        // If the database is empty, return a blank shell for your app
        return res.status(200).json({ records: [], visits: {}, status: {}, schedules: [] });
      }
      return res.status(200).json(data.payload);
    }

    // --- PUT: When your HTML sends data to save ---
    if (req.method === 'PUT') {
      const payload = req.body;
      await collection.updateOne(
        { id: 'main_db' },
        { $set: { payload: payload } },
        { upsert: true } // This creates the document if it doesn't exist
      );
      return res.status(200).json({ success: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
