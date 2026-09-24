export function parsePdfLink(value, rename = '') {
  const input = String(value || '').trim();
  if (!input) throw new Error('请填写 PDF 文件链接');
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('请输入完整的 HTTP(S) PDF 文件链接');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('请输入不包含账号密码的 HTTP(S) PDF 文件链接');
  // A PDF endpoint may use an ID, query string or redirect instead of .pdf.
  // Import validates the returned bytes with PDF.js before anything is stored.
  let stem = String(rename || '')
    .trim()
    .replace(/(?:\.pdf)+$/i, '');
  if (stem && /[\\/<>:"|?*\u0000-\u001f]/.test(stem))
    throw new Error('重命名名称不能包含路径或文件名特殊字符');
  if (!stem) {
    let name = url.pathname.split('/').filter(Boolean).at(-1) || '';
    try {
      name = decodeURIComponent(name);
    } catch {}
    stem = name
      .replace(/\.pdf$/i, '')
      .replace(/[\\/<>:"|?*\u0000-\u001f]/g, '_')
      .trim();
  }
  if (!stem || /^[. ]+$/.test(stem)) stem = '文档';
  return { url: url.href, filename: `${stem}.pdf` };
}
