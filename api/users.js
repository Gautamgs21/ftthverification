import { getDb, cors, parseBody, requireUser, loadUsers, saveUsers, hashPw, checkPw } from './_lib.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const db = await getDb();
    const me = await requireUser(req, res, db);
    if (!me) return;
    const list = await loadUsers(db);
    const admin = me.role === 'admin';

    if (req.method === 'GET')
      return res.status(200).json({ users: admin ? list.map(x => ({ u: x.u, role: x.role })) : [{ u: me.u, role: me.role }] });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const b = parseBody(req);
    const bad = m => res.status(400).json({ error: m });

    if (b.action === 'add') {
      if (!admin) return res.status(403).json({ error: 'Admin only' });
      const u = String(b.username || '').trim();
      if (!u || String(b.password || '').length < 6) return bad('Username and a password of 6+ characters required');
      if (list.some(x => x.u === u)) return bad('Username already exists');
      list.push({ u, role: 'user', ...hashPw(b.password) });
    } else if (b.action === 'remove') {
      if (!admin) return res.status(403).json({ error: 'Admin only' });
      if (b.username === me.u) return bad('You cannot remove yourself');
      const i = list.findIndex(x => x.u === b.username);
      if (i < 0) return bad('User not found');
      list.splice(i, 1);
    } else if (b.action === 'password') {
      const t = b.username || me.u;
      if (t !== me.u && !admin) return res.status(403).json({ error: 'Admin only' });
      const x = list.find(y => y.u === t);
      if (!x) return bad('User not found');
      if (String(b.password || '').length < 6) return bad('New password must be 6+ characters');
      if (t === me.u && !checkPw(b.current || '', x)) return bad('Current password is incorrect');
      Object.assign(x, hashPw(b.password));
    } else return bad('Unknown action');

    await saveUsers(db, list);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
