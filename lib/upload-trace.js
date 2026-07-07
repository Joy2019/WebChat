import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const LOG_DIR = path.join(process.cwd(), 'logs');

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logFilePath() {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `upload-${day}.log`);
}

/** 创建一次上传追踪，写入 logs/upload-YYYY-MM-DD.log */
export function createUploadTrace(meta = {}) {
  const id = randomUUID().slice(0, 8);
  const trace = {
    id,
    ts: new Date().toISOString(),
    steps: [],
    ...meta,
  };

  function log(step, data = {}) {
    const entry = { at: new Date().toISOString(), step, ...data };
    trace.steps.push(entry);
    ensureLogDir();
    const line = JSON.stringify({ uploadId: id, ...entry }) + '\n';
    fs.appendFileSync(logFilePath(), line);
    console.log(`[UPLOAD:${id}] ${step}`, data.error || data.message || data.status || '');
  }

  function finish(extra = {}) {
    Object.assign(trace, extra);
    ensureLogDir();
    const line =
      JSON.stringify({
        uploadId: id,
        type: 'summary',
        ts: new Date().toISOString(),
        ...trace,
      }) + '\n';
    fs.appendFileSync(logFilePath(), line);
    console.log(`[UPLOAD:${id}] summary`, JSON.stringify(extra).slice(0, 500));
  }

  return { id, trace, log, finish };
}

export function readUploadLogTail(lines = 80) {
  ensureLogDir();
  const file = logFilePath();
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8');
  return raw.trim().split('\n').slice(-lines);
}
