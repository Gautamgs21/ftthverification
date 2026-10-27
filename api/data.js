import { MongoClient } from 'mongodb';

// Re-used between invocations so Vercel doesn't open a new connection every request
let client;
async function getDb() {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5 });
    await client.connect();
  }
  return client.db(process.env.MONGODB_DB || 'ftth');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!process.env.MONGODB_URI) return res.status(500).json({ error: 'MONGODB_URI is not set' });
  const key = process.env.API_KEY;
  if (key && req.headers.authorization !== 'Bearer ' + key) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const db = await getDb();
    const recCol = db.collection('records');
    const meta = db.collection('meta');

    if (req.method === 'GET') {
      const records = await recCol.find({}, { projection: { _id: 0, _o: 0 } }).sort({ _o: 1 }).toArray();
      const m = await meta.findOne({ _id: 'state' });
      const extra = m && m.json ? JSON.parse(m.json) : {};
      return res.status(200).json({
        records,
        visits: extra.visits || {},
        status: extra.status || {},
        schedules: extra.schedules || []
      });
    }

    if (req.method === 'PUT') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const recs = Array.isArray(b.records) ? b.records : [];
      if (recs.length) {
        const ops = recs.map((r, i) => ({
          replaceOne: { filter: { _id: String(r['S.No.']) }, replacement: { ...r, _o: i }, upsert: true }
        }));
        await recCol.bulkWrite(ops, { ordered: false });
        await recCol.deleteMany({ _id: { $nin: recs.map(r => String(r['S.No.'])) } });
      }
      await meta.replaceOne(
        { _id: 'state' },
        { _id: 'state', json: JSON.stringify({ visits: b.visits || {}, status: b.status || {}, schedules: b.schedules || [] }) },
        { upsert: true }
      );
      return res.status(200).json({ ok: true, records: recs.length });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
