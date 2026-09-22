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
export async function saveFile(blob, filename) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error('文件内容为空，未执行保存');
  if (window.showSaveFilePicker) {
    let handle;
    try {
      handle = await window.showSaveFilePicker({ suggestedName: filename });
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (!['SecurityError', 'NotSupportedError'].includes(error.name)) throw error;
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
    return; // Never start a second download after opening a save picker.
  }
  download(blob, filename);
}
export async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
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
