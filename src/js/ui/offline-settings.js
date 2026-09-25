import { OFFLINE_MODELS, offlineInstalled } from '../offline/catalog.js';
import {
  manageOfflineModel,
  cancelOfflineModel,
  offlineJob,
  subscribeOffline,
  refreshOfflineModels,
} from '../offline-translation.js';
import { getSettings, saveBasicTranslation } from '../settings.js';
import { esc, errorMessage } from '../utils.js';
import { icon, providerLogo, toast } from './components.js';

export const offlineSettingsMarkup = () =>
  `<section class="basic-provider offline-provider"><button type="button" class="basic-summary" aria-expanded="false" aria-controls="offline-models-body"><span class="basic-provider-title">本地离线翻译模型</span>${icon('chevron-down')}</button><div id="offline-models-body" class="basic-provider-body" hidden><div class="offline-models"></div><p class="note">本地翻译模型，无需联网。Lite、Plus 支持英文 → 中文翻译；Pro 支持多语种互译，需要更多内存。</p><p class="note">Plus、Pro 请分别导入清单对应版本的六个 JSON/ONNX 文件（支持 .gz）。</p><input class="offline-import" type="file" multiple accept=".json,.onnx,.gz" hidden></div></section>`;

export class OfflineSettings {
  constructor(root, onChanged) {
    this.root = root;
    this.onChanged = onChanged;
    const summary = root.querySelector('.basic-summary');
    summary.onclick = () => {
      const open = summary.getAttribute('aria-expanded') !== 'true';
      summary.setAttribute('aria-expanded', String(open));
      root.querySelector('.basic-provider-body').hidden = !open;
    };
    this.unsubscribe = subscribeOffline(() => {
      this.render();
      onChanged();
    });
    this.render();
    refreshOfflineModels().catch((error) => toast(errorMessage(error), 'error'));
    root.querySelector('.offline-import').onchange = (event) => {
      if (event.target.files.length) this.run(this.importId, 'import', [...event.target.files]);
      event.target.value = '';
    };
    root.querySelector('.offline-models').onclick = (event) => {
      const button = event.target.closest('[data-offline-action]');
      if (!button || button.disabled) return;
      const { modelId, offlineAction } = button.dataset;
      if (offlineAction === 'cancel')
        cancelOfflineModel(modelId).catch((error) => toast(errorMessage(error), 'error'));
      else if (offlineAction === 'import') {
        this.importId = modelId;
        root.querySelector('.offline-import').click();
      } else this.run(modelId, offlineAction);
    };
  }
  render() {
    this.root.querySelector('.offline-models').innerHTML = OFFLINE_MODELS.map((model) => {
      const job = offlineJob(model.id),
        installed = offlineInstalled(model.id);
      const ratio = job?.total ? Math.min(100, Math.round((job.bytes / job.total) * 100)) : 0;
      const status = job
        ? job.phase === 'deleting'
          ? '正在删除…'
          : job.phase === 'cancelling'
            ? '正在取消…'
            : `准备中 ${ratio}%`
        : model.bundled
          ? '已预置 · 不可删除'
          : installed
            ? '已下载'
            : '未下载';
      const action = installed ? 'delete' : 'install';
      return `<div class="offline-model" data-offline-model="${model.id}"><div class="offline-model-info"><strong>${providerLogo('local')}${model.name}</strong><span>${model.description}</span><small>模型约 ${(model.bytes / 1024 / 1024).toFixed(1)} MiB · <span role="status">${esc(status)}</span></small>${job ? `<div class="offline-progress" role="progressbar" aria-label="${model.name}下载进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${ratio}"><i style="width:${ratio}%"></i></div>` : ''}</div><div class="offline-model-actions"><button type="button" class="button ${installed && !model.bundled ? 'offline-delete' : ''}" data-model-id="${model.id}" data-offline-action="${action}" ${job || model.bundled ? 'disabled' : ''}>${icon(model.bundled ? 'shield-check' : installed ? 'trash-2' : 'download')}<span>${model.bundled ? '已预置' : installed ? '删除' : '下载'}</span></button>${job?.phase === 'download' && !model.bundled ? `<button type="button" class="button" data-model-id="${model.id}" data-offline-action="cancel">${icon('x')}<span>取消</span></button>` : ''}${!installed && !job ? `<button type="button" class="button" data-model-id="${model.id}" data-offline-action="import" ${job ? 'disabled' : ''}>${icon('upload')}<span>导入</span></button>` : ''}</div></div>`;
    }).join('');
  }
  async run(id, action, files) {
    try {
      await manageOfflineModel(id, action, files);
      if (action === 'delete' && (await getSettings()).basicTranslation.defaultProvider === id)
        await saveBasicTranslation((current) => ({ ...current, defaultProvider: 'offline-lite' }));
      this.onChanged();
      toast(action === 'delete' ? '离线模型已删除' : '离线模型准备完成');
    } catch (error) {
      if (error.name !== 'AbortError') toast(errorMessage(error), 'error');
    }
  }
  destroy() {
    this.unsubscribe();
  }
}
