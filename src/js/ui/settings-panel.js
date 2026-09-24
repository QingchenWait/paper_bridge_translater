import { getSettings, saveSettings, flushSettings, PROVIDERS } from '../settings.js';
import { uid, esc, chooseSaveTarget, saveFile, dateLabel, errorMessage } from '../utils.js';
import { createArchive, importArchive, importFritiaSettings, syncWebDav, testWebDav } from '../archive.js';
import { testProvider, listModels } from '../llm.js';
import { providerKeyUrl, openProviderWebsite, openExternalWebsite } from '../providers.js';
import { BasicSettings } from './basic-settings.js';
import {
  icon,
  providerLogo,
  button,
  iconButton,
  modal,
  select,
  selected,
  bindSelects,
  toast,
  inputDialog,
} from './components.js';
const providerMenu = () =>
  `<div class="custom-select provider-add" data-select="provider-preset" data-value=""><button type="button" class="button select-trigger" data-action="add-provider" aria-label="添加" aria-haspopup="listbox" aria-expanded="false">${icon('plus')}<span>添加</span></button><div class="select-menu" role="listbox" aria-label="选择服务商" hidden>${PROVIDERS.map((p) => `<button type="button" role="option" aria-selected="false" data-value="${p.id}">${providerLogo(p.id)}<span>${p.name}</span></button>`).join('')}</div></div>`;
// Both configuration screens read the live fields, including unsaved endpoints.
function bindProviderActions(form, readProvider, onModelSelected = () => {}) {
  const getKey = form.querySelector('[data-action="get-api-key"]');
  const updateKeyLink = () => {
    getKey.disabled = !providerKeyUrl(form.elements.baseUrl.value);
  };
  form.elements.baseUrl.addEventListener('input', updateKeyLink);
  getKey.onclick = async () => {
    getKey.disabled = true;
    try {
      await openProviderWebsite(form.elements.baseUrl.value);
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      updateKeyLink();
    }
  };
  updateKeyLink();
  const modelButton = form.querySelector('[data-action="list-models"]');
  modelButton.onclick = async () => {
    const provider = readProvider();
    modelButton.disabled = true;
    modelButton.innerHTML = icon('loader-circle', 'icon-spin');
    try {
      const models = await listModels(provider);
      if (
        !form.isConnected ||
        form.elements.baseUrl.value !== provider.baseUrl ||
        form.elements.apiKey.value !== provider.apiKey
      )
        return;
      const field = form.elements.model.closest('.field');
      field.querySelector('.model-list')?.remove();
      const list = document.createElement('div');
      list.className = 'model-list';
      list.innerHTML = models
        .map((m) => `<button type="button" data-model="${esc(m)}">${esc(m)}</button>`)
        .join('');
      list.onclick = (event) => {
        const option = event.target.closest('[data-model]');
        if (!option) return;
        form.elements.model.value = option.dataset.model;
        onModelSelected();
        list.remove();
      };
      field.append(list);
    } catch (error) {
      if (form.isConnected) toast(errorMessage(error), 'error');
    } finally {
      modelButton.disabled = false;
      modelButton.innerHTML = icon('refresh-cw');
    }
  };
}
export async function openSettings(app, tab = 'api') {
  const settings = await getSettings();
  let draft = structuredClone(settings);
  let basicPage;
  let activeProvider = draft.defaultChatProviderId || draft.chatProviders[0]?.id;
  const apiSnapshot = () =>
    JSON.stringify({
      chatProviders: draft.chatProviders,
      defaultChatProviderId: draft.defaultChatProviderId,
    });
  let lastApiSnapshot = apiSnapshot();
  const dialog = modal(
    '设置',
    `<div class="settings-layout"><nav class="settings-nav">${button('settings-api', 'bot', '模型与 API', tab === 'api' ? 'active' : '')}${button('settings-basic', 'languages', '基础翻译功能', tab === 'basic' ? 'active' : '')}${button('settings-archive', 'database', '备份与存档', tab === 'archive' ? 'active' : '')}${button('settings-cloud', 'cloud', '云同步', tab === 'cloud' ? 'active' : '')}${button('settings-about', 'circle-help', '关于与帮助', tab === 'about' ? 'active' : '')}</nav><div id="settings-content"></div></div>`,
    {
      wide: true,
      onClose: () => {
        Promise.all([persistApi(), basicPage?.destroy()])
          .then(() => app.refreshAssistant())
          .catch((error) => toast(errorMessage(error), 'error'));
      },
    },
  );
  const content = dialog.element.querySelector('#settings-content');
  const run = (fn) => async (event) => {
    const el = event?.currentTarget;
    if (el) el.disabled = true;
    try {
      await fn();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      if (el) el.disabled = false;
    }
  };
  const capture = () => {
    basicPage?.capture();
    const form = content.querySelector('#provider-form');
    if (!form) return;
    const data = Object.fromEntries(new FormData(form));
    const provider = draft.chatProviders.find((p) => p.id === activeProvider);
    if (provider)
      Object.assign(provider, data, {
        protocol: form.querySelector('[data-select="api-protocol"]')?.dataset.value || provider.protocol,
        pdfInput: form.elements.pdfInput.checked,
        pdfOutput: form.elements.pdfOutput.checked,
      });
  };
  const persistApi = () => {
    capture();
    content.querySelectorAll('[data-provider]').forEach((chip) => {
      const provider = draft.chatProviders.find((p) => p.id === chip.dataset.provider);
      const label = chip.querySelector('.provider-label');
      if (label && provider) label.textContent = provider.name;
    });
    const snapshot = apiSnapshot();
    if (snapshot === lastApiSnapshot) return flushSettings();
    lastApiSnapshot = snapshot;
    return saveSettings({
      chatProviders: draft.chatProviders,
      defaultChatProviderId: draft.defaultChatProviderId,
    }).catch((error) => {
      if (lastApiSnapshot === snapshot) lastApiSnapshot = null;
      throw error;
    });
  };
  const autoSaveApi = () => persistApi().catch((error) => toast(errorMessage(error), 'error'));
  const render = () => {
    basicPage?.destroy().catch(() => {}); // Each autosave already reports a failed write.
    basicPage = null;
    dialog.element
      .querySelectorAll('.settings-nav button')
      .forEach((btn) => btn.classList.toggle('active', btn.dataset.action === `settings-${tab}`));
    if (tab === 'api') {
      const provider = draft.chatProviders.find((p) => p.id === activeProvider);
      content.innerHTML = `<div class="section-heading"><div><h3>连接你的 AI</h3><p>保留多组配置，随时切换适合的模型。</p></div><div class="api-heading-actions">${button('save-current-settings', 'check', '保存当前设置')}${providerMenu()}</div></div><div class="provider-chips">${draft.chatProviders.map((p) => `<button class="provider-chip ${p.id === activeProvider ? 'active' : ''}" data-provider="${esc(p.id)}">${icon('bot')}<span class="provider-label">${esc(p.name)}</span>${p.id === draft.defaultChatProviderId ? '<span class="badge">默认</span>' : ''}</button>`).join('')}</div>${
        provider
          ? `<form id="provider-form" class="settings-form"><label class="field"><span>配置名称</span><input name="name" value="${esc(provider.name)}" required></label><label class="field"><span>Base URL</span><input name="baseUrl" type="url" placeholder="https://api.example.com/v1" value="${esc(provider.baseUrl)}" required></label><div class="field"><label for="provider-api-key">API Key</label><div class="input-row api-key-row"><input id="provider-api-key" name="apiKey" type="password" value="${esc(provider.apiKey)}" placeholder="本地模型可留空" autocomplete="new-password">${iconButton('toggle-api-key', 'eye', '显示 API Key')}${button('get-api-key', 'external-link', '获取')}</div></div><label class="field"><span>模型名称</span><div class="input-row"><input name="model" value="${esc(provider.model)}" placeholder="填写服务商提供的模型 ID" required>${iconButton('list-models', 'refresh-cw', '获取模型列表')}</div></label><div class="field"><span>接口协议</span>${select(
              'api-protocol',
              [
                ['chat', 'Chat Completions 兼容接口'],
                ['responses', 'Responses API'],
              ],
              provider.protocol,
              '接口协议',
            )}</div><label class="toggle-row"><span>支持 PDF 文件输入<small>需模型和 API 同时支持文件内容</small></span><input name="pdfInput" type="checkbox" ${provider.pdfInput ? 'checked' : ''}><span class="switch"></span></label><label class="toggle-row"><span>支持模型生成 PDF<small>Responses + Code Interpreter 文件输出</small></span><input name="pdfOutput" type="checkbox" ${provider.pdfOutput ? 'checked' : ''}><span class="switch"></span></label><div class="form-actions">${button('delete-provider', 'trash-2', '移除', 'danger')}${button('test-provider', 'refresh-cw', '测试连接')}${button('default-provider', 'check', '设为默认')}</div></form>`
          : `<div class="inline-empty">${icon('key-round')}<p>添加一个 API 配置，解锁全文翻译与 AI 问答。</p><p class="muted">在线词典与句子翻译无需配置。</p></div>`
      }<div class="settings-footer">${button('import-fritia', 'download', '迁移海姆休息室配置', 'subtle')}${button('save-settings', 'check', '保存设置', 'primary')}</div>`;
      content.querySelectorAll('[data-provider]').forEach(
        (btn) =>
          (btn.onclick = () => {
            capture();
            autoSaveApi();
            activeProvider = btn.dataset.provider;
            render();
          }),
      );
      content.querySelector('[data-select="provider-preset"]').addEventListener('valuechange', (event) => {
        capture();
        const preset = PROVIDERS.find((p) => p.id === event.detail);
        if (!preset) return;
        const id = uid();
        draft.chatProviders.push({
          ...preset,
          id,
          apiKey: '',
        });
        activeProvider = id;
        if (!draft.defaultChatProviderId) draft.defaultChatProviderId = id;
        render();
        autoSaveApi();
      });
      const form = content.querySelector('#provider-form');
      if (form) {
        form.addEventListener('input', autoSaveApi);
        form.addEventListener('change', autoSaveApi);
        form.addEventListener('valuechange', autoSaveApi);
        const eye = form.querySelector('[data-action="toggle-api-key"]');
        eye.setAttribute('aria-pressed', 'false');
        eye.onclick = () => {
          const visible = form.elements.apiKey.type === 'password';
          form.elements.apiKey.type = visible ? 'text' : 'password';
          eye.innerHTML = icon(visible ? 'eye-off' : 'eye');
          eye.setAttribute('aria-pressed', String(visible));
          eye.title = visible ? '隐藏 API Key' : '显示 API Key';
          eye.setAttribute('aria-label', eye.title);
        };
        bindProviderActions(
          form,
          () => {
            capture();
            return { ...draft.chatProviders.find((p) => p.id === activeProvider) };
          },
          autoSaveApi,
        );
      }
      content.querySelector('[data-action="delete-provider"]')?.addEventListener('click', () => {
        draft.chatProviders = draft.chatProviders.filter((p) => p.id !== activeProvider);
        if (draft.defaultChatProviderId === activeProvider)
          draft.defaultChatProviderId = draft.chatProviders[0]?.id || '';
        activeProvider = draft.chatProviders[0]?.id;
        render();
        autoSaveApi();
      });
      content.querySelector('[data-action="default-provider"]')?.addEventListener('click', () => {
        capture();
        draft.defaultChatProviderId = activeProvider;
        render();
        autoSaveApi();
      });
      content.querySelector('[data-action="test-provider"]')?.addEventListener(
        'click',
        run(async () => {
          capture();
          await testProvider(
            draft.chatProviders.find((p) => p.id === activeProvider),
            AbortSignal.timeout(45000),
          );
          toast('连接成功，模型已响应');
        }),
      );
      const saveApi = async (close) => {
        await persistApi();
        toast('API 配置已保存');
        if (close) dialog.close();
        app.refreshAssistant();
      };
      content.querySelector('[data-action="save-current-settings"]').onclick = run(() => saveApi(false));
      content.querySelector('[data-action="save-settings"]').onclick = run(() => saveApi(true));
      content.querySelector('[data-action="import-fritia"]').onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip,.json';
        input.onchange = async () => {
          try {
            await importFritiaSettings(input.files[0]);
            toast('配置已合并，原项目未作修改');
            dialog.close();
            openSettings(app);
          } catch (e) {
            toast(e.message, 'error');
          }
        };
        input.click();
      };
    } else if (tab === 'basic') {
      basicPage = new BasicSettings(
        content,
        draft.basicTranslation,
        structuredClone(settings.basicTranslation),
        () => {
          app.refreshAssistant();
        },
      );
      basicPage.render();
      getSettings().then((latest) => {
        if (basicPage && tab === 'basic') {
          basicPage.saved = latest.basicTranslation;
          basicPage.updateDefault();
        }
      });
    } else if (tab === 'archive') {
      content.innerHTML = `<h3>把阅读进度一起带走</h3><p class="muted">备份包含全部 PDF、批注、全文译文、对话和配置。导入会合并现有数据，冲突版本保留恢复副本。</p><div class="archive-card">${icon('database')}<div><h4>本地完整备份</h4><p>可选择密码加密后导出</p></div></div><label class="field"><span>备份密码（可选）</span><input id="backup-password" type="password" placeholder="留空导出普通 ZIP" autocomplete="new-password"></label><label class="toggle-row"><span>包含 API Key 和云同步凭据<small>未加密的 ZIP 可被直接读取</small></span><input id="include-secrets" type="checkbox"><span class="switch"></span></label><div class="form-actions">${button('export-archive', 'download', '导出存档', 'primary')}${button('import-archive', 'upload', '导入并合并')}</div><p class="note">文档保存在当前浏览器。清理站点数据或使用隐私窗口会影响本地存储，请保留备份。</p>`;
      content.querySelector('[data-action="export-archive"]').onclick = run(async () => {
        const password = content.querySelector('#backup-password').value;
        const filename = `paper-bridge-${new Date().toISOString().slice(0, 10)}.${password ? 'pbak' : 'zip'}`;
        const target = await chooseSaveTarget(filename);
        if (!target) return;
        const blob = await createArchive({
          password,
          includeSecrets: content.querySelector('#include-secrets').checked,
        });
        await saveFile(blob, filename, { target });
        toast('备份已生成');
      });
      const restore = document.createElement('label');
      restore.className = 'toggle-row';
      restore.innerHTML =
        '<span>导入时恢复设置并合并 API 配置<small>关闭则只合并文档、批注、译文及对话</small></span><input id="restore-settings" type="checkbox" checked><span class="switch"></span>';
      content.querySelector('.form-actions').before(restore);
      content.querySelector('[data-action="import-archive"]').onclick = () => {
        const restoreSettings = content.querySelector('#restore-settings').checked;
        const input = document.getElementById('archive-input');
        input.value = '';
        input.onchange = async () => {
          const file = input.files[0];
          if (!file) return;
          let password = '';
          if (/\.pbak$/i.test(file.name)) {
            password = await inputDialog('解锁存档', { password: true, label: '备份密码' });
            if (password === null) return;
          }
          try {
            await importArchive(file, { password, restoreSettings });
            toast('存档及所选设置已合并恢复');
            dialog.close();
            await app.reload();
          } catch (e) {
            toast(e.message, 'error');
          }
        };
        input.click();
      };
    } else if (tab === 'cloud') {
      const c = draft.webdav;
      content.innerHTML = `<h3>阅读在设备间延续</h3><p class="muted">使用支持浏览器 CORS 与 ETag 的 WebDAV 服务。PDF、批注、译文和对话会合并同步。</p><form id="cloud-form" class="settings-form"><label class="field"><span>WebDAV 服务地址</span><input name="url" type="url" value="${esc(c.url)}" placeholder="https://dav.example.com" required></label><div class="field-pair"><label class="field"><span>用户名</span><input name="username" value="${esc(c.username)}" autocomplete="username"></label><label class="field"><span>密码 / 应用密码</span><input name="password" type="password" value="${esc(c.password)}" autocomplete="new-password"></label></div><label class="field"><span>同步目录</span><input name="path" value="${esc(c.path)}"></label><label class="toggle-row"><span>自动同步<small>每 30 分钟在应用打开期间同步</small></span><input name="enabled" type="checkbox" ${c.enabled ? 'checked' : ''}><span class="switch"></span></label><p class="note" id="sync-status">${c.lastSyncAt ? `上次同步：${dateLabel(c.lastSyncAt)}` : '尚未同步'}</p><div class="form-actions">${button('test-cloud', 'refresh-cw', '测试连接')}${button('save-cloud', 'check', '保存')}${button('sync-cloud', 'cloud', '立即同步', 'primary')}</div></form>`;
      const captureCloud = async () => {
        const form = content.querySelector('#cloud-form');
        const config = {
          ...draft.webdav,
          ...Object.fromEntries(new FormData(form)),
          enabled: form.elements.enabled.checked,
        };
        draft.webdav = config;
        await saveSettings({ webdav: config });
        return config;
      };
      content.querySelector('[data-action="save-cloud"]').onclick = run(async () => {
        await captureCloud();
        toast('云同步设置已保存');
      });
      content.querySelector('[data-action="test-cloud"]').onclick = run(async () => {
        await testWebDav(await captureCloud());
        toast('WebDAV 连接正常');
      });
      content.querySelector('[data-action="sync-cloud"]').onclick = run(async () => {
        await captureCloud();
        await syncWebDav((message) => {
          const status = content.querySelector('#sync-status');
          if (status) status.textContent = message;
        });
        await app.reload();
        toast('云端和本地数据已合并同步');
      });
    } else {
      content.innerHTML = `<h3>纸间 · 文献翻译 & AI 分析 <span class="badge">0.3.3</span></h3><p>青尘工作室出品 :: LLM 划词翻译 | PDF 标注编辑 | AI 文献问答</p><div class="help-list"><p><b>选词与翻译</b><br>在 PDF 上拖选文字，单词进入在线词典，多词句子进入翻译。点击工具栏按钮可添加批注。</p><p><b>全文翻译</b><br>文件输入需接口支持。普通模型会接收提取后的完整文字；扫描件需要支持 PDF 的视觉模型。模型原生 PDF 需支持代码执行与文件输出，也可选择本地排版（视觉 PDF，无文字层）。</p><p><b>快捷键</b><br>Ctrl / ⌘ + O 打开文档 · Ctrl / ⌘ + Z 撤销批注 · Ctrl / ⌘ + Shift + Z 重做 · Esc 关闭菜单</p><p><b>数据与连接</b><br>文档默认只存本机。翻译或问答时将选定文本 / 文档发送给所选服务商。在线词典使用 Free Dictionary、Wiktionary，并支持 FreeDictionaryAPI、3325 备选及客户端有道；英文详细释义通过基础翻译 API 转成中文。基础翻译支持 MyMemory、Google 和三家云 API，可在“基础翻译功能”中配置，存在网络与额度限制。</p><p><b>开源致谢</b><br>PDF.js · pdf-lib · KaTeX · Lucide · Fluent Emoji · Noto Sans<br>设置及存档流程继承海姆休息室（https://fritia.online）。</p></div>`;
    }
    bindSelects(content);
  };
  dialog.element.querySelectorAll('.settings-nav button').forEach(
    (btn) =>
      (btn.onclick = () => {
        capture();
        autoSaveApi();
        tab = btn.dataset.action.replace('settings-', '');
        render();
      }),
  );
  render();
}
export async function onboarding(app) {
  if ((await getSettings()).hideOnboarding) return;
  let step = 0;
  let preset = PROVIDERS[0];
  const dialog = modal(
    '欢迎来到纸间',
    `<div id="onboarding-content"></div><label class="toggle-row onboarding-preference"><span>不再显示</span><input name="hideOnboarding" type="checkbox"><span class="switch"></span></label>`,
    {
      onClose: () => {
        preferenceSave
          .then(() => saveSettings({ onboardingDone: true }))
          .catch((error) => toast(errorMessage(error), 'error'));
      },
    },
  );
  dialog.element.classList.add('onboarding-modal');
  const root = dialog.element.querySelector('#onboarding-content');
  const preference = dialog.element.querySelector('[name="hideOnboarding"]');
  let preferenceSave = Promise.resolve();
  preference.onchange = () => {
    const hideOnboarding = preference.checked;
    preferenceSave = preferenceSave
      .then(() => saveSettings({ hideOnboarding }))
      .catch((error) => {
        preference.checked = false;
        toast(errorMessage(error), 'error');
      });
  };
  const render = () => {
    if (step === 0)
      root.innerHTML = `<div class="welcome"><div class="welcome-symbol">${icon('book-open')}</div><p class="eyebrow">READ BEYOND LANGUAGE</p><h2>纸间 · 文献翻译 &amp; AI 分析</h2><p>LLM 划词翻译 | PDF 标注编辑 | AI 文献问答<br>青尘工作室　<a href="https://space.bilibili.com/385556208" target="_blank" rel="noopener noreferrer" data-author-link>@CyanDust_青尘</a>　出品</p><div class="welcome-features"><span>${icon('shield-check')}文档本地保存</span><span>${icon('languages')}即开即用词典</span></div></div><div class="onboarding-actions welcome-actions">${button('skip', 'arrow-up-right', '直接进入 APP')}${button('next', 'sparkles', '配置我的 AI', 'primary')}</div>`;
    else
      root.innerHTML = `<div class="step-label">01 选择服务商 <span>→</span> 02 填写连接 <span>→</span> 03 开始阅读</div><div class="preset-grid">${PROVIDERS.map((p) => `<button class="preset ${p.id === preset.id ? 'active' : ''}" data-preset="${p.id}">${providerLogo(p.id)}<span>${p.name}</span></button>`).join('')}</div><form id="onboarding-form"><label class="field"><span>Base URL</span><input name="baseUrl" type="url" value="${esc(preset.baseUrl)}" required></label><label class="field"><span>API Key</span><div class="input-row api-key-row"><input name="apiKey" type="password" placeholder="从服务商控制台获取，本地模型可留空" autocomplete="new-password">${button('get-api-key', 'external-link', '获取')}</div></label><label class="field"><span>模型名称</span><div class="input-row"><input name="model" value="${esc(preset.model)}" placeholder="填写服务商提供的模型 ID" required>${iconButton('list-models', 'refresh-cw', '获取模型列表')}</div></label><p class="note" id="onboarding-status">之后可在设置中添加更多 API、调整文件输入能力。</p><div class="onboarding-actions">${button('back', 'arrow-left', '返回')}${button('test', 'refresh-cw', '测试连接')}<button type="submit" class="button primary">${icon('check')}保存并开始</button></div></form>`;
    root.querySelector('[data-author-link]')?.addEventListener('click', (event) => {
      event.preventDefault();
      openExternalWebsite(event.currentTarget.href).catch((error) => toast(errorMessage(error), 'error'));
    });
    root.querySelector('[data-action="skip"]')?.addEventListener('click', async () => {
      await preferenceSave;
      await saveSettings({ onboardingDone: true, hideOnboarding: preference.checked });
      dialog.close();
    });
    root.querySelector('[data-action="next"]')?.addEventListener('click', () => {
      step = 1;
      render();
    });
    root.querySelector('[data-action="back"]')?.addEventListener('click', () => {
      step = 0;
      render();
    });
    root.querySelectorAll('[data-preset]').forEach(
      (btn) =>
        (btn.onclick = () => {
          preset = PROVIDERS.find((p) => p.id === btn.dataset.preset);
          render();
        }),
    );
    const provider = () => ({
      ...preset,
      ...Object.fromEntries(new FormData(root.querySelector('form'))),
      id: uid(),
    });
    const form = root.querySelector('form');
    if (form) bindProviderActions(form, provider);
    root.querySelector('[data-action="test"]')?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      const status = root.querySelector('#onboarding-status');
      status.textContent = '正在测试连接…';
      try {
        await testProvider(provider(), AbortSignal.timeout(45000));
        status.textContent = '连接成功，可以开始阅读。';
      } catch (e) {
        status.textContent = errorMessage(e);
      } finally {
        root.querySelector('[data-action="test"]').disabled = false;
      }
    });
    root.querySelector('form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const p = provider();
        await preferenceSave;
        const old = await getSettings();
        await saveSettings({
          chatProviders: [...old.chatProviders, p],
          defaultChatProviderId: p.id,
          translationEngine: 'llm',
          translationProviderId: p.id,
          onboardingDone: true,
          hideOnboarding: preference.checked,
        });
        dialog.close();
        app.refreshAssistant();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  };
  render();
}
