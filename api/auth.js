import { getDb, cors, parseBody, loadUsers, checkPw, sign } from './_lib.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.MONGODB_URI) return res.status(500).json({ error: 'MONGODB_URI is not set' });
  try {
    const { username, password } = parseBody(req);
    const db = await getDb();
    const list = await loadUsers(db);
    if (!list) return res.status(500).json({ error: 'Server not set up: add ADMIN_PASSWORD in Vercel and redeploy' });
    const u = list.find(x => x.u === String(username || '').trim());
    if (!u || !checkPw(password || '', u)) {
      await new Promise(r => setTimeout(r, 700)); // slows down password guessing
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const exp = Date.now() + 7 * 864e5; // stay signed in for 7 days
    return res.status(200).json({ token: sign({ u: u.u, exp }), user: u.u, role: u.role, exp });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
