import { BASIC_APIS, basicOptions, basicConfigured, basicTranslate } from '../basic-translation.js';
import { getSettings, saveBasicTranslation, flushSettings } from '../settings.js';
import { openExternalWebsite } from '../providers.js';
import { esc, errorMessage } from '../utils.js';
import { icon, button, iconButton, select, bindSelects, toast } from './components.js';
import { OfflineSettings, offlineSettingsMarkup } from './offline-settings.js';

const link = (url, text = url) =>
  `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}${icon('external-link')}</a>`;
const tutorials = {
  baidu: `<ol><li>进入${link('https://api.fanyi.baidu.com/product/12', '百度翻译开放平台')}，注册并登录百度账号后，点击「立即使用」。</li><li>填写认证信息，认证完成后，打开${link('https://fanyi-api.baidu.com/manage/developer', '开发者信息页面')}，查看并复制 APP ID 与密钥。</li><li>将 APP ID 与密钥填写到下方，点击「连接测试」确认连接成功后，点击「保存配置」。</li></ol>`,
  aliyun: `<ol><li>进入${link('https://www.aliyun.com/product/ai/base_alimt', '翻译引擎申请页面')}，注册并登录阿里云账号后，点击「立即开通」。</li><li>在控制台右上角点击用户头像，选择 <b>AccessKey</b>，获取 <b>AccessKey ID</b> 和 <b>AccessKey Secret</b>。</li><li>将 <b>AccessKey ID</b> 和 <b>AccessKey Secret</b> 填写到下方，点击「连接测试」确认连接成功后，点击「保存配置」。</li></ol>`,
  volcengine: `<ol><li>注册、登录并实名认证火山引擎账号后，打开${link('https://console.volcengine.com/common-buy/translate', '翻译服务开通页面')}，点击「立即购买」（开通免费额度无需付费）。</li><li>打开${link('https://console.volcengine.com/iam/keymanage', '访问密钥管理页面')}，点击「创建 Access Key」，经过手机认证后获取 AccessKeyID 和 SecretAccessKey。</li><li>将 AccessKeyID 和 SecretAccessKey 填写到下方，点击「连接测试」确认连接成功后，点击「保存配置」。</li></ol>`,
};

export class BasicSettings {
  constructor(root, draft, saved, onSaved) {
    this.root = root;
    this.draft = draft;
    this.saved = saved;
    this.onSaved = onSaved;
    this.jobs = new Map();
    this.revisions = new Map();
    this.lastQueued = new Map(BASIC_APIS.map(({ id }) => [id, JSON.stringify(draft.providers[id])]));
    this.destroyed = false;
  }
  render() {
    this.root.innerHTML = `<div class="basic-settings"><div class="section-heading"><div><h3>基础翻译功能</h3><p>管理无需调用 LLM 的本地与在线翻译服务。</p></div></div><div class="field basic-default"><span>默认基础翻译模型</span>${select('basic-default', basicOptions(this.saved), this.saved.defaultProvider, '默认基础翻译模型')}</div><p class="note youdao-dictionary-note">机翻模型配置</p><div class="basic-providers">${offlineSettingsMarkup()}${BASIC_APIS.map(
      (p) => {
        const config = this.draft.providers[p.id];
        return `<section class="basic-provider" data-basic-provider="${p.id}"><button type="button" class="basic-summary" aria-expanded="false" aria-controls="basic-body-${p.id}" title="${p.name}（${p.quota}）"><span class="basic-provider-title">${p.name}<small>（${p.quota}）</small></span><span class="basic-status" role="status"></span>${icon('chevron-down')}</button><div class="basic-provider-body" id="basic-body-${p.id}" hidden><h4>${p.name}（${p.quota}）</h4><div class="basic-tutorial">${tutorials[p.id]}</div><form data-basic-form="${p.id}" autocomplete="off"><label class="field"><span>${p.idLabel}</span><input name="keyId" value="${esc(config.keyId)}" required spellcheck="false"></label><div class="field"><label for="basic-secret-${p.id}">${p.secretLabel}</label><div class="input-row api-key-row"><input id="basic-secret-${p.id}" name="secret" type="password" value="${esc(config.secret)}" autocomplete="new-password" required spellcheck="false">${iconButton('show-basic-secret', 'eye', `显示${p.secretLabel}`)}</div></div><p class="basic-test-detail note" aria-live="polite">${p.id === 'baidu' ? '“学术论文”风格使用中英论文领域翻译，其他风格使用通用翻译。' : ''}</p><div class="basic-actions">${button('test-basic', 'refresh-cw', '连接测试')}<button type="submit" class="button primary">${icon('check')}保存配置</button></div></form></div></section>`;
      },
    ).join(
      '',
    )}</div><p class="note basic-quota-note">免费额度、认证条件与超额计费以服务商控制台为准。连接状态表示最近一次测试结果。</p></div>`;
    this.bindDefault();
    this.offline = new OfflineSettings(this.root.querySelector('.offline-provider'), async () => {
      this.saved = (await getSettings()).basicTranslation;
      if (!this.destroyed) this.updateDefault();
    });
    this.root.querySelectorAll('.basic-tutorial a').forEach((anchor) => {
      anchor.onclick = (event) => {
        event.preventDefault();
        openExternalWebsite(anchor.href).catch((error) => toast(errorMessage(error), 'error'));
      };
    });
    for (const p of BASIC_APIS) {
      const section = this.section(p.id),
        form = section.querySelector('form'),
        summary = section.querySelector('.basic-summary');
      summary.onclick = () => {
        const open = summary.getAttribute('aria-expanded') !== 'true';
        summary.setAttribute('aria-expanded', String(open));
        section.querySelector('.basic-provider-body').hidden = !open;
      };
      const eye = section.querySelector('[data-action="show-basic-secret"]');
      eye.setAttribute('aria-pressed', 'false');
      eye.onclick = () => {
        const visible = form.elements.secret.type === 'password';
        form.elements.secret.type = visible ? 'text' : 'password';
        eye.innerHTML = icon(visible ? 'eye-off' : 'eye');
        eye.setAttribute('aria-pressed', String(visible));
        eye.title = `${visible ? '隐藏' : '显示'}${p.secretLabel}`;
        eye.setAttribute('aria-label', eye.title);
      };
      form.oninput = () => {
        this.jobs.get(p.id)?.abort();
        this.jobs.delete(p.id);
        this.capture(p.id);
        this.draft.providers[p.id].connection = null;
        this.revisions.set(p.id, (this.revisions.get(p.id) || 0) + 1);
        this.status(p.id);
        section.querySelector('.basic-test-detail').textContent = '配置已修改，请重新测试。';
        this.save(p.id, true);
      };
      form.addEventListener('change', () => this.save(p.id, true));
      section.querySelector('[data-action="test-basic"]').onclick = () => this.test(p.id);
      form.onsubmit = (event) => {
        event.preventDefault();
        this.save(p.id);
      };
      this.status(p.id);
    }
  }
  section(id) {
    return this.root.querySelector(`[data-basic-provider="${id}"]`);
  }
  capture(id) {
    for (const p of BASIC_APIS.filter((p) => !id || p.id === id)) {
      const form = this.section(p.id)?.querySelector('form');
      if (form)
        Object.assign(this.draft.providers[p.id], {
          keyId: form.elements.keyId.value.trim(),
          secret: form.elements.secret.value.trim(),
        });
    }
  }
  bindDefault() {
    bindSelects(this.root.querySelector('.basic-default'));
    this.root
      .querySelector('[data-select="basic-default"]')
      .addEventListener('valuechange', async (event) => {
        const control = event.currentTarget.querySelector('.select-trigger');
        control.disabled = true;
        try {
          const saved = await saveBasicTranslation((current) => ({
            ...current,
            defaultProvider: event.detail,
          }));
          this.saved = saved.basicTranslation;
          this.draft.defaultProvider = this.saved.defaultProvider;
          this.onSaved();
          toast('默认基础翻译模型已保存');
        } catch (error) {
          toast(errorMessage(error), 'error');
          this.updateDefault();
        } finally {
          control.disabled = false;
        }
      });
  }
  updateDefault() {
    const root = this.root.querySelector('.basic-default');
    if (!root) return;
    const options = basicOptions(this.saved);
    const current = root.querySelector('[data-select="basic-default"]');
    const rendered = [...root.querySelectorAll('[role="option"]')].map((option) => [
      option.dataset.value,
      option.textContent,
    ]);
    if (
      current?.dataset.value === this.saved.defaultProvider &&
      JSON.stringify(rendered) === JSON.stringify(options)
    )
      return;
    root.innerHTML = `<span>默认基础翻译模型</span>${select('basic-default', options, this.saved.defaultProvider, '默认基础翻译模型')}`;
    this.bindDefault();
  }
  status(id, error = false) {
    const section = this.section(id);
    if (!section) return;
    const pending = this.jobs.has(id),
      config = this.draft.providers[id];
    const ok = basicConfigured(config) && config.connection?.ok;
    const status = section.querySelector('.basic-status');
    status.className = `basic-status ${pending ? 'testing' : ok ? 'connected' : error ? 'failed' : ''}`;
    status.innerHTML = `${pending ? '<span class="spinner small"></span>' : '<i></i>'}<span>${pending ? '测试中' : ok ? '可连接' : error ? '连接失败' : basicConfigured(config) ? '未测试' : '未配置'}</span>`;
    status.title = ok
      ? `最近测试：${new Date(config.connection.checkedAt).toLocaleString()}${id === 'baidu' ? ` · ${config.connection.style}` : ''}`
      : '';
    section.querySelector('[data-action="test-basic"]').disabled = pending;
    section.querySelector('[type="submit"]').disabled = pending;
  }
  async test(id) {
    const section = this.section(id),
      form = section.querySelector('form');
    if (this.jobs.has(id) || !form.reportValidity()) return;
    this.capture(id);
    const config = structuredClone(this.draft.providers[id]),
      revision = this.revisions.get(id) || 0;
    const controller = new AbortController();
    this.jobs.set(id, controller);
    this.draft.providers[id].connection = null;
    this.status(id);
    this.save(id, true);
    section.querySelector('.basic-test-detail').textContent = '正在验证翻译连接…';
    try {
      const style = (await getSettings()).translationStyle;
      const result = await basicTranslate('This paper presents a new method.', {
        provider: id,
        config,
        source: 'en',
        target: 'zh-CN',
        style,
        signal: controller.signal,
      });
      if (controller.signal.aborted || revision !== (this.revisions.get(id) || 0)) return;
      this.draft.providers[id].connection = { ok: true, checkedAt: Date.now(), style };
      section.querySelector('.basic-test-detail').textContent = `连接成功：${result}。`;
    } catch (error) {
      if (!controller.signal.aborted) {
        section.querySelector('.basic-test-detail').textContent = errorMessage(error);
        this.draft.providers[id].connection = null;
      }
    } finally {
      if (this.jobs.get(id) === controller) {
        this.jobs.delete(id);
        this.status(id, !this.draft.providers[id].connection);
        this.save(id, true);
      }
    }
  }
  async save(id, silent = false) {
    this.capture(id);
    const button = this.section(id)?.querySelector('[type="submit"]');
    if (button && !silent) button.disabled = true;
    const config = structuredClone(this.draft.providers[id]);
    const snapshot = JSON.stringify(config);
    try {
      let saved;
      if (snapshot === this.lastQueued.get(id)) {
        await flushSettings();
        if (silent) return;
        saved = await getSettings();
      } else {
        this.lastQueued.set(id, snapshot);
        saved = await saveBasicTranslation((current) => ({
          ...current,
          providers: { ...current.providers, [id]: config },
        }));
      }
      this.saved = saved.basicTranslation;
      this.draft.defaultProvider = this.saved.defaultProvider;
      if (!this.destroyed) this.updateDefault();
      if (!silent) {
        this.onSaved();
        toast('基础翻译配置已保存');
      }
    } catch (error) {
      if (this.lastQueued.get(id) === snapshot) this.lastQueued.delete(id);
      toast(errorMessage(error), 'error');
    } finally {
      if (button && !silent) button.disabled = this.jobs.has(id);
    }
  }
  destroy() {
    this.offline?.destroy();
    this.capture();
    this.destroyed = true;
    for (const { id } of BASIC_APIS) this.save(id, true);
    for (const job of this.jobs.values()) job.abort();
    this.jobs.clear();
    return flushSettings();
  }
}
