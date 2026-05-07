const chatWindow = document.getElementById('chat-window');
const userInput = document.getElementById('user-input');
const fileInput = document.getElementById('file-input');
const sendBtn = document.getElementById('send-btn');
const sessionList = document.getElementById('session-list');
const newSessionBtn = document.getElementById('new-session-btn');
const newSessionIconBtn = document.getElementById('new-session-icon-btn');
const clearSessionsBtn = document.getElementById('clear-sessions-btn');
const sessionTitle = document.getElementById('session-title');
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
const imageModal = document.getElementById('image-modal');
const imageModalImg = document.getElementById('image-modal-img');
const linkList = document.getElementById('link-list');
const themeBtn = document.getElementById('theme-btn');
const pastePreview = document.getElementById('paste-preview');
const pasteThumb = document.getElementById('paste-thumb');
const pasteClear = document.getElementById('paste-clear');
const clearCurrentBtn = document.getElementById('clear-current-btn');
const ASSISTANT_NAME = 'AI智能助手';
const USER_NAME = '学员';

let sessions = [];
let currentSessionId = null;
const OPENING_MESSAGE =
  '同学你好，我是你的化工过程控制实验助教。\n' +
  '无论你是准备开始一个新实验、在操作中卡住了，还是拿到数据不知道怎么分析，都可以直接问我。' +
  '我熟悉液位、流量、温度等典型对象的控制实验，也能帮你排查常见故障、整定 PID 参数、梳理实验报告思路。\n' +
  '告诉我今天打算做哪个实验，或者直接描述你遇到的问题吧。';

// ===== 粘贴图片管理 =====
// 统一的"待发送图片" File 对象，来源可以是粘贴或文件选择器
let pendingAttachmentFile = null;
const SIDEBAR_COLLAPSE_KEY = 'aichater-sidebar-collapsed';

function setPendingAttachment(file) {
  if (!file || !file.type.startsWith('image/')) return;
  pendingAttachmentFile = file;
  pastePreview.style.display = 'inline-flex';
  pasteThumb.src = URL.createObjectURL(file);
  pasteThumb.alt = file.name || 'attachment';
  fileInput.value = '';
}

function clearPendingAttachment() {
  if (pasteThumb.src && pasteThumb.src.startsWith('blob:')) {
    URL.revokeObjectURL(pasteThumb.src);
  }
  pendingAttachmentFile = null;
  pasteThumb.src = '';
  pastePreview.style.display = 'none';
  fileInput.value = '';
}

// Ctrl+V 粘贴图片
userInput.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault(); // 阻止图片变成文字插入
      const file = item.getAsFile();
      if (file) setPendingAttachment(file);
      return;
    }
  }
});

// 文件选择器也走统一 pendingAttachmentFile
fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  if (file) setPendingAttachment(file);
});

// 移除预览
pasteClear.addEventListener('click', clearPendingAttachment);

// ===== 会话栏收起/展开 =====
function applySidebarCollapsed(collapsed) {
  const appEl = document.querySelector('.app');
  if (collapsed) {
    appEl.classList.add('sidebar-collapsed');
    sidebarToggleBtn.textContent = '☷';
  } else {
    appEl.classList.remove('sidebar-collapsed');
    sidebarToggleBtn.textContent = '☰';
  }
  localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? '1' : '0');
}

sidebarToggleBtn.addEventListener('click', () => {
  const appEl = document.querySelector('.app');
  applySidebarCollapsed(!appEl.classList.contains('sidebar-collapsed'));
});

applySidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1');

// ===== 主题切换 =====
const THEME_KEY = 'aichater-theme';
let currentTheme = localStorage.getItem(THEME_KEY) || 'light';

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  if (theme === 'dark') {
    themeBtn.textContent = '🌙 暗色';
  } else {
    themeBtn.textContent = '☀️ 亮色';
  }
}

applyTheme(currentTheme);

themeBtn.addEventListener('click', () => {
  applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
});

function openImageModal(src) {
  if (!src) return;
  imageModalImg.src = src;
  imageModal.classList.add('open');
}

imageModal.addEventListener('click', () => {
  imageModal.classList.remove('open');
  imageModalImg.src = '';
});

// 用户消息：URL 只渲染成可点击链接，不自动转为图片（防止误发图片链接）
function renderUserText(container, text) {
  container.innerHTML = '';
  if (!text) return;
  const urlRegex = /https?:\/\/[^\s<>"']+/g;
  let lastIndex = 0;
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) container.appendChild(document.createTextNode(before));
    const url = match[0].replace(/[.,!?;)]+$/, '');
    const a = document.createElement('a');
    a.href = url;
    a.textContent = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    container.appendChild(a);
    lastIndex = match.index + match[0].length;
  }
  const rest = text.slice(lastIndex);
  if (rest) container.appendChild(document.createTextNode(rest));
}

function renderRichText(container, text) {
  container.innerHTML = '';
  if (!text) return;

  // 把 markdown 图片 ![alt](url) 转成普通 url，后面统一处理
  let processed = text.replace(/!\[[^\]]*]\((https?:\/\/[^\s)]+)\)/g, '$1');

  // 改进的 URL 正则，支持带查询参数的完整 URL
  const urlRegex = /https?:\/\/[^\s<>"']+/g;
  let lastIndex = 0;
  let match;

  while ((match = urlRegex.exec(processed)) !== null) {
    const before = processed.slice(lastIndex, match.index);
    if (before) {
      container.appendChild(document.createTextNode(before));
    }

    let url = match[0];

    // 去掉末尾常见标点（但保留 URL 中的查询参数）
    url = url.replace(/[.,!?;)]+$/, '');

    // 检测是否为图片 URL（支持带查询参数的图片链接）
    // 检查文件扩展名、URL路径中的关键词，或者URL参数中包含图片标识
    const isImage = 
      /\.(png|jpe?g|gif|webp|svg|bmp)(\?|$|&|#)/i.test(url) || 
      /\/BYTE_RAG_UPLOAD|image|img|photo|pic|\.png|\.jpg|\.jpeg|\.gif/i.test(url) ||
      /oceancloudapi\.com.*\.(png|jpe?g|gif|webp)/i.test(url);

    if (isImage) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'image';
      img.classList.add('inline-image');
      img.addEventListener('click', () => openImageModal(url));
      img.onerror = function() {
        // 如果图片加载失败，显示为链接
        const a = document.createElement('a');
        a.href = url;
        a.textContent = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        container.replaceChild(a, img);
      };
      container.appendChild(img);
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.textContent = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.color = '#60a5fa';
      a.style.textDecoration = 'underline';
      container.appendChild(a);
    }

    lastIndex = match.index + match[0].length;
  }

  const rest = processed.slice(lastIndex);
  if (rest) {
    container.appendChild(document.createTextNode(rest));
  }
}

function appendMessage(role, text, imageUrl) {
  const msg = document.createElement('div');
  msg.className = `message ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  const tag = document.createElement('div');
  tag.className = 'role-tag';
  tag.textContent = role === 'user' ? USER_NAME : ASSISTANT_NAME;

  const contentEl = document.createElement('div');
  if (role === 'user') {
    // 用户气泡：纯文本渲染，URL 显示为可点击链接但不自动变图片
    // 避免粘贴图片 URL 被误判为图片发送给 AI
    renderUserText(contentEl, text || '');
  } else {
    // AI 气泡：富文本渲染（图片 URL、链接等全部解析）
    renderRichText(contentEl, text || '');
  }
  bubble.appendChild(contentEl);

  const refsEl = document.createElement('div');
  refsEl.className = 'refs';
  refsEl.style.display = 'none';
  const refsTitle = document.createElement('div');
  refsTitle.className = 'refs-title';
  refsTitle.textContent = '命中资料';
  refsEl.appendChild(refsTitle);
  bubble.appendChild(refsEl);

  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = 'uploaded image';
    img.classList.add('inline-image');
    img.addEventListener('click', () => openImageModal(imageUrl));
    bubble.appendChild(img);
  }

  if (role === 'user') {
    msg.appendChild(bubble);
    msg.appendChild(tag);
  } else {
    msg.appendChild(tag);
    msg.appendChild(bubble);
  }

  chatWindow.appendChild(msg);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  return { msg, bubble, contentEl, refsEl };
}

// 模拟真实 AI 打字速度展示文本
async function streamTextToNode(node, fullText, minDelay = 12, maxDelay = 28) {
  const target = node?.contentEl;
  if (!target) return;
  let output = '';
  for (const ch of fullText || '') {
    output += ch;
    renderRichText(target, output);
    const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

function setRefs(node, items) {
  if (!node?.refsEl) return;
  if (!Array.isArray(items) || items.length === 0) return;
  node.refsEl.style.display = 'block';
  // 清空除标题外内容
  while (node.refsEl.children.length > 1) node.refsEl.removeChild(node.refsEl.lastChild);
  for (const it of items) {
    const a = document.createElement('a');
    a.href = it.url;
    a.textContent = it.title || it.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    node.refsEl.appendChild(a);
  }
}

function clearChat() {
  chatWindow.innerHTML = '';
}

async function fetchSessions() {
  const res = await fetch('/sessions');
  sessions = await res.json();
  renderSessions();
  // 没有任何会话时自动新建一条（首次打开、清空全部、删除最后一条等）
  if (sessions.length === 0) {
    await createSession();
    return;
  }
  // 尚未选中、或当前 id 已不在列表中时，默认选中首条（通常为最新），保证可直接对话
  const hasCurrent =
    currentSessionId && sessions.some((s) => s.id === currentSessionId);
  if (!hasCurrent) {
    await switchSession(sessions[0].id);
  }
}

function renderSessions() {
  sessionList.innerHTML = '';
  sessions.forEach((s) => {
    const item = document.createElement('div');
    item.className = `session-item ${s.id === currentSessionId ? 'active' : ''}`;
    item.addEventListener('click', () => switchSession(s.id));

    const title = document.createElement('div');
    title.className = 'session-title';
    title.textContent = s.title || '未命名会话';
    title.title = s.title || '未命名会话';

    const actions = document.createElement('div');
    actions.className = 'session-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'session-action-btn';
    renameBtn.title = '重命名';
    renameBtn.textContent = '✎';
    renameBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const nextTitle = prompt('输入新的会话名称', s.title || '新会话');
      if (!nextTitle || !nextTitle.trim()) return;
      try {
        const res = await fetch(`/sessions/${s.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: nextTitle.trim() }),
        });
        if (!res.ok) throw new Error(await res.text());
        await fetchSessions();
      } catch (err) {
        alert(`重命名失败：${err?.message || String(err)}`);
      }
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'session-action-btn danger';
    delBtn.title = '删除会话';
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('确认删除该会话？')) return;
      try {
        const res = await fetch(`/sessions/${s.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(await res.text());
        if (currentSessionId === s.id) {
          currentSessionId = null;
          clearChat();
        }
        await fetchSessions();
      } catch (err) {
        alert(`删除失败：${err?.message || String(err)}`);
      }
    });

    actions.appendChild(renameBtn);
    actions.appendChild(delBtn);
    item.appendChild(title);
    item.appendChild(actions);
    sessionList.appendChild(item);
  });
}

async function createSession() {
  const res = await fetch('/sessions', {
    method: 'POST',
  });
  const session = await res.json();
  currentSessionId = session.id;
  sessions.unshift(session);
  renderSessions();
  clearChat();
  sessionTitle.textContent = ASSISTANT_NAME;

  // 新建会话后直接显示开场白，不依赖额外点击
  const messages = Array.isArray(session.messages) ? session.messages : [];
  if (messages.length > 0) {
    for (const m of messages) {
      const role = m.role === 'assistant' ? 'ai' : 'user';
      const node = appendMessage(role, role === 'ai' ? '' : m.content);
      if (role === 'ai') {
        await streamTextToNode(node, m.content || '');
      }
      if (role === 'ai' && Array.isArray(m.refs) && m.refs.length) {
        setRefs(node, m.refs);
      }
    }
  } else {
    // 后端未返回开场白时的兜底显示
    const node = appendMessage('ai', '');
    await streamTextToNode(node, OPENING_MESSAGE);
  }
}

async function switchSession(id) {
  currentSessionId = id;
  const res = await fetch(`/sessions/${id}`);
  const session = await res.json();
  sessionTitle.textContent = ASSISTANT_NAME;
  renderSessions();
  clearChat();
  for (const m of session.messages) {
    const node = appendMessage(m.role === 'assistant' ? 'ai' : 'user', m.content);
    if (m.role === 'assistant' && Array.isArray(m.refs) && m.refs.length) {
      setRefs(node, m.refs);
    }
  }
}

async function sendMessage() {
  if (!currentSessionId) {
    alert('请先在左侧创建/选择一个会话');
    return;
  }

  const text = userInput.value.trim();
  // 优先使用统一的 pendingAttachmentFile（来自粘贴或文件选择器）
  const file = pendingAttachmentFile || (fileInput.files && fileInput.files[0]);

  if (!text && !file) return;

  const localImgUrl = file ? URL.createObjectURL(file) : null;
  appendMessage('user', text, localImgUrl);

  // 立即清空输入框和图片预览，不等响应完成
  userInput.value = '';
  clearPendingAttachment();
  sendBtn.disabled = true;

  try {
    const formData = new FormData();
    formData.append('sessionId', currentSessionId);
    if (text) formData.append('message', text);
    if (file) formData.append('image', file);

    const res = await fetch('/chat/stream', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok || !res.body) {
      const msg = await res.text();
      throw new Error(msg || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let ai = '';
    let buffer = '';
    let refs = [];
    const aiNode = appendMessage('ai', '');

    // 等待效果（AI智能助手 正在回复...）
    const typing = document.createElement('div');
    typing.className = 'typing';
    typing.innerHTML = `${ASSISTANT_NAME} 正在回复 <span class="dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>`;
    aiNode.contentEl.appendChild(typing);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // NDJSON：按行解析
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let evt;
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }

        if (evt.type === 'delta') {
          ai += evt.text || '';
          // 先移除 typing，再渲染
          typing.remove();
          renderRichText(aiNode.contentEl, ai);
          // 继续显示 typing（如果还没 done）
          aiNode.contentEl.appendChild(typing);
        } else if (evt.type === 'knowledge') {
          if (Array.isArray(evt.items)) {
            for (const it of evt.items) {
              if (!refs.find((x) => x.url === it.url)) refs.push(it);
            }
            setRefs(aiNode, refs);
          }
        } else if (evt.type === 'done') {
          typing.remove();
          renderRichText(aiNode.contentEl, ai);
          setRefs(aiNode, refs);
          return; // 提前结束
        } else if (evt.type === 'error') {
          typing.remove();
          throw new Error(evt.message || 'stream error');
        }
      }

      chatWindow.scrollTop = chatWindow.scrollHeight;
    }
  } catch (err) {
    console.error(err);
    appendMessage('ai', `请求出错：${err?.message || String(err)}`);
  } finally {
    sendBtn.disabled = false;
    fetchSessions(); // 更新列表 preview
  }
}

sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

newSessionBtn.addEventListener('click', createSession);
newSessionIconBtn.addEventListener('click', createSession);
clearSessionsBtn.addEventListener('click', async () => {
  if (!confirm('确认清空全部会话？此操作不可恢复。')) return;
  try {
    const res = await fetch('/sessions', { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
    currentSessionId = null;
    clearChat();
    await fetchSessions();
  } catch (err) {
    alert(`清空失败：${err?.message || String(err)}`);
  }
});

clearCurrentBtn.addEventListener('click', async () => {
  if (!currentSessionId) {
    alert('请先选择会话');
    return;
  }
  if (!confirm('确认清空当前会话内容？')) return;
  try {
    const res = await fetch(`/sessions/${currentSessionId}/messages`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
    clearChat();
    await fetchSessions();
  } catch (err) {
    alert(`清空失败：${err?.message || String(err)}`);
  }
});

async function loadLinks() {
  const rightbar = document.querySelector('.rightbar');
  const appEl = document.querySelector('.app');
  try {
    const res = await fetch('/links.json', { cache: 'no-store' });
    const config = await res.json();

    // 兼容旧数组格式
    const isLegacy = Array.isArray(config);
    const visible = isLegacy ? true : (config.visible !== false);
    const links = isLegacy ? config : (config.links || []);

    if (!visible) {
      rightbar.style.display = 'none';
      appEl.classList.add('no-rightbar');
      return;
    }

    rightbar.style.display = '';
    appEl.classList.remove('no-rightbar');
    linkList.innerHTML = '';
    for (const l of links) {
      if (!l?.url) continue;
      const item = document.createElement('div');
      item.className = 'link-item';
      const a = document.createElement('a');
      a.href = l.url;
      a.textContent = l.name || l.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      item.appendChild(a);
      linkList.appendChild(item);
    }
  } catch (e) {
    console.error('links.json 加载失败', e);
    linkList.textContent = '链接配置加载失败';
  }
}

// 初始化（等待会话列表/自动新建完成后再交互，避免未选中会话就发送）
loadLinks();
(async () => {
  try {
    await fetchSessions();
  } catch (e) {
    console.error('会话列表加载失败', e);
  }
})();
