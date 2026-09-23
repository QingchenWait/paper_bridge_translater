export const uid = () => crypto.randomUUID();
export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const sizeLabel = (bytes) =>
  bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
export const dateLabel = (time) =>
  new Date(time).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function chooseSaveTarget(filename, { directory = false } = {}) {
  const picker = directory ? window.showDirectoryPicker : window.showSaveFilePicker;
  if (typeof picker !== 'function') return { defaultDownload: true };
  try {
    return await picker.call(
      window,
      directory
        ? { mode: 'readwrite' }
        : { suggestedName: String(filename).replace(/[\\/<>:"|?*\u0000-\u001f]/g, '_') },
    );
  } catch (error) {
    if (error.name === 'AbortError') return null;
    if (error.name === 'NotSupportedError') return { defaultDownload: true };
    if (error.name === 'SecurityError')
      throw new Error('未获得选择保存位置的点击授权，请重新点击下载按钮；文件未下载。');
    throw error;
  }
}
export async function saveFile(blob, filename, { target } = {}) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error('文件内容为空，未执行保存');
  const handle = target === undefined ? await chooseSaveTarget(filename) : target;
  if (!handle) return;
  if (handle.defaultDownload) {
    download(blob, filename);
    return;
  }
  let writer;
  try {
    writer = await handle.createWritable();
    await writer.write(blob);
    await writer.close();
  } catch (error) {
    await writer?.abort().catch(() => {});
    throw new Error(`文件保存失败：${error.message}`);
  }
  return;
}
export async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const blobFingerprints = new WeakMap();
export function md5Blob(blob) {
  if (!blobFingerprints.has(blob)) {
    const pending = (async () => {
      const { md5 } = await import('@noble/hashes/legacy.js');
      const hash = md5.create(),
        chunkSize = 2 * 1024 * 1024;
      for (let offset = 0; offset < blob.size; offset += chunkSize)
        hash.update(new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer()));
      return [...hash.digest()].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    })();
    blobFingerprints.set(blob, pending);
    pending.catch(() => blobFingerprints.delete(blob));
  }
  return blobFingerprints.get(blob);
}
export function bytesToBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export function safeUrl(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('请输入有效的 HTTP(S) 地址');
  return url.href.replace(/\/$/, '');
}
export function errorMessage(error) {
  if (error.name === 'TimeoutError') return '在线服务响应超时，请稍后重试或选择其他服务。';
  if (error.name === 'AbortError') return '已停止，已生成的内容已保留';
  if (/fetch|network/i.test(error.message))
    return '网络连接失败，请检查网络及服务商的浏览器跨域（CORS）支持。';
  return error.message || String(error);
}
