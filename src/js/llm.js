import { bytesToBase64, safeUrl } from './utils.js';
export function headers(provider) {
  const value = { 'Content-Type': 'application/json' };
  if (provider.apiKey) value.Authorization = `Bearer ${provider.apiKey}`;
  if (/xiaomimimo\.com/.test(provider.baseUrl) && provider.apiKey) value['api-key'] = provider.apiKey;
  return value;
}
export async function* sseEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      // Normalize CRLF only when a complete line is available (including split network chunks).
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data) yield data;
      }
      if (done) break;
    }
    const tail = buffer
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}
export function extractText(json) {
  return (
    json.choices?.[0]?.message?.content ||
    json.output_text ||
    json.output
      ?.flatMap((item) => item.content || [])
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text)
      .join('') ||
    ''
  );
}
export async function requestLlm({
  provider,
  messages,
  pdf,
  signal,
  onDelta = async () => {},
  onStage = () => {},
  pdfOutput = false,
}) {
  const base = safeUrl(provider.baseUrl);
  let requestMessages = structuredClone(messages);
  onStage(pdf && provider.pdfInput ? 'PDF 上传中' : 'LLM 分析中');
  let body;
  if (provider.protocol === 'responses') {
    const input = requestMessages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));
    if (pdf && provider.pdfInput) {
      const content = [
        {
          type: 'input_file',
          filename: pdf.name,
          file_data: `data:application/pdf;base64,${bytesToBase64(new Uint8Array(await pdf.blob.arrayBuffer()))}`,
        },
        {
          type: 'input_text',
          text: typeof input[0].content === 'string' ? input[0].content : JSON.stringify(input[0].content),
        },
      ];
      input[0].content = content;
    }
    body = {
      model: provider.model,
      instructions: requestMessages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n'),
      input,
      stream: !pdfOutput,
      store: false,
    };
    if (pdfOutput) body.tools = [{ type: 'code_interpreter', container: { type: 'auto' } }];
  } else {
    if (pdf && provider.pdfInput) {
      const firstUser = requestMessages.find((m) => m.role === 'user');
      firstUser.content = [
        {
          type: 'file',
          file: {
            filename: pdf.name,
            file_data: `data:application/pdf;base64,${bytesToBase64(new Uint8Array(await pdf.blob.arrayBuffer()))}`,
          },
        },
        { type: 'text', text: firstUser.content },
      ];
    }
    body = { model: provider.model, messages: requestMessages, stream: true };
  }
  const endpoint = `${base}/${provider.protocol === 'responses' ? 'responses' : 'chat/completions'}`;
  const send = (payload) =>
    fetch(endpoint, {
      method: 'POST',
      headers: headers(provider),
      body: JSON.stringify(payload),
      signal,
    });
  let response = await send(body);
  if (response.status === 400 && pdf && provider.pdfInput && provider.protocol !== 'responses') {
    const errorBody = await response.clone().text();
    // Some Chat-compatible gateways validate flattened file parts instead of
    // OpenAI's nested `file` object. Retry only this specific schema rejection.
    if (/file must have (?:a )?file_id or file_data/i.test(errorBody)) {
      const compatible = {
        ...body,
        messages: body.messages.map((message) => ({
          ...message,
          content: Array.isArray(message.content)
            ? message.content.map((part) =>
                part.type === 'file' && part.file ? { type: 'file', ...part.file } : part,
              )
            : message.content,
        })),
      };
      response = await send(compatible);
    }
  }
  onStage('LLM 分析中');
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`API 请求失败 (${response.status})：${detail}`);
  }
  if (/application\/pdf/i.test(response.headers.get('content-type') || ''))
    return { text: '', pdf: await response.blob() };
  let output = '';
  let completed = false;
  if (/json/.test(response.headers.get('content-type') || '')) {
    const json = await response.json();
    if (json.error || json.status === 'failed') throw new Error(json.error?.message || '模型响应失败');
    output = extractText(json);
    await onDelta(output, output);
    if (json.status === 'incomplete' || json.choices?.[0]?.finish_reason === 'length')
      throw new Error('模型输出达到服务端限制，已保留部分结果；可更换长输出模型继续。');
    if (pdfOutput) {
      const annotations =
        json.output?.flatMap((item) => item.content || []).flatMap((c) => c.annotations || []) || [];
      const file = annotations.find(
        (a) => a.type === 'container_file_citation' && /\.pdf$/i.test(a.filename),
      );
      if (file) {
        const resource = await fetch(
          `${base}/containers/${encodeURIComponent(file.container_id)}/files/${encodeURIComponent(file.file_id)}/content`,
          { headers: headers(provider), signal },
        );
        if (!resource.ok) throw new Error(`读取模型生成 PDF 失败 (${resource.status})`);
        return { text: output, pdf: await resource.blob() };
      }
      throw new Error(
        '该接口未返回可下载的 PDF 文件。请选择“本地排版生成 PDF”，或使用支持代码执行和文件输出的 Responses 接口。',
      );
    }
    return { text: output };
  }
  if (!response.body) throw new Error('API 返回了空响应');
  for await (const data of sseEvents(response.body)) {
    if (data === '[DONE]') {
      completed = true;
      continue;
    }
    let json;
    try {
      json = JSON.parse(data);
    } catch {
      throw new Error('流式响应包含无效 JSON，已保留先前内容');
    }
    if (json.error || /response\.(failed|incomplete)/.test(json.type || ''))
      throw new Error(
        json.error?.message || json.response?.error?.message || '模型输出不完整，已保留已有内容',
      );
    if (json.type === 'response.completed') completed = true;
    if (json.choices?.[0]?.finish_reason === 'length')
      throw new Error('模型输出达到服务端长度限制，已保留已有内容');
    if (json.choices?.[0]?.finish_reason && json.choices[0].finish_reason !== 'length') completed = true;
    const chunk =
      json.choices?.[0]?.delta?.content || (json.type === 'response.output_text.delta' ? json.delta : '');
    if (chunk) {
      output += chunk;
      onStage('结果转换中');
      await onDelta(chunk, output);
    }
  }
  if (!completed) throw new Error('连接在完成标记之前中断，已保留收到的内容');
  if (!output.trim()) throw new Error('模型未返回文本，请检查模型能力和 API 配置');
  return { text: output };
}
export async function testProvider(provider, signal) {
  return requestLlm({ provider, messages: [{ role: 'user', content: 'Reply with OK.' }], signal });
}
export async function listModels(provider) {
  const response = await fetch(`${safeUrl(provider.baseUrl)}/models`, {
    headers: headers(provider),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`获取模型列表失败 (${response.status})`);
  return (await response.json()).data?.map((model) => model.id) || [];
}
