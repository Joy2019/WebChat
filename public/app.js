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
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const voiceInputBtn = document.getElementById('voice-input-btn');
const voiceOutputBtn = document.getElementById('voice-output-btn');
const uploadBtn = document.getElementById('upload-btn');
const ASSISTANT_NAME = 'AI智能助手';
const USER_NAME = '学员';
const MOBILE_MQ = window.matchMedia('(max-width: 768px)');

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

function isVideoFile(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith('video/')) return true;
  const name = (file.name || '').toLowerCase();
  return /\.(mp4|mov|webm|avi|mkv|m4v|3gp)$/i.test(name);
}

function isImageFile(file) {
  if (!file) return false;
  if (isVideoFile(file)) return false;
  if (file.type && file.type.startsWith('image/')) return true;
  const name = (file.name || '').toLowerCase();
  return /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(name);
}

/** 移动端相册 HEIC 等格式转为 JPEG，提升上传成功率 */
async function prepareImageForUpload(file) {
  if (!file) return null;
  const isJpeg =
    file.type === 'image/jpeg' ||
    file.type === 'image/jpg' ||
    /\.jpe?g$/i.test(file.name || '');
  if (isJpeg && file.size < 3 * 1024 * 1024) {
    return file;
  }

  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      const maxSide = 1920;
      let w = bitmap.width;
      let h = bitmap.height;
      if (w > maxSide || h > maxSide) {
        const scale = Math.min(maxSide / w, maxSide / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      bitmap.close?.();
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
          'image/jpeg',
          0.88
        );
      });
      const base = (file.name || 'photo').replace(/\.[^.]+$/i, '');
      return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
    }

    // 兼容旧 WebView
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });
      const maxSide = 1920;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxSide || h > maxSide) {
        const scale = Math.min(maxSide / w, maxSide / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
          'image/jpeg',
          0.88
        );
      });
      const base = (file.name || 'photo').replace(/\.[^.]+$/i, '');
      return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    console.warn('[image] compress failed, use original', e);
    return file;
  }
}

async function setPendingAttachment(file) {
  if (isVideoFile(file)) {
    alert('不支持视频，请只选择照片');
    fileInput.value = '';
    return;
  }
  if (!isImageFile(file)) {
    alert('请选择图片（JPG/PNG 等），不要选视频');
    fileInput.value = '';
    return;
  }
  try {
    sendBtn.disabled = true;
    const prepared = await prepareImageForUpload(file);
    pendingAttachmentFile = prepared;
    pastePreview.style.display = 'inline-flex';
    if (pasteThumb.src && pasteThumb.src.startsWith('blob:')) {
      URL.revokeObjectURL(pasteThumb.src);
    }
    pasteThumb.src = URL.createObjectURL(prepared);
    pasteThumb.alt = prepared.name || 'attachment';
    fileInput.value = '';
  } catch (e) {
    console.error(e);
    alert('图片处理失败，请换一张 JPG/PNG 照片');
  } finally {
    sendBtn.disabled = false;
  }
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

// 文件选择器也走统一 pendingAttachmentFile（按钮触发，兼容移动端）
uploadBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  if (file) setPendingAttachment(file);
});

// 移除预览
pasteClear.addEventListener('click', clearPendingAttachment);

// ===== 会话栏收起/展开（桌面）与抽屉（移动端 H5）=====
function isMobileLayout() {
  return MOBILE_MQ.matches;
}

function syncBodyScrollLock() {
  const appEl = document.querySelector('.app');
  document.body.classList.toggle('scroll-lock', appEl.classList.contains('sidebar-mobile-open'));
}

function setMobileSidebarOpen(open) {
  const appEl = document.querySelector('.app');
  appEl.classList.toggle('sidebar-mobile-open', !!open);
  syncBodyScrollLock();
}

function closeMobileOverlays() {
  if (!isMobileLayout()) return;
  setMobileSidebarOpen(false);
}

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

function initSidebarState() {
  const appEl = document.querySelector('.app');
  appEl.classList.remove('sidebar-mobile-open');
  syncBodyScrollLock();
  if (isMobileLayout()) {
    applySidebarCollapsed(false);
  } else {
    applySidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1');
  }
}

sidebarToggleBtn.addEventListener('click', () => {
  const appEl = document.querySelector('.app');
  if (isMobileLayout()) {
    setMobileSidebarOpen(!appEl.classList.contains('sidebar-mobile-open'));
    return;
  }
  applySidebarCollapsed(!appEl.classList.contains('sidebar-collapsed'));
});

mobileMenuBtn?.addEventListener('click', () => setMobileSidebarOpen(true));
sidebarBackdrop?.addEventListener('click', () => setMobileSidebarOpen(false));

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(initSidebarState, 150);
});

initSidebarState();

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
  closeMobileOverlays();
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
  closeMobileOverlays();
}

async function sendMessage() {
  if (!currentSessionId) {
    alert('请先在左侧创建/选择一个会话');
    return;
  }

  const text = userInput.value.trim();
  let file = pendingAttachmentFile || (fileInput.files && fileInput.files[0]);

  if (!text && !file) return;

  window.speechSynthesis?.cancel?.();
  sendBtn.disabled = true;
  try {
    if (file) {
      file = await prepareImageForUpload(file);
      pendingAttachmentFile = file;
    }
  } catch (e) {
    console.error(e);
    alert('图片处理失败，请换一张 JPG/PNG 照片');
    sendBtn.disabled = false;
    return;
  }

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
    if (file) {
      const uploadName = file.name || `photo_${Date.now()}.jpg`;
      formData.append('image', file, uploadName);
      console.log('[upload] send', {
        name: uploadName,
        type: file.type,
        size: file.size,
      });
    }

    const res = await fetch('/chat/stream', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok || !res.body) {
      const msg = await res.text();
      let errText = msg || `HTTP ${res.status}`;
      try {
        const j = JSON.parse(msg);
        if (j.error) errText = j.error;
        if (j.uploadId) {
          errText += ` [日志ID: ${j.uploadId}]`;
          console.error('[upload] failed uploadId=', j.uploadId, j.hint || '');
        }
        if (j.debug) console.error('[upload-debug]', j.debug);
      } catch {
        /* plain text */
      }
      throw new Error(errText);
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
    typing.innerHTML = `${ASSISTANT_NAME}正在思考<span class="dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>`;
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
          speakAssistantText(ai);
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
    const errMsg = `请求出错：${err?.message || String(err)}`;
    appendMessage('ai', errMsg);
    speakAssistantText(errMsg);
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

// ===== 语音输出（TTS）=====
const VOICE_OUTPUT_KEY = 'voiceOutputEnabled';
let voiceOutputEnabled = localStorage.getItem(VOICE_OUTPUT_KEY) === '1';
let preferredZhVoice = null;

function stripTextForSpeech(text) {
  if (!text) return '';
  return text
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/https?:\/\/\S+/g, '链接')
    .replace(/[\*_~`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickZhVoice() {
  if (preferredZhVoice) return preferredZhVoice;
  const voices = window.speechSynthesis?.getVoices?.() || [];
  preferredZhVoice =
    voices.find((v) => v.lang === 'zh-CN') ||
    voices.find((v) => v.lang.startsWith('zh')) ||
    null;
  return preferredZhVoice;
}

function speakAssistantText(text) {
  if (!voiceOutputEnabled || !window.speechSynthesis) return;
  const plain = stripTextForSpeech(text);
  if (!plain) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(plain);
  utterance.lang = 'zh-CN';
  const voice = pickZhVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

function updateVoiceOutputBtn() {
  if (!voiceOutputBtn) return;
  voiceOutputBtn.classList.toggle('active', voiceOutputEnabled);
  voiceOutputBtn.setAttribute('aria-pressed', voiceOutputEnabled ? 'true' : 'false');
  voiceOutputBtn.textContent = voiceOutputEnabled ? '🔊' : '🔇';
  voiceOutputBtn.title = voiceOutputEnabled ? '朗读回复（开）' : '朗读回复（关）';
}

function initVoiceOutput() {
  if (!voiceOutputBtn) return;
  if (!window.speechSynthesis) {
    voiceOutputBtn.title = '当前浏览器不支持语音朗读';
    voiceOutputBtn.disabled = true;
    return;
  }
  updateVoiceOutputBtn();
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    preferredZhVoice = null;
    pickZhVoice();
  });
  voiceOutputBtn.addEventListener('click', () => {
    voiceOutputEnabled = !voiceOutputEnabled;
    localStorage.setItem(VOICE_OUTPUT_KEY, voiceOutputEnabled ? '1' : '0');
    updateVoiceOutputBtn();
    if (!voiceOutputEnabled) window.speechSynthesis.cancel();
  });
}

// ===== 语音输入（移动端：点击开关 / 长按；桌面：按住说话）=====
const voiceStatusEl = document.getElementById('voice-status');
const voiceToastEl = document.getElementById('voice-toast');
const voiceDebugEl = document.getElementById('voice-debug');
const VOICE_DEBUG =
  localStorage.getItem('DEBUG') === '1' || localStorage.getItem('DEBUG') === 'true';

function isIOSDevice() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function getInAppBrowserName() {
  const ua = navigator.userAgent || '';
  if (/MicroMessenger/i.test(ua)) return '微信';
  if (/QQ\//i.test(ua)) return 'QQ';
  return null;
}

function isChromeAndroid() {
  const ua = navigator.userAgent || '';
  return /Android/i.test(ua) && /Chrome/i.test(ua) && !/Edg/i.test(ua);
}

function isSafariIOS() {
  const ua = navigator.userAgent || '';
  return (
    isIOSDevice() &&
    /Safari/i.test(ua) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS|UCBrowser/i.test(ua)
  );
}

function getVoiceEnvProfile() {
  return {
    inApp: getInAppBrowserName(),
    isChromeAndroid: isChromeAndroid(),
    isSafariIOS: isSafariIOS(),
    isIOS: isIOSDevice(),
  };
}

const VOICE_DIAG_PATH = '/voice-test.html';

function voiceSttNoResultMessage({ micGranted = false } = {}) {
  const env = getVoiceEnvProfile();
  const diag = `诊断页：${VOICE_DIAG_PATH}`;

  if (!micGranted) {
    return `未识别到文字。请对着麦克风清晰说 1–2 秒；若仍失败请在浏览器设置中允许本站使用麦克风（${diag}）`;
  }

  if (env.isChromeAndroid) {
    return `麦克风正常，但浏览器语音识别在大陆常无响应。请刷新页面使用阿里云语音，或 iPhone Safari / 键盘语音（${diag}）`;
  }

  if (env.isSafariIOS) {
    return `麦克风正常，但未收到识别结果。请清晰说 1–2 秒再结束；若仍失败可换网络，或用键盘语音输入（${diag}）`;
  }

  return `麦克风权限正常，但浏览器未返回识别文字（非权限问题）。请换 Chrome/Safari 或检查网络（${diag}）`;
}

function voiceNoResponseHintMessage() {
  const env = getVoiceEnvProfile();
  if (env.isChromeAndroid) {
    return '识别无响应：安卓 Chrome 依赖 Google 语音服务，大陆网络常被阻断。建议 iPhone Safari、键盘语音或代理';
  }
  if (env.isSafariIOS) {
    return '识别无响应：请确保网络正常并清晰说话 1–2 秒，或改用键盘语音输入';
  }
  return '识别无响应，请换 Chrome/Safari 或检查 HTTPS/网络';
}

function voiceInitHintMessage() {
  const env = getVoiceEnvProfile();
  if (env.inApp) return null;
  if (env.isChromeAndroid) {
    return '提示：安卓 Chrome 网页语音在大陆可能不可用（需境外服务）。iPhone Safari 或键盘语音更稳';
  }
  if (env.isSafariIOS) {
    return '提示：Safari 网页语音需 HTTPS；说完 1–2 秒再点 🎤 结束';
  }
  return null;
}

function hasSpeechRecognitionApi() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

const WEB_SPEECH_BROKEN_KEY = 'aichater-web-speech-broken';
const SERVER_STT_RATE = 16000;
const SERVER_STT_MIN_RECORD_MS = 800;
const SERVER_STT_MAX_RECORD_MS = 60000;
const SERVER_STT_FETCH_MS = 60000;

function shouldPreferServerStt() {
  if (localStorage.getItem(WEB_SPEECH_BROKEN_KEY) === '1') return true;
  if (!hasSpeechRecognitionApi()) return true;
  if (isChromeAndroid()) return true;
  return false;
}

function markWebSpeechBroken() {
  if (localStorage.getItem(WEB_SPEECH_BROKEN_KEY) === '1') return;
  localStorage.setItem(WEB_SPEECH_BROKEN_KEY, '1');
  showVoiceToast('网页语音识别无响应，请刷新页面后使用国内语音服务', 5500);
}

const RECORDER_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

function pickRecorderMimeType() {
  if (!window.MediaRecorder?.isTypeSupported) return '';
  for (const t of RECORDER_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

function mixToMonoFloat32(audioBuffer) {
  if (audioBuffer.numberOfChannels === 1) return audioBuffer.getChannelData(0);
  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
  const out = new Float32Array(audioBuffer.length);
  for (let i = 0; i < audioBuffer.length; i++) out[i] = (left[i] + right[i]) * 0.5;
  return out;
}

function resampleFloat32(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const outLen = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const out = new Float32Array(outLen);
  const ratio = fromRate / toRate;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = samples[idx] ?? 0;
    const b = samples[Math.min(idx + 1, samples.length - 1)] ?? 0;
    out[i] = a * (1 - frac) + b * frac;
  }
  return out;
}

function encodeWavPcm16(samples, sampleRate) {
  const dataLen = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLen, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

async function audioBlobToWav16k(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const mono = mixToMonoFloat32(decoded);
    const resampled = resampleFloat32(mono, decoded.sampleRate, SERVER_STT_RATE);
    return new Blob([encodeWavPcm16(resampled, SERVER_STT_RATE)], { type: 'audio/wav' });
  } finally {
    await ctx.close();
  }
}

async function transcribeAudioWithServer(blob) {
  const wavBlob = await audioBlobToWav16k(blob);
  const form = new FormData();
  form.append('audio', wavBlob, 'recording.wav');
  const fetchOpts = { method: 'POST', body: form };
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    fetchOpts.signal = AbortSignal.timeout(SERVER_STT_FETCH_MS);
  }
  const res = await fetch('/api/speech-to-text', fetchOpts);
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new Error(data.error || `识别失败 HTTP ${res.status}`);
  }
  return (data.text || '').trim();
}

let voiceToastTimer = null;

function voiceDebug(...args) {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  console.log('[voice]', ...args);
  if (!VOICE_DEBUG || !voiceDebugEl) return;
  voiceDebugEl.hidden = false;
  const prev = voiceDebugEl.textContent === '' ? '' : voiceDebugEl.textContent + '\n';
  voiceDebugEl.textContent = (prev + line).slice(-800);
}

function showVoiceToast(message, ms = 3200) {
  if (!message) return;
  if (voiceToastEl) {
    voiceToastEl.textContent = message;
    voiceToastEl.hidden = false;
    clearTimeout(voiceToastTimer);
    voiceToastTimer = setTimeout(() => {
      voiceToastEl.hidden = true;
    }, ms);
  } else {
    alert(message);
  }
}

function setVoiceStatus(text) {
  if (!voiceStatusEl) return;
  if (text) {
    voiceStatusEl.textContent = text;
    voiceStatusEl.hidden = false;
  } else {
    voiceStatusEl.textContent = '';
    voiceStatusEl.hidden = true;
  }
}

function voiceErrorMessage(code) {
  const inApp = getInAppBrowserName();
  const map = {
    'not-allowed':
      '麦克风权限未开启，请在浏览器或系统设置中允许本站使用麦克风（与输入法键盘语音无关）',
    'service-not-allowed': inApp
      ? `${inApp}内置浏览器禁止使用网页语音，请用 Safari/Chrome 打开本页`
      : '浏览器禁止语音服务：请用 HTTPS 访问，或换 Chrome/Safari（内置浏览器常不支持）',
    'no-speech':
      '未检测到说话内容。请对着麦克风清晰说 1–2 秒后再点 🎤 结束（结束太快也会误判）',
    network: '语音识别需要网络，请检查网络后重试',
    'audio-capture': '无法访问麦克风，请检查设备连接或系统麦克风权限',
    aborted: '',
    'bad-grammar': '语音识别配置错误',
    'language-not-supported': '当前浏览器不支持中文语音识别，请换 Chrome 或 Safari',
    'service-not-available': inApp
      ? `${inApp}不支持网页语音识别，请用系统浏览器打开，或使用键盘语音输入`
      : '网页语音识别服务不可用，请换 Chrome/Safari 或稍后重试',
  };
  return map[code] || `语音识别失败（${code}）`;
}

function speechRecognitionUnsupportedMessage() {
  const inApp = getInAppBrowserName();
  if (inApp) {
    return `${inApp}内置浏览器不支持网页语音识别，请用 Chrome/Safari 打开，或使用输入法键盘上的语音`;
  }
  return '当前浏览器不支持网页语音识别，请用 Chrome/Safari 打开，或使用系统键盘语音输入';
}

function initVoiceInput() {
  if (!voiceInputBtn) return;
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
    const msg = '当前浏览器不支持录音，请换 Chrome/Safari 或使用键盘语音';
    voiceInputBtn.title = msg;
    voiceInputBtn.disabled = true;
    showVoiceToast(msg);
    return;
  }
  if (shouldPreferServerStt()) {
    initServerSttVoiceInput();
    return;
  }
  initWebSpeechVoiceInput();
}

function initServerSttVoiceInput() {
  const httpsPort = window.location.port === '3001' ? '3000' : window.location.port || '3000';
  const useTouch = 'ontouchstart' in window;
  const micHint = useTouch
    ? '点 🎤 开始录音，清晰说 1–2 秒后再点结束（阿里云语音）'
    : '点 🎤 开始/结束录音（阿里云语音）';

  voiceInputBtn.disabled = false;
  voiceInputBtn.title = micHint;
  voiceInputBtn.setAttribute('aria-label', micHint);

  if (!window.isSecureContext) {
    const httpsHint = `语音需 HTTPS，请访问 https://电脑IP:${httpsPort}`;
    voiceInputBtn.title = httpsHint;
    showVoiceToast(`语音需 HTTPS：请用 https://电脑IP:${httpsPort} 打开`);
  }

  let recording = false;
  let recognizing = false;
  let mediaRecorder = null;
  let mediaStream = null;
  let chunks = [];
  let recordStartedAt = 0;
  let touchHoldTimer = null;
  let touchHoldMode = false;
  let touchStartAt = 0;
  let touchTapHandled = false;

  async function preflightMicPermission() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch (err) {
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        showVoiceToast(voiceErrorMessage('not-allowed'));
        return false;
      }
      if (err?.name === 'NotFoundError') {
        showVoiceToast(voiceErrorMessage('audio-capture'));
        return false;
      }
      return true;
    }
  }

  function releaseStream() {
    mediaStream?.getTracks?.().forEach((t) => t.stop());
    mediaStream = null;
  }

  async function startServerRecord(e) {
    if (e?.cancelable) e.preventDefault();
    e?.stopPropagation?.();
    if (recording || recognizing) return;
    if (!window.isSecureContext) {
      showVoiceToast(`语音需 HTTPS：请用 https://电脑IP:${httpsPort} 打开`);
      return;
    }
    const ok = await preflightMicPermission();
    if (!ok) return;

    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickRecorderMimeType();
    chunks = [];
    mediaRecorder = mimeType
      ? new MediaRecorder(mediaStream, { mimeType })
      : new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (ev) => {
      if (ev.data?.size) chunks.push(ev.data);
    };
    mediaRecorder.start();
    recording = true;
    recordStartedAt = Date.now();
    voiceInputBtn.classList.add('recording');
    voiceInputBtn.setAttribute('aria-pressed', 'true');
    setVoiceStatus('正在录音…');
    voiceDebug('server-record-start', { mimeType: mediaRecorder.mimeType });
    showVoiceToast('正在录音，说 1–2 秒后点 🎤 结束', 2600);
  }

  async function stopServerRecord(e, { force = false } = {}) {
    if (e?.cancelable) e.preventDefault();
    e?.stopPropagation?.();
    if (!recording || recognizing) return;

    const elapsed = Date.now() - recordStartedAt;
    if (!force && elapsed < SERVER_STT_MIN_RECORD_MS) {
      showVoiceToast('请继续说 1–2 秒…', 1800);
      setVoiceStatus('请继续说 1–2 秒…');
      return;
    }

    recording = false;
    recognizing = true;
    voiceInputBtn.classList.remove('recording');
    voiceInputBtn.setAttribute('aria-pressed', 'false');
    setVoiceStatus('正在识别…');

    const rec = mediaRecorder;
    const blob = await new Promise((resolve, reject) => {
      rec.onstop = () => {
        const type = rec.mimeType || 'audio/webm';
        resolve(new Blob(chunks, { type }));
      };
      rec.onerror = () => reject(new Error('录音失败'));
      try {
        rec.stop();
      } catch (err) {
        reject(err);
      }
    });
    releaseStream();

    try {
      const text = await transcribeAudioWithServer(blob);
      if (text) {
        const base = userInput.value.trim();
        userInput.value = base ? `${base} ${text}` : text;
        voiceDebug('server-stt-ok', { len: text.length, tail: text.slice(-40) });
      } else {
        showVoiceToast('未识别到文字，请对着麦克风清晰说话后重试');
      }
    } catch (err) {
      voiceDebug('server-stt-fail', err?.message);
      showVoiceToast(err?.message || '语音识别失败');
    } finally {
      recognizing = false;
      setVoiceStatus('');
      chunks = [];
      mediaRecorder = null;
    }
  }

  function toggleServerRecord(e) {
    if (recording) stopServerRecord(e);
    else startServerRecord(e);
  }

  voiceInputBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!useTouch) {
      toggleServerRecord(e);
      return;
    }
    if (touchTapHandled) {
      touchTapHandled = false;
      return;
    }
    toggleServerRecord(e);
  });

  if (useTouch) {
    const HOLD_MS = 280;
    voiceInputBtn.addEventListener(
      'touchstart',
      (e) => {
        touchHoldMode = false;
        touchStartAt = Date.now();
        if (touchHoldTimer) clearTimeout(touchHoldTimer);
        touchHoldTimer = setTimeout(() => {
          touchHoldMode = true;
          if (!recording) startServerRecord(e);
        }, HOLD_MS);
      },
      { passive: false }
    );
    voiceInputBtn.addEventListener(
      'touchend',
      (e) => {
        const elapsed = Date.now() - touchStartAt;
        if (touchHoldTimer) {
          clearTimeout(touchHoldTimer);
          touchHoldTimer = null;
        }
        if (touchHoldMode) {
          e.preventDefault();
          touchHoldMode = false;
          stopServerRecord(e, { force: true });
          return;
        }
        if (elapsed < HOLD_MS) {
          e.preventDefault();
          touchTapHandled = true;
          toggleServerRecord(e);
        } else if (recording) {
          e.preventDefault();
          stopServerRecord(e);
        }
      },
      { passive: false }
    );
    voiceInputBtn.addEventListener(
      'touchcancel',
      () => {
        if (touchHoldTimer) clearTimeout(touchHoldTimer);
        touchHoldMode = false;
        if (recording) stopServerRecord(null, { force: true });
      },
      { passive: false }
    );
  }

  voiceInputBtn.addEventListener('pointerdown', (e) => {
    if (useTouch && e.pointerType === 'touch') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!recording) startServerRecord(e);
  });
  voiceInputBtn.addEventListener('pointerup', (e) => {
    if (useTouch && e.pointerType === 'touch') return;
    if (recording) stopServerRecord(e);
  });
  voiceInputBtn.addEventListener('pointercancel', (e) => {
    if (useTouch && e.pointerType === 'touch') return;
    if (recording) stopServerRecord(e, { force: true });
  });
  voiceInputBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  if (VOICE_DEBUG) {
    voiceDebug('init-server-stt', { env: getVoiceEnvProfile(), broken: localStorage.getItem(WEB_SPEECH_BROKEN_KEY) });
  }
}

function initWebSpeechVoiceInput() {
  if (!voiceInputBtn) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const httpsPort = window.location.port === '3001' ? '3000' : window.location.port || '3000';

  if (!SpeechRecognition) {
    initServerSttVoiceInput();
    return;
  }

  const useTouch = 'ontouchstart' in window;
  const isIOS = isIOSDevice();
  const MIN_RECORD_MS = 800;
  const MAX_RECORD_MS = 30000;
  const NO_RESPONSE_HINT_MS = 3000;
  const FORCE_STOP_ATTEMPTS = 3;
  const EMPTY_CHECK_DELAY_MS = 200;
  const NO_SPEECH_RETRY_MS = 2000;
  const VOICE_INIT_HINT_KEY = 'aichater-voice-init-hint-shown';
  const micHint = useTouch
    ? '点 🎤 开始，清晰说 1–2 秒后再点结束；或长按说话（网页语音，非键盘语音）'
    : '按住 🎤 说话至少 1 秒再松手（网页语音，非键盘语音）';

  const inApp = getInAppBrowserName();
  voiceInputBtn.title = inApp ? `${inApp}内网页语音常不可用，建议用 Safari/Chrome。${micHint}` : micHint;
  voiceInputBtn.setAttribute('aria-label', voiceInputBtn.title);

  if (!window.isSecureContext) {
    const httpsHint = `网页语音需 HTTPS，请访问 https://电脑IP:${httpsPort}`;
    voiceInputBtn.title = httpsHint;
    voiceInputBtn.setAttribute('aria-label', httpsHint);
    showVoiceToast(`语音需 HTTPS：请用 https://电脑IP:${httpsPort} 打开`);
  }

  let recognition = null;
  let listenActive = false;
  let starting = false;
  let gotSpeechResult = false;
  let voiceBaseText = '';
  let voiceFinalText = '';
  let voiceInterimText = '';
  let listenStartedAt = 0;
  let listenRequestedAt = 0;
  let userStopping = false;
  let noSpeechRetried = false;
  let emptyCheckTimer = null;
  let maxRecordTimer = null;
  let noResponseHintTimer = null;
  let stopAttemptCount = 0;
  let noResponseHintShown = false;
  let touchHoldTimer = null;
  let touchHoldMode = false;
  let touchStartAt = 0;
  let touchTapHandled = false;
  let micPreflightDone = false;
  let micPermissionGranted = false;

  function getVoiceMergedText() {
    return voiceBaseText + voiceFinalText + voiceInterimText;
  }

  function hasNewSpeechContent() {
    if (gotSpeechResult || voiceInterimText.trim() || voiceFinalText.trim()) return true;
    const merged = getVoiceMergedText().trim();
    const base = voiceBaseText.trim();
    return !!(merged && merged !== base);
  }

  function commitVoiceToInput() {
    const merged = getVoiceMergedText();
    if (merged.trim()) {
      userInput.value = merged;
      gotSpeechResult = true;
    }
    return merged;
  }

  function listenElapsedMs() {
    return listenRequestedAt ? Date.now() - listenRequestedAt : 0;
  }

  function segmentElapsedMs() {
    const t = listenStartedAt || listenRequestedAt;
    return t ? Date.now() - t : 0;
  }

  function canStopListen() {
    if (listenElapsedMs() >= MIN_RECORD_MS) return true;
    return hasNewSpeechContent();
  }

  function clearEmptyCheckTimer() {
    if (emptyCheckTimer) {
      clearTimeout(emptyCheckTimer);
      emptyCheckTimer = null;
    }
  }

  function clearMaxRecordTimer() {
    if (maxRecordTimer) {
      clearTimeout(maxRecordTimer);
      maxRecordTimer = null;
    }
  }

  function clearNoResponseHintTimer() {
    if (noResponseHintTimer) {
      clearTimeout(noResponseHintTimer);
      noResponseHintTimer = null;
    }
  }

  function clearListenTimers() {
    clearEmptyCheckTimer();
    clearMaxRecordTimer();
    clearNoResponseHintTimer();
  }

  function scheduleNoResponseHint() {
    clearNoResponseHintTimer();
    noResponseHintTimer = setTimeout(() => {
      noResponseHintTimer = null;
      if (!listenActive || gotSpeechResult || noResponseHintShown) return;
      noResponseHintShown = true;
      showVoiceToast(voiceNoResponseHintMessage(), 5000);
      voiceDebug('no-response-hint', { elapsed: listenElapsedMs(), env: getVoiceEnvProfile() });
    }, NO_RESPONSE_HINT_MS);
  }

  function scheduleMaxRecordAutoStop() {
    clearMaxRecordTimer();
    maxRecordTimer = setTimeout(() => {
      maxRecordTimer = null;
      if (!listenActive) return;
      voiceDebug('max-duration auto-stop');
      stopListen(null, { force: true, autoMaxDuration: true });
    }, MAX_RECORD_MS);
  }

  function scheduleEmptyCheck({ silent = false, emptyMessage = null, onEmpty = null } = {}) {
    clearEmptyCheckTimer();
    emptyCheckTimer = setTimeout(() => {
      emptyCheckTimer = null;
      commitVoiceToInput();
      if (!silent && !hasNewSpeechContent()) {
        onEmpty?.();
        const msg = emptyMessage || voiceErrorMessage('no-speech');
        showVoiceToast(msg, emptyMessage ? 6500 : 3200);
      }
    }, EMPTY_CHECK_DELAY_MS);
  }

  function emptyMessageAfterStop({ force = false } = {}) {
    if (force || listenElapsedMs() >= MIN_RECORD_MS) {
      return voiceSttNoResultMessage({ micGranted: micPermissionGranted });
    }
    return voiceErrorMessage('no-speech');
  }

  function setRecordingUI(active, statusText = '') {
    voiceInputBtn.classList.toggle('recording', active);
    voiceInputBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    setVoiceStatus(active ? statusText || '正在聆听…' : '');
  }

  function ensureRecognition() {
    if (recognition) return recognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = !isIOS;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      if (!listenStartedAt) listenStartedAt = Date.now();
      noSpeechRetried = false;
      voiceInterimText = '';
      voiceDebug('onstart', { sessionElapsed: listenElapsedMs() });
      setRecordingUI(true, '正在聆听…');
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) voiceFinalText += piece;
        else interim += piece;
      }
      voiceInterimText = interim;
      const merged = getVoiceMergedText();
      if (merged.trim()) gotSpeechResult = true;
      userInput.value = merged;
      voiceDebug('onresult', {
        resultIndex: event.resultIndex,
        count: event.results.length,
        finalLen: voiceFinalText.length,
        interimLen: voiceInterimText.length,
        tail: merged.slice(-40),
      });
    };

    recognition.onend = () => {
      voiceDebug('onend', { listenActive, userStopping, gotSpeechResult });
      if (!listenActive || userStopping) {
        setRecordingUI(false);
        return;
      }
      listenStartedAt = Date.now();
      try {
        recognition.start();
        setRecordingUI(true, '正在聆听…');
      } catch (err) {
        listenActive = false;
        starting = false;
        setRecordingUI(false);
        voiceDebug('restart failed', err?.message);
        showVoiceToast('语音识别已停止，请再次点击麦克风');
      }
    };

    recognition.onerror = (event) => {
      voiceDebug('onerror', event.error);
      if (event.error === 'aborted') return;

      if (event.error === 'no-speech') {
        if (listenActive && !userStopping) {
          if (!noSpeechRetried && segmentElapsedMs() < NO_SPEECH_RETRY_MS) {
            noSpeechRetried = true;
            listenStartedAt = Date.now();
            try {
              recognition.start();
              voiceDebug('no-speech retry');
              return;
            } catch (err) {
              voiceDebug('no-speech retry failed', err?.message);
            }
          }
          return;
        }
        setRecordingUI(false);
        if (userStopping || emptyCheckTimer) return;
        if (!hasNewSpeechContent()) scheduleEmptyCheck();
        return;
      }

      listenActive = false;
      starting = false;
      setRecordingUI(false);
      const msg = voiceErrorMessage(event.error);
      if (msg) showVoiceToast(msg);
      if (event.error === 'service-not-allowed' && !window.isSecureContext) {
        showVoiceToast(
          `${msg}。请访问 https://你的电脑IP:${httpsPort}（同一 Wi-Fi）并信任证书`
        );
      }
    };
    return recognition;
  }

  function secureContextBlocked() {
    showVoiceToast(
      `网页语音需要 HTTPS。请用手机访问 https://你的电脑IP:${httpsPort}（同一 Wi-Fi），信任证书后重试。`
    );
    return true;
  }

  async function preflightMicPermission() {
    if (micPreflightDone || !navigator.mediaDevices?.getUserMedia) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      micPreflightDone = true;
      micPermissionGranted = true;
      return true;
    } catch (err) {
      micPreflightDone = true;
      micPermissionGranted = false;
      voiceDebug('preflight', err?.name || err);
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        showVoiceToast(voiceErrorMessage('not-allowed'));
        return false;
      }
      if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
        showVoiceToast(voiceErrorMessage('audio-capture'));
        return false;
      }
      return true;
    }
  }

  async function startListen(e, { fromToggle = false } = {}) {
    if (e?.cancelable) e.preventDefault();
    e?.stopPropagation?.();
    if (listenActive || starting) return;

    if (!window.isSecureContext) {
      secureContextBlocked();
      return;
    }

    starting = true;
    const ok = await preflightMicPermission();
    if (!ok) {
      starting = false;
      return;
    }

    listenActive = true;
    userStopping = false;
    gotSpeechResult = false;
    voiceBaseText = userInput.value;
    if (voiceBaseText && !/[\s\n]$/.test(voiceBaseText)) voiceBaseText += ' ';
    voiceFinalText = '';
    voiceInterimText = '';
    listenStartedAt = 0;
    listenRequestedAt = Date.now();
    stopAttemptCount = 0;
    noResponseHintShown = false;
    clearListenTimers();
    scheduleNoResponseHint();
    scheduleMaxRecordAutoStop();

    const rec = ensureRecognition();
    try {
      rec.abort();
    } catch {
      /* ignore */
    }
    try {
      rec.start();
      setRecordingUI(true, '正在聆听…');
      voiceDebug('start', fromToggle ? 'toggle' : 'hold');
      if (fromToggle) showVoiceToast('正在聆听，请说 1–2 秒后再点 🎤 结束', 2600);
    } catch (err) {
      listenActive = false;
      setRecordingUI(false);
      const msg = err?.message?.includes('already started')
        ? '语音识别忙，请稍后再试'
        : `无法启动语音识别：${err?.message || err}`;
      showVoiceToast(msg);
      voiceDebug('start failed', err?.message || err);
    } finally {
      starting = false;
    }
  }

  function stopListen(e, { silentNoSpeech = false, force = false, autoMaxDuration = false } = {}) {
    if (e?.cancelable) e.preventDefault();
    e?.stopPropagation?.();
    if (!listenActive && !starting) return;

    clearMaxRecordTimer();
    clearNoResponseHintTimer();

    if (!force && listenActive && !canStopListen()) {
      stopAttemptCount += 1;
      if (stopAttemptCount >= FORCE_STOP_ATTEMPTS) {
        voiceDebug('stop force', { stopAttemptCount, elapsed: listenElapsedMs() });
        return stopListen(e, { silentNoSpeech, force: true, autoMaxDuration });
      }
      showVoiceToast('请继续说话…', 1800);
      setRecordingUI(true, '请继续说 1–2 秒…');
      voiceDebug('stop blocked', { elapsed: listenElapsedMs(), stopAttemptCount });
      return;
    }

    stopAttemptCount = 0;
    userStopping = true;
    const hadResult = hasNewSpeechContent();
    const elapsed = listenElapsedMs();
    listenActive = false;
    starting = false;
    try {
      recognition?.stop();
    } catch {
      try {
        recognition?.abort();
      } catch {
        /* ignore */
      }
    }
    setRecordingUI(false);
    voiceDebug('stop', { hadResult, elapsed, force, autoMaxDuration });

    if (silentNoSpeech) {
      clearEmptyCheckTimer();
      return;
    }
    if (hadResult) {
      clearEmptyCheckTimer();
      commitVoiceToInput();
      return;
    }
    const emptyMsg = emptyMessageAfterStop({ force: force || autoMaxDuration });
    scheduleEmptyCheck({
      emptyMessage: emptyMsg,
      onEmpty: () => {
        if (micPermissionGranted && !hasNewSpeechContent()) markWebSpeechBroken();
      },
    });
  }

  function toggleListen(e) {
    if (listenActive || starting) stopListen(e);
    else startListen(e, { fromToggle: true });
  }

  voiceInputBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!useTouch) return;
    if (touchTapHandled) {
      touchTapHandled = false;
      return;
    }
    toggleListen(e);
  });

  if (useTouch) {
    const HOLD_MS = 280;

    const clearTouchHoldTimer = () => {
      if (touchHoldTimer) {
        clearTimeout(touchHoldTimer);
        touchHoldTimer = null;
      }
    };

    voiceInputBtn.addEventListener(
      'touchstart',
      (e) => {
        touchHoldMode = false;
        touchStartAt = Date.now();
        clearTouchHoldTimer();
        touchHoldTimer = setTimeout(() => {
          touchHoldMode = true;
          if (!listenActive) startListen(e);
        }, HOLD_MS);
      },
      { passive: false }
    );

    voiceInputBtn.addEventListener(
      'touchend',
      (e) => {
        const elapsed = Date.now() - touchStartAt;
        clearTouchHoldTimer();
        if (touchHoldMode) {
          e.preventDefault();
          touchHoldMode = false;
          stopListen(e);
          return;
        }
        if (elapsed < HOLD_MS) {
          e.preventDefault();
          touchTapHandled = true;
          toggleListen(e);
          return;
        }
        if (listenActive) {
          e.preventDefault();
          stopListen(e);
        }
      },
      { passive: false }
    );

    voiceInputBtn.addEventListener(
      'touchcancel',
      (e) => {
        clearTouchHoldTimer();
        touchHoldMode = false;
        if (listenActive) stopListen(e);
      },
      { passive: false }
    );

    document.addEventListener(
      'touchend',
      (e) => {
        if (touchHoldMode && listenActive && !voiceInputBtn.contains(e.target)) {
          touchHoldMode = false;
          stopListen(e);
        }
      },
      { passive: false, capture: true }
    );
  }

  voiceInputBtn.addEventListener('pointerdown', (e) => {
    if (useTouch && e.pointerType === 'touch') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    voiceInputBtn.setPointerCapture?.(e.pointerId);
    startListen(e);
  });
  voiceInputBtn.addEventListener('pointerup', (e) => {
    if (useTouch && e.pointerType === 'touch') return;
    if (voiceInputBtn.hasPointerCapture?.(e.pointerId)) {
      voiceInputBtn.releasePointerCapture(e.pointerId);
    }
    stopListen(e);
  });
  voiceInputBtn.addEventListener('pointercancel', (e) => {
    if (useTouch && e.pointerType === 'touch') return;
    stopListen(e);
  });
  voiceInputBtn.addEventListener('pointerleave', (e) => {
    if (useTouch && e.pointerType === 'touch') return;
    if (listenActive && e.buttons === 0) stopListen(e);
  });
  voiceInputBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  if (VOICE_DEBUG) {
    voiceDebug('init', {
      useTouch,
      isIOS,
      secure: window.isSecureContext,
      env: getVoiceEnvProfile(),
      speechApi: hasSpeechRecognitionApi(),
    });
  }

  const initHint = voiceInitHintMessage();
  if (initHint && !sessionStorage.getItem(VOICE_INIT_HINT_KEY)) {
    sessionStorage.setItem(VOICE_INIT_HINT_KEY, '1');
    setTimeout(() => showVoiceToast(initHint, 5500), 1200);
  }
}

initVoiceOutput();
initVoiceInput();

// 初始化（等待会话列表/自动新建完成后再交互，避免未选中会话就发送）
loadLinks();
(async () => {
  try {
    await fetchSessions();
  } catch (e) {
    console.error('会话列表加载失败', e);
  }
})();
