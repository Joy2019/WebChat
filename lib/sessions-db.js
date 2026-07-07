import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'sessions.db');

let db;

function rowToMessage(row) {
  const msg = {
    role: row.role,
    content: row.content,
    ts: row.ts,
  };
  if (row.image) msg.image = true;
  const refs = JSON.parse(row.refs || '[]');
  if (refs.length) msg.refs = refs;
  if (row.conversationId) msg.conversationId = row.conversationId;
  if (row.sectionId) msg.sectionId = row.sectionId;
  return msg;
}

export function initSessionsDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      image INTEGER NOT NULL DEFAULT 0,
      refs TEXT NOT NULL DEFAULT '[]',
      conversationId TEXT,
      sectionId TEXT,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_sessionId ON messages(sessionId);
    CREATE INDEX IF NOT EXISTS idx_messages_session_ts ON messages(sessionId, ts);
  `);
  return db;
}

export function createSession({ id, title, createdAt, updatedAt, openingMessage }) {
  const insertSession = db.prepare(
    'INSERT INTO sessions (id, title, createdAt, updatedAt) VALUES (?, ?, ?, ?)'
  );
  const insertMessage = db.prepare(`
    INSERT INTO messages (sessionId, role, content, image, refs, conversationId, sectionId, ts)
    VALUES (?, ?, ?, 0, '[]', NULL, NULL, ?)
  `);
  const tx = db.transaction(() => {
    insertSession.run(id, title, createdAt, updatedAt);
    insertMessage.run(id, openingMessage.role, openingMessage.content, openingMessage.ts);
  });
  tx();
  return getSession(id);
}

export function listSessions() {
  const rows = db
    .prepare('SELECT * FROM sessions ORDER BY updatedAt DESC')
    .all();
  const lastMsgStmt = db.prepare(
    'SELECT content FROM messages WHERE sessionId = ? ORDER BY ts DESC LIMIT 1'
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastMessage: lastMsgStmt.get(row.id)?.content || '',
  }));
}

export function getSession(id) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!session) return null;
  const messages = db
    .prepare('SELECT * FROM messages WHERE sessionId = ? ORDER BY ts ASC, id ASC')
    .all(id)
    .map(rowToMessage);
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages,
  };
}

export function sessionExists(id) {
  return !!db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id);
}

export function updateSessionTitle(id, title, updatedAt) {
  const result = db
    .prepare('UPDATE sessions SET title = ?, updatedAt = ? WHERE id = ?')
    .run(title, updatedAt, id);
  return result.changes > 0;
}

export function touchSession(id, updatedAt) {
  db.prepare('UPDATE sessions SET updatedAt = ? WHERE id = ?').run(updatedAt, id);
}

export function deleteSession(id) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE sessionId = ?').run(id);
    return db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  });
  return tx().changes > 0;
}

export function deleteAllSessions() {
  db.prepare('DELETE FROM messages').run();
  db.prepare('DELETE FROM sessions').run();
}

export function clearSessionMessages(id, updatedAt) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE sessionId = ?').run(id);
    db.prepare('UPDATE sessions SET updatedAt = ? WHERE id = ?').run(updatedAt, id);
  });
  tx();
}

export function addMessage(sessionId, message) {
  const refs = JSON.stringify(message.refs || []);
  db.prepare(`
    INSERT INTO messages (sessionId, role, content, image, refs, conversationId, sectionId, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    message.role,
    message.content || '',
    message.image ? 1 : 0,
    refs,
    message.conversationId || null,
    message.sectionId || null,
    message.ts
  );
}

export function countUserMessages(sessionId) {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE sessionId = ? AND role = 'user'")
    .get(sessionId);
  return row?.n || 0;
}

export function updateSessionTitleIfDefault(sessionId, title, updatedAt) {
  db.prepare(
    "UPDATE sessions SET title = ?, updatedAt = ? WHERE id = ? AND title = '新会话'"
  ).run(title, updatedAt, sessionId);
}
