import { MongoClient } from 'mongodb';
import crypto from 'node:crypto';

let cachedClient = null;
let cachedDb = null;

export async function getDb() {
  // 1. If we already have a working connection, reuse it!
  if (cachedClient && cachedDb) {
    return cachedDb;
  }

  // 2. If not, create a new client with serverless-friendly options
  const client = new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 5,               // Keep the pool small for Vercel
    serverSelectionTimeoutMS: 5000, // Fail fast if Atlas is unreachable
    connectTimeoutMS: 10000,
  });

  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'ftthdb');
    
    // 3. Cache the successful connection for the next request
    cachedClient = client;
    cachedDb = db;
    
    return db;
  } catch (error) {
    console.error("Database connection failed:", error);
    throw error;
  }
}

export function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

export const parseBody = req => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});

/* ---- passwords (scrypt + salt) ---- */
export const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  ({ s: salt, h: crypto.scryptSync(String(pw), salt, 32).toString('hex') });
export const checkPw = (pw, u) => {
  const a = crypto.scryptSync(String(pw), u.s, 32), b = Buffer.from(u.h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/* ---- signed login token ---- */
const secret = () => process.env.AUTH_SECRET || crypto.createHash('sha256').update('ftth|' + process.env.MONGODB_URI).digest('hex');
export function sign(p) {
  const b = Buffer.from(JSON.stringify(p)).toString('base64url');
  return b + '.' + crypto.createHmac('sha256', secret()).update(b).digest('base64url');
}
export function verify(t) {
  try {
    const [b, s] = String(t).split('.');
    const e = crypto.createHmac('sha256', secret()).update(b).digest('base64url');
    const x = Buffer.from(s || ''), y = Buffer.from(e);
    if (x.length !== y.length || !crypto.timingSafeEqual(x, y)) return null;
    const p = JSON.parse(Buffer.from(b, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch (e) { return null; }
}

/* ---- users: ONE document in ftth_meta  { _id:'users', list:[{u,role,s,h}] } ---- */
export async function loadUsers(db) {
  const m = db.collection('ftth_meta');
  let d = await m.findOne({ _id: 'users' });
  if (!d) {
    const pw = process.env.ADMIN_PASSWORD;
    if (!pw) return null;
    d = { _id: 'users', list: [{ u: process.env.ADMIN_USER || 'admin', role: 'admin', ...hashPw(pw) }] };
    await m.insertOne(d);
  }
  return d.list;
}

export const saveUsers = (db, list) =>
  db.collection('ftth_meta').replaceOne({ _id: 'users' }, { _id: 'users', list }, { upsert: true });

/* ---- guard: returns {u, role} or sends 401 and returns null ---- */
export async function requireUser(req, res, db) {
  const p = verify((req.headers.authorization || '').replace(/^Bearer /, ''));
  const list = await loadUsers(db);
  if (!list) { res.status(500).json({ error: 'Server not set up: add ADMIN_PASSWORD in Vercel and redeploy' }); return null; }
  const me = p && list.find(x => x.u === p.u);
  if (!me) { res.status(401).json({ error: 'Please sign in again' }); return null; }
  return { u: me.u, role: me.role };
}
