// Archive/WebDAV workflow adapted from 海姆休息室 archive_sync.js (GPL-3.0).
// PDF-specific storage uses atomic merge and immutable source files instead of clearing stores.
import { zip, unzipSync, strToU8, strFromU8 } from 'fflate';
import { snapshot, mergeSnapshot, get, STORES } from './storage.js';
import { validateFolderTree } from './library.js';
import { sha256, safeUrl, bytesToBase64 } from './utils.js';
import { getSettings, saveSettings, reloadSettings } from './settings.js';
const MAGIC = strToU8('PBRIDGE1');
const MAX_ARCHIVE = 1024 * 1024 * 1024;
function makeZip(files) {
  return new Promise((resolve, reject) =>
    zip(files, { level: 1 }, (error, data) => (error ? reject(error) : resolve(data))),
  );
}
export async function createArchive({ includeSecrets = true, password = '' } = {}) {
  const data = await snapshot();
  const entries = {};
  const digests = {};
  for (const row of data.files) {
    const path = `pdf/${row.id}.pdf`;
    const bytes = new Uint8Array(await row.blob.arrayBuffer());
    entries[path] = [bytes, { level: 0 }];
    digests[path] = await sha256(bytes);
    row.blob = undefined;
    row.path = path;
  }
  if (!includeSecrets)
    data.settings = data.settings.map((row) => {
      if (row.id !== 'app') return row;
      const value = structuredClone(row.value);
      value.apiKey = '';
      value.chatProviders = (value.chatProviders || []).map((p) => ({ ...p, apiKey: '' }));
      if (value.webdav) value.webdav = { ...value.webdav, password: '', username: '', enabled: false };
      return { ...row, value };
    });
  entries['manifest.json'] = strToU8(
    JSON.stringify({ format: 'paper-bridge', version: 2, createdAt: Date.now(), data, digests }),
  );
  const bytes = await makeZip(entries);
  return new Blob([password ? await encrypt(bytes, password) : bytes], {
    type: password ? 'application/octet-stream' : 'application/zip',
  });
}
async function keyFor(password, salt, usage) {
  const material = await crypto.subtle.importKey('raw', strToU8(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}
async function encrypt(bytes, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(password, salt, 'encrypt'), bytes),
  );
  const output = new Uint8Array(36 + data.length);
  output.set(MAGIC);
  output.set(salt, 8);
  output.set(iv, 24);
  output.set(data, 36);
  return output;
}
async function decrypt(bytes, password) {
  if (!password) throw new Error('此存档已加密，请输入备份密码');
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: bytes.slice(24, 36) },
        await keyFor(password, bytes.slice(8, 24), 'decrypt'),
        bytes.slice(36),
      ),
    );
  } catch {
    throw new Error('密码不正确或存档文件损坏，未修改本地数据');
  }
}
export async function readArchive(blob, password = '') {
  if (blob.size > MAX_ARCHIVE) throw new Error('存档超过 1 GB，请使用较小的存档，避免浏览器内存耗尽');
  let bytes = new Uint8Array(await blob.arrayBuffer());
  if (strFromU8(bytes.slice(0, 8)) === 'PBRIDGE1') bytes = await decrypt(bytes, password);
  let total = 0;
  const files = unzipSync(bytes, {
    filter(file) {
      total += file.originalSize;
      if (total > MAX_ARCHIVE) throw new Error('解压后的存档超过安全内存限制');
      return true;
    },
  });
  if (!files['manifest.json']) throw new Error('没有找到存档清单');
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  if (manifest.format !== 'paper-bridge' || ![1, 2].includes(manifest.version))
    throw new Error('这不是受支持的纸间存档。海姆休息室配置请通过 API 设置中的迁移入口导入。');
  const data = manifest.data;
  if (manifest.version === 1) {
    data.folders = [];
    data.deletions = [];
  }
  for (const store of STORES) {
    if (!Array.isArray(data?.[store])) throw new Error(`存档缺少 ${store}，未导入`);
    const ids = new Set();
    for (const row of data[store]) {
      if (
        !row ||
        typeof row.id !== 'string' ||
        !(store === 'deletions' ? /^[a-zA-Z0-9_-]{1,256}$/ : /^[a-zA-Z0-9_-]{1,200}$/).test(row.id) ||
        ids.has(row.id) ||
        !Number.isFinite(row.updatedAt)
      )
        throw new Error(`存档 ${store} 记录不合法`);
      ids.add(row.id);
    }
  }
  for (const tomb of data.deletions) {
    if (
      !['documents', 'files', 'annotations', 'conversations', 'messages', 'translations', 'folders'].includes(
        tomb.store,
      ) ||
      typeof tomb.key !== 'string' ||
      tomb.id !== `${tomb.store}-${tomb.key}` ||
      !/^[a-zA-Z0-9_-]{1,200}$/.test(tomb.key)
    )
      throw new Error('删除记录不合法');
    if (['files', 'annotations'].includes(tomb.store) && typeof tomb.documentId !== 'string')
      throw new Error('删除记录缺少所属文档');
    if (tomb.store === 'files' && tomb.key !== tomb.documentId) throw new Error('文件删除记录关联错误');
    if (['conversations', 'translations'].includes(tomb.store) && typeof tomb.rootId !== 'string')
      throw new Error('删除记录缺少文档组');
    if (tomb.store === 'messages' && typeof tomb.conversationId !== 'string')
      throw new Error('消息删除记录关联错误');
  }
  if (
    data.folders.some(
      (f) =>
        typeof f.name !== 'string' ||
        !f.name.trim() ||
        (f.parentId !== null && f.parentId !== undefined && typeof f.parentId !== 'string'),
    )
  )
    throw new Error('文件夹数据不合法');
  validateFolderTree(data.folders);
  for (const row of data.files) {
    const content = files[row.path];
    if (!content || (await sha256(content)) !== manifest.digests[row.path])
      throw new Error('PDF 校验失败，未修改本地数据');
    if (!strFromU8(content.slice(0, 1024)).includes('%PDF-')) throw new Error('存档包含无效 PDF');
    row.blob = new Blob([content], { type: 'application/pdf' });
    delete row.path;
  }
  const documentIds = new Set(data.documents.map((d) => d.id));
  const rootAnchors = new Set([
    ...documentIds,
    ...data.deletions.filter((t) => t.store === 'documents').map((t) => t.key),
  ]);
  const liveRoots = new Set(data.documents.map((d) => d.rootId));
  const folderIds = new Set(data.folders.map((f) => f.id));
  const fileIds = new Set(data.files.map((d) => d.id));
  const conversationIds = new Set(data.conversations.map((c) => c.id));
  if (
    data.documents.some(
      (d) =>
        !fileIds.has(d.id) ||
        !rootAnchors.has(d.rootId) ||
        (d.folderId && !folderIds.has(d.folderId)) ||
        typeof d.name !== 'string' ||
        !Number.isInteger(d.pages) ||
        d.pages < 1,
    )
  )
    throw new Error('文档引用不完整');
  const unit = (n) => Number.isFinite(n) && n >= 0 && n <= 1;
  if (
    data.annotations.some(
      (a) =>
        !documentIds.has(a.documentId) ||
        !Number.isInteger(a.page) ||
        a.page < 1 ||
        a.page > data.documents.find((d) => d.id === a.documentId).pages ||
        !['pen', 'highlight', 'underline', 'strike', 'text', 'note', 'shape'].includes(a.type) ||
        !/^#[0-9a-f]{6}$/i.test(a.color) ||
        (a.type === 'pen' && (!Array.isArray(a.points) || a.points.some((p) => !unit(p.x) || !unit(p.y)))) ||
        (['highlight', 'underline', 'strike'].includes(a.type) &&
          (!Array.isArray(a.rects) ||
            a.rects.some((r) => !unit(r.x) || !unit(r.y) || !unit(r.w) || !unit(r.h)))) ||
        (['text', 'note'].includes(a.type) && (typeof a.text !== 'string' || !unit(a.x) || !unit(a.y))) ||
        (a.fontSize !== undefined && (!Number.isFinite(a.fontSize) || a.fontSize <= 0 || a.fontSize > 144)) ||
        (a.strokeWidth !== undefined &&
          (!Number.isFinite(a.strokeWidth) || a.strokeWidth <= 0 || a.strokeWidth > 48)) ||
        (a.type === 'shape' &&
          (!['rectangle', 'circle', 'line', 'arrow'].includes(a.shape) ||
            !a.start ||
            !a.end ||
            ![a.start.x, a.start.y, a.end.x, a.end.y].every(unit))),
    )
  )
    throw new Error('批注数据不完整');
  if (
    data.conversations.some((c) => !liveRoots.has(c.rootId) || typeof c.title !== 'string') ||
    data.messages.some(
      (m) =>
        !conversationIds.has(m.conversationId) ||
        !['user', 'assistant'].includes(m.role) ||
        typeof m.content !== 'string',
    )
  )
    throw new Error('对话引用不完整');
  if (
    data.translations.some(
      (t) => !documentIds.has(t.documentId) || !liveRoots.has(t.rootId) || typeof t.content !== 'string',
    )
  )
    throw new Error('译文数据不完整');
  return data;
}
export async function importArchive(blob, { password = '', restoreSettings = false } = {}) {
  const data = await readArchive(blob, password);
  await mergeSnapshot(data, { restoreSettings, restoreDeleted: true });
  if (restoreSettings) await reloadSettings();
  return data;
}
export async function importFritiaSettings(file) {
  let candidates = [];
  if (/\.json$/i.test(file.name)) candidates = [JSON.parse(await file.text())];
  else {
    let total = 0;
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter(f) {
        total += f.originalSize;
        if (total > MAX_ARCHIVE) throw new Error('存档过大');
        return /\.json$/.test(f.name);
      },
    });
    for (const [path, bytes] of Object.entries(files))
      if (/settings|local.?storage|snapshot|config|manifest/i.test(path)) {
        try {
          candidates.push(JSON.parse(strFromU8(bytes)));
        } catch {}
      }
  }
  function search(value, depth = 0) {
    if (depth > 8 || value == null) return null;
    if (typeof value === 'string') {
      try {
        return search(JSON.parse(value), depth + 1);
      } catch {
        return null;
      }
    }
    if (typeof value !== 'object') return null;
    if (value.chatProviders || (value.baseUrl && value.model)) return value;
    for (const child of Object.values(value)) {
      const found = search(child, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const settings = candidates.map((value) => search(value)).find(Boolean);
  if (!settings) throw new Error('未在文件中找到海姆休息室 API 配置');
  const old = await getSettings();
  await saveSettings({
    chatProviders: [...old.chatProviders, ...(settings.chatProviders || [settings])],
    onboardingDone: true,
  });
}
let syncing = false;
let timer;
function auth(config) {
  return { Authorization: `Basic ${bytesToBase64(strToU8(`${config.username}:${config.password}`))}` };
}
function remoteUrl(config) {
  const path = String(config.path || '/paper-bridge')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
  return `${safeUrl(config.url)}/${path}/archive.zip`;
}
async function dav(config, url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { ...auth(config), ...options.headers },
    signal: AbortSignal.timeout(120000),
  });
}
export async function testWebDav(config) {
  const response = await dav(config, remoteUrl(config), { method: 'PROPFIND', headers: { Depth: '0' } });
  if (![200, 207, 404].includes(response.status)) throw new Error(`WebDAV 连接失败 (${response.status})`);
  return true;
}
export async function syncWebDav(onStatus = () => {}) {
  if (syncing) throw new Error('同步正在进行');
  syncing = true;
  try {
    const config = (await getSettings()).webdav;
    if (!config.url) throw new Error('请先配置 WebDAV');
    const url = remoteUrl(config);
    onStatus('读取云端存档');
    const response = await dav(config, url);
    let etag = null;
    if (response.ok) {
      etag = response.headers.get('etag');
      if (!etag || etag.startsWith('W/'))
        throw new Error('服务端需提供强 ETag，并在 CORS 中暴露 ETag，才能安全同步而不覆盖其他设备的数据。');
      const data = await readArchive(await response.blob());
      await mergeSnapshot(data);
      onStatus('已合并云端内容，上传中');
    } else if (response.status !== 404) throw new Error(`读取云端失败 (${response.status})`);
    if (response.status === 404) {
      const base = safeUrl(config.url);
      let current = base;
      for (const part of String(config.path || '/paper-bridge')
        .split('/')
        .filter(Boolean)) {
        current += `/${encodeURIComponent(part)}`;
        const mkdir = await dav(config, current, { method: 'MKCOL' });
        if (![200, 201, 204, 405].includes(mkdir.status))
          throw new Error(`创建同步目录失败 (${mkdir.status})`);
      }
    }
    const archive = await createArchive({ includeSecrets: false });
    const uploaded = await dav(config, url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/zip',
        ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }),
      },
      body: archive,
    });
    if (uploaded.status === 412) throw new Error('另一台设备刚刚更新了云端；本地合并已保留，请再次同步。');
    if (!uploaded.ok) throw new Error(`上传失败 (${uploaded.status})`);
    await saveSettings({ webdav: { ...(await getSettings()).webdav, lastSyncAt: Date.now() } });
    onStatus('同步完成');
  } finally {
    syncing = false;
  }
}
export function scheduleSync(onStatus, onError) {
  clearInterval(timer);
  getSettings().then((settings) => {
    if (settings.webdav.enabled)
      timer = setInterval(
        () => syncWebDav(onStatus).catch(onError),
        Math.max(5, Number(settings.webdav.intervalMinutes) || 30) * 60000,
      );
  });
}
