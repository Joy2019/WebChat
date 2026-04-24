import http from 'http';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1', port: 3000, path, method,
      headers: { 'Content-Type': 'application/json' },
    };
    const r = http.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function run() {
  const results = [];

  // ① GET /sessions → 200 + JSON 数组
  const r1 = await req('GET', '/sessions');
  results.push({
    name: 'GET /sessions 返回 200 + 数组',
    pass: r1.status === 200 && r1.body.trim().startsWith('['),
    detail: `HTTP ${r1.status}`,
  });

  // ② POST /sessions 创建会话
  const r2 = await req('POST', '/sessions', { title: '冒烟测试会话' });
  const sess = JSON.parse(r2.body);
  results.push({
    name: 'POST /sessions 创建会话',
    pass: r2.status === 200 && typeof sess.id === 'string',
    detail: `HTTP ${r2.status}, id=${sess.id}`,
  });

  // ③ GET /sessions/:id 取回刚建的会话
  const r3 = await req('GET', `/sessions/${sess.id}`);
  const s3 = JSON.parse(r3.body);
  results.push({
    name: 'GET /sessions/:id 取回会话',
    pass: r3.status === 200 && s3.title === '冒烟测试会话',
    detail: `HTTP ${r3.status}, title=${s3.title}`,
  });

  // ④ GET /sessions 列表中应包含刚建会话
  const r4 = await req('GET', '/sessions');
  const list = JSON.parse(r4.body);
  results.push({
    name: 'GET /sessions 列表包含新会话',
    pass: Array.isArray(list) && list.some((s) => s.id === sess.id),
    detail: `共 ${list.length} 条`,
  });

  // ⑤ GET /sessions/nonexistent → 404
  const r5 = await req('GET', '/sessions/nonexistent-id-xyz');
  results.push({
    name: 'GET /sessions/:id 不存在时 404',
    pass: r5.status === 404,
    detail: `HTTP ${r5.status}`,
  });

  // ⑥ GET /links.json 静态配置可访问
  const r6 = await req('GET', '/links.json');
  results.push({
    name: 'GET /links.json 静态文件可访问',
    pass: r6.status === 200 && r6.body.trim().startsWith('['),
    detail: `HTTP ${r6.status}`,
  });

  // ⑦ POST /chat/stream 缺少 sessionId → 400
  const r7 = await req('POST', '/chat/stream');
  results.push({
    name: 'POST /chat/stream 无效 sessionId → 400',
    pass: r7.status === 400,
    detail: `HTTP ${r7.status}`,
  });

  let passed = 0;
  console.log('\n=== AIChater 冒烟测试 ===\n');
  for (const t of results) {
    const icon = t.pass ? '✔' : '✘';
    console.log(`  ${icon}  ${t.name}   (${t.detail})`);
    if (t.pass) passed++;
  }
  console.log(`\n  结果：${passed} / ${results.length} 通过\n`);
  process.exit(passed === results.length ? 0 : 1);
}

run().catch((e) => {
  console.error('\n[ERROR] 测试无法连接服务，请确认 npm start 已启动：', e.message);
  process.exit(1);
});
