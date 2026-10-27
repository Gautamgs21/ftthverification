import { MongoClient, ObjectId } from 'mongodb';

// Re-used between invocations so Vercel doesn't open a new connection every request
let client;
async function getDb() {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5 });
    await client.connect();
  }
  return client.db(process.env.MONGODB_DB || 'ftthdb');
}

// strip _id and make S.No. numeric when it looks numeric (matches how your data was imported)
const clean = r => {
  const { _id, ...x } = r;
  if (/^\d+$/.test(String(x['S.No.']))) x['S.No.'] = Number(x['S.No.']);
  return x;
};

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
    const col = db.collection(process.env.MONGODB_COLLECTION || 'data'); // your customer records
    const meta = db.collection('ftth_meta'); // visits, survey answers, schedules

    if (req.method === 'GET') {
      const page = Math.max(0, parseInt(req.query.page) || 0);
      const size = Math.min(2000, parseInt(req.query.size) || 1000);
      const total = await col.estimatedDocumentCount();
      const records = await col.find({}).sort({ _id: 1 }).skip(page * size).limit(size).toArray();
      const out = { records, total };
      if (page === 0) {
        const m = await meta.findOne({ _id: 'state' });
        const x = m && m.json ? JSON.parse(m.json) : {};
        out.visits = x.visits || {};
        out.status = x.status || {};
        out.schedules = x.schedules || [];
      }
      return res.status(200).json(out);
    }

    if (req.method === 'PUT') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const recs = Array.isArray(b.records) ? b.records : [];
      const withId = recs.filter(r => r._id);
      const noId = recs.filter(r => !r._id);
      if (withId.length) {
        await col.bulkWrite(
          withId.map(r => ({ replaceOne: { filter: { _id: new ObjectId(r._id) }, replacement: clean(r) } })),
          { ordered: false }
        );
      }
      const ids = {};
      if (noId.length) {
        const ins = await col.insertMany(noId.map(clean));
        noId.forEach((r, i) => { ids[String(r['S.No.'])] = String(ins.insertedIds[i]); });
      }
      if (b.visits || b.status || b.schedules) {
        await meta.replaceOne(
          { _id: 'state' },
          { _id: 'state', json: JSON.stringify({ visits: b.visits || {}, status: b.status || {}, schedules: b.schedules || [] }) },
          { upsert: true }
        );
      }
      return res.status(200).json({ ok: true, ids });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
