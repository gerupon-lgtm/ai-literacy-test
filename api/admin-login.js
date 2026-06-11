// =========================================================
// api/admin-login.js
// 管理者の固定パスワードを検証し、短時間有効トークンを発行する。
// =========================================================
import crypto from 'node:crypto';
import { applyCors, handlePreflight, readJsonBody, issueAdminToken } from './_lib.js';

// タイミング攻撃を避けた文字列比較
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // 長さが違っても一定時間処理（ダミー比較）
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  applyCors(res, req);

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'POSTのみ対応しています。' });
  }

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !process.env.ADMIN_TOKEN_SECRET) {
    return res.status(500).json({ ok: false, code: 'NOT_CONFIGURED', message: '管理者認証が未設定です。' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ ok: false, code: 'BAD_JSON', message: 'リクエスト本文を解析できませんでした。' });
  }

  const password = body && body.password;
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ ok: false, code: 'INVALID_PASSWORD', message: 'パスワードを入力してください。' });
  }

  if (!safeEqual(password, expected)) {
    return res.status(401).json({ ok: false, code: 'AUTH_FAILED', message: 'パスワードが正しくありません。' });
  }

  const expiresIn = 3600;
  const adminToken = issueAdminToken(expiresIn);
  return res.status(200).json({ ok: true, adminToken, expiresIn });
}
