# 项目结构与开发逻辑

适用版本：0.4.0。入口为 `index.html` → `src/js/main.js`，浏览器标题为“纸间 · 文献翻译”。这是静态前端工程，**没有 `main.py`，也没有 Python 运行时或后端函数**；与原需求中 main.py 对应的应用协调职责由 `App` 类承担。

## 文件树

```text
pdf_translater/
├─ .codex/pdf_translater_dev.md     用户提供的开发约束（只读）
├─ .gitignore
├─ .prettierrc.json                 新建代码的格式规则
├─ index.html                      唯一页面入口、文件输入、弹窗和提示容器
├─ package.json                    版本、依赖和 npm 命令
├─ package-lock.json               精确依赖锁定
├─ vite.config.js                  相对路径静态构建与本地开发配置
├─ playwright.config.js            Chrome/Chromium 端到端测试配置
├─ LICENSE                         项目 GPL-3.0
├─ README.md                       用户使用说明、部署和能力边界
├─ DEVELOP.md                      结构变动、开发决策、验证记录
├─ CHANGELOG.md                    版本功能及修复
├─ STRUCTURE.md                    本文档
├─ THIRD_PARTY.md                  代码、素材、API 和许可证来源
├─ src/
│  ├─ ui_rules/
│  │  ├─ UI_Design.png              用户提供的主界面参考图
│  │  ├─ ui_design_rules.md         用户提供的设计准则
│  │  └─ reference-preview.jpg      阅读原始大图用的缩小预览，不参与构建
│  ├─ _logo/
│  │  ├─ LUCIDE-LICENSE
│  │  ├─ FLUENT-LICENSE
│  │  ├─ LOBE-ICONS-LICENSE
│  │  ├─ llms/{deepseek,mimo,qwen,openai,glm,kimi,lmstudio}.svg
│  │  ├─ llms/{meta,google,baidu,aliyun,volcengine}.svg
│  │  ├─ llms/local.svg             Fluent Emoji 彩色本地电脑图标
│  │  ├─ icons/*.svg               66 个已下载 Lucide 图标，清单见下
│  │  └─ art/{open-book,sparkles}.png
│  ├─ js/
│  │  ├─ main.js                   应用协调、标签、工具栏、文档管理
│  │  ├─ storage.js                九表 IndexedDB、事务写入、精确删除合并
│  │  ├─ library.js                文件夹、选择范围、移动、删除计划及 ZIP
│  │  ├─ settings.js               多 API 兼容配置、归一化、默认服务
│  │  ├─ providers.js              八种配置模板、官网映射和浏览器/客户端打开入口
│  │  ├─ document-download.js      一致快照合并编辑，所有 PDF 下载共用
│  │  ├─ pdf-links.js              外部 PDF 链接及固定后缀文件名校验
│  │  ├─ utils.js                  转义、UUID、下载、哈希、格式化
│  │  ├─ text.js                   PDF 排版清洗、单词判断、按字节切片
│  │  ├─ translation.js            免费词典、词形补充、基础翻译入口
│  │  ├─ dictionary-fallbacks.js   有道/FreeDictionaryAPI/3325 适配、详细释义判定和中文转换
│  │  ├─ basic-translation.js      非 LLM 服务配置、签名、JSONP、分段和响应解析
│  │  ├─ offline-translation.js    离线模型 Worker RPC、选中后加载、下载/取消/释放
│  │  ├─ offline/
│  │  │  ├─ catalog.js             轻量模型目录、已安装集合和语言方向校验
│  │  │  ├─ store.js               独立模型数据库、流式下载、gzip、哈希和安装提交
│  │  │  ├─ runtime-cache.js       运行库按需缓存、路径/版本隔离、CacheStorage 回退
│  │  │  ├─ translation.worker.js  按类型分发请求、加载器注册与串行推理
│  │  │  ├─ bergamot.js            Marian/SentencePiece/shortlist 的 WASM 适配
│  │  │  └─ onnx.js                Transformers.js/ORT 单线程与 IDB customCache
│  │  ├─ llm.js                    Chat/Responses、文件输入、SSE、原生 PDF
│  │  ├─ markdown.js               Markdown/KaTeX/高亮/安全 HTML
│  │  ├─ markdown-core.js          窗口/Worker 共用同参数 Markdown、公式和代码解析器
│  │  ├─ markdown-blocks.js        完整 token 解析、稳定块及长段内联片段缓存
│  │  ├─ markdown.worker.js        全文渲染 Worker，仅接收快照/返回块 HTML
│  │  ├─ full-markdown.js          最新快照调度、净化与增量 DOM、工作预算及回退
│  │  ├─ translation-writes.js     全文合并保存、最终/备份刷新与任务错误传播
│  │  ├─ pdf-engine.js             各平台统一按需加载官方兼容 PDF.js 与匹配 Worker
│  │  ├─ pdf.js                    PDF.js 加载、文本提取、可见页和批注交互
│  │  ├─ pdf-text.js               同源字体、准确尺寸/旋转与字宽/基线对齐
│  │  ├─ pdf-search.js             文本索引、字符位置映射与大小写/全字匹配
│  │  ├─ pdf-internal-links.js     原生内链几何、命名/显式目标、短按与键盘跳转
│  │  ├─ selection-actions.js      可注册的选区动作、命中状态及局部清除规则
│  │  ├─ shapes.js                 形状选择清单、共享 PDF 点坐标几何及画布路径
│  │  ├─ pdf-export.js             标准批注及文字/绘图导出、视觉版译文 PDF
│  │  ├─ pdf-comments.js           标准文字标记、Ink、Text/Popup、Unicode 和换行
│  │  ├─ pdf-fonts.js              原 Noto CFF 子集编码适配及旧损坏子集修复
│  │  ├─ text-annotations.js       原位输入、尺寸模式、浮栏、锚点强调和分组历史
│  │  ├─ annotation-writes.js      批注串行写入、所有者检查及导出/备份等待
│  │  ├─ archive.js                ZIP、AES、校验、迁移、WebDAV
│  │  ├─ compat/
│  │  │  ├─ apple-webkit.js         Apple WebKit 检测、PDF 选项、触控放置与比例菜单 portal
│  │  │  ├─ pdf-runtime.js         各平台缺失 Promise/ReadableStream 能力的按需补齐
│  │  │  └─ pdf.worker.js          各平台官方 legacy PDF.js 与通用运行时的 Worker 入口
│  │  └─ ui/
│  │     ├─ components.js          图标、按钮、下拉、弹窗、提示、输入框
│  │     ├─ assistant.js           划词、全文、AI 会话与任务状态
│  │     ├─ translation-engine.js  引擎枚举、分组菜单、品牌触发器及共享保存
│  │     ├─ reading-fonts.js        三组阅读字号按钮、范围状态和显示比例应用
│  │     ├─ library.js             文档管理卡片/列表、多选和操作弹窗
│  │     ├─ open-pdf.js            打开三项菜单、文档树及外部链接导入弹窗
│  │     ├─ pdf-navigation.js      缩略图、内置书签、目标解析及导航渲染生命周期
│  │     ├─ settings-panel.js      设置五页、启动引导、迁移入口
│  │     ├─ basic-settings.js      基础翻译折叠配置、连接测试、默认与保存
│  │     ├─ offline-settings.js    三行模型配置、空间/进度/导入/下载/删除
│  │     ├─ desktop.js             桌面状态和分栏调整独立交互
│  │     └─ mobile.js              移动端分屏、视口；保留阅读选区供标注
│  └─ styles/
│     ├─ base.css                  Tokens、公共组件、所有功能模块通用样式
│     ├─ pdf-text-layer.css        PDF.js 文字层必要规则及许可证来源注释
│     ├─ apple-webkit.css          仅 Apple WebKit 生效的文字选择、触控与菜单层级规则
│     ├─ desktop.css               >960px 桌面横屏布局
│     └─ mobile.css                ≤960px 移动竖屏布局
├─ public/
│  ├─ fonts/{NotoSansSC-Regular.otf,LICENSE}
│  ├─ pdfjs/{cmaps,standard_fonts,wasm}/   构建前从锁定的 PDF.js 包复制
│  ├─ offline/
│  │  ├─ manifest.json            统一固定版本、引擎、URL、哈希与文件分片清单
│  │  ├─ bergamot/                bergamot-translator.js、生成的 .mjs、.wasm
│  │  ├─ lite/                    model.enzh.intgemm.alphas.bin.part{0,1,2}
│  │  │                           lex.50.50.enzh.s2t.bin、srcvocab.enzh.spm、trgvocab.enzh.spm
│  │  ├─ onnx/                    transformers.min.js、ort-wasm.wasm、ort-wasm-simd.wasm
│  │  └─ licenses/                BERGAMOT-MPL-2.0、TRANSFORMERS-APACHE-2.0、JINJA-MIT、
│  │                              ONNXRUNTIME-MIT、ONNXRUNTIME-NOTICES（均为 .txt）
│  └─ licenses/                    项目与素材许可证；FONTKIT.txt、CORE-JS.txt 随源码维护
├─ tools/
│  ├─ download-assets.ps1          下载开源图标、插画、字体与文档
│  ├─ prepare-assets.mjs           拷贝 PDF.js 资源和分发许可证
│  ├─ prepare-offline-assets.mjs   固定资源校验/下载/gzip 解压/分片与 ESM glue 生成
│  ├─ offline-service-worker.mjs   Vite 构建插件，生成 dist/sw.js 和静态预缓存清单
│  ├─ verify-offline-dist.mjs      三内核子路径部署、断网重载和真实 Lite 推理
│  ├─ check.mjs                    递归进行 JavaScript 语法检查
│  └─ verify-dist.mjs              Chromium/WebKit 生产子路径、PDF/Markdown Worker、中文导出
├─ tests/
│  ├─ 1-s2.0-S0950705126003436-main.pdf 用户提供的密集文字性能样本，不参与发布
│  ├─ core.test.mjs                数据、清洗、SSE 和存档协议测试
│  ├─ providers.test.mjs           模板、可信官网映射、原配置保留与原生桥接测试
│  ├─ dictionary-fallbacks.test.mjs 词性/子词义、中文转换、客户端识别与错误结构测试
│  ├─ basic-translation.test.mjs   三家签名、响应、分段/取消、凭据存档和并发保存
│  ├─ offline-translation.test.mjs 离线目录/方向、gzip/哈希、安装事务/删除隔离及资源校验
│  ├─ offline-runtime-cache.test.mjs 运行库缓存版本/路径、复用和存储受限回退
│  ├─ settings-persistence.test.mjs 自动保存交错写入、完整设置备份、清空 API 防复活
│  ├─ reading-fonts.test.mjs       独立字号边界、并发保存、重载和无密钥存档恢复
│  ├─ stream-rendering.test.mjs    Markdown 语义、未闭合语法、合并保存/失败及最终刷新
│  ├─ pdf-internal-links.test.mjs  命名/显式目标、坐标和 QuadPoints 边界
│  ├─ annotation-writes.test.mjs   原位写入顺序、事务回滚、删除保护和几何备份
│  ├─ pdf-comments.test.mjs        PDF 标准注释/弹窗引用、Unicode 和换行规则
│  ├─ pdf-fonts.test.mjs           新旧字体子集、连续编辑、字体名与映射保留
│  ├─ pdf-links.test.mjs           无后缀/参数链接、协议、安全文件名与固定扩展名
│  ├─ selection-actions.test.mjs   选区规则、多类型/多页与局部清除测试
│  ├─ save-file.test.mjs           单次保存、取消和写失败不重复下载测试
│  ├─ shapes.test.mjs              形状几何、删除线及字号规则测试
│  ├─ eraser.test.mjs              连续擦除轨迹、细线穿越、形状区域及容差边界
│  ├─ search-geometry.test.mjs     搜索过滤、跨文本片段、移动边界与命中测试
│  ├─ library.test.mjs             目录/删除边界、事务回滚、共享历史、ZIP 和冲突测试
│  ├─ file-fingerprints.test.mjs   原始 MD5、分块/独立身份、旧记录补算/删除竞态与存档
│  ├─ apple-webkit.test.mjs        Apple 平台识别、Promise 与 ReadableStream 回退
│  └─ e2e/
│     ├─ apple-webkit.spec.js      WebKit 桌面/iPad/iPhone 的渲染、翻页、缩放、触控编辑
│     ├─ pdf-performance.spec.js   样本全页布局预算、Firefox 响应及窗口/Worker 缺失能力
│     ├─ selection-editing.spec.js 绘图/编辑过程中不重复翻译旧选区
│     ├─ eraser.spec.js            鼠标/触控连续多对象擦除、取消、撤销/重做和持久化
│     ├─ annotation-defaults.spec.js 对象字号范围/独立默认值/滑块同步及查找高亮显隐
│     ├─ app.spec.js               原有合成 PDF 的真实浏览器功能回归
│     ├─ optimizations.spec.js     状态反馈、松手翻译、绘图尺寸和导航回归
│     ├─ reader-refinements.spec.js 字形坐标、旋转/裁切、高 DPI、拖动/历史及搜索浮窗
│     ├─ library.spec.js           文档库交互、共享历史、下载、切换锁和无损升级
│     ├─ file-management.spec.js   重复导入确认、批量/跨页并发、外链副本和当前目录
│     ├─ editing-settings.spec.js  编辑导出回读、选词/绘图手势、引导/API 设置回归
│     ├─ basic-translation.spec.js 基础设置/教程/默认引擎、JSONP 和阅读区路由
│     ├─ offline-translation.spec.js 离线 UI/加载/取消、三内核与真实 Lite/Plus/Pro
│     ├─ offline-lifecycle.spec.js 选中加载/切走释放、慢网 UI、保存恢复与旧请求隔离
│     ├─ dictionary-fallbacks.spec.js 有道宿主、详细释义补齐、中文转换/回退/取消及来源
│     ├─ settings-autosave.spec.js 自动保存、即时备份、动画速度、桌面/手机启动页
│     ├─ inline-annotations.spec.js 原位输入/宽度/工具、空对象、原生导出及紧凑控件
│     ├─ v031.spec.js              打开菜单/链接/文档树、浮栏同步、原字体重复导出
│     ├─ v033.spec.js              引擎分组/页签位置、启动辅助按钮/默认及固定缩放
│     ├─ v034.spec.js              无后缀/重定向、菜单宽度、字号独立/边界/持久化/流式
│     └─ v035.spec.js              长译文性能/完整保存/Worker 回退、内链跨浏览器与编辑
├─ dist/                           构建产物，不手工编辑
├─ node_modules/                   npm 依赖，不手工编辑
├─ .cache/                         npm 缓存、开发期官方文档，不进入发布
└─ test-results/                   测试截图、失败 trace，不属于用户数据
```

图标文件名（均为 `.svg`）：`arrow-left`、`arrow-up-right`、`book-open`、`bot`、`check`、`chevron-down`、`chevron-left`、`chevron-right`、`circle-alert`、`circle-help`、`cloud`、`copy`、`database`、`download`、`eraser`、`expand`、`external-link`、`eye`、`file-text`、`folder-open`、`highlighter`、`history`、`key-round`、`languages`、`loader-circle`、`menu`、`message-square`、`minus`、`monitor`、`panel-left-close`、`pencil`、`plus`、`redo-2`、`refresh-cw`、`search`、`send`、`settings-2`、`shield-check`、`smartphone`、`sparkles`、`stop-circle`、`trash-2`、`type`、`underline`、`undo-2`、`upload`、`volume-2`、`x`。

`public/pdfjs` 内的文件清单由 `node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm}` 与 package-lock 唯一决定，属于供应商静态数据而非应用模块；构建无 CDN 依赖。

0.1.2 追加的六个图标文件：`strikethrough.svg`、`shapes.svg`、`rectangle-horizontal.svg`、`circle.svg`、`gallery-vertical-end.svg`、`bookmark.svg`。直线、箭头和转换进度复用已有 minus、arrow-up-right、loader-circle 图标。

0.2.0 追加：`folder-plus.svg`、`folder-input.svg`、`layout-grid.svg`、`list.svg`、`arrow-up.svg`、`arrow-down.svg`、`folder-tree.svg`（Lucide 0.468.0）。

0.2.1 追加 `eye-off.svg`（Lucide 0.468.0）和七个厂商 LOGO（Lobe Icons 固定提交，下载出处见 THIRD_PARTY.md）。

0.3.0 原位批注修订追加 move、rotate-ccw、a-arrow-up、a-arrow-down 四个 Lucide 0.468.0 图标，下载脚本已同步；0.3.1 复用既有下载图标。

## 数据模型与不变量

v0.4.0 额外创建 **独立** `paper-bridge-offline` 数据库（版本 1），`assets` 使用清单 SHA-256 为 key、Blob 为 value，`installed` 使用模型 ID 为 key、`{revision}` 为 value。安装按文件验证保存，最后提交版本标记；读取清单时检查所有必要 Blob 存在且长度匹配。模型删除仅删除该模型的安装标记和不被其他清单模型共享的资源；预置 Lite 禁止删除。原 `paper-bridge` 数据库、版本和备份字段没有变化，模型权重不进入用户备份/云同步。

静态 Service Worker 使用 `paper-bridge-shell-<scope>-<content hash>` 的 Cache Storage。安装清单只包含非推理静态文件（不预缓存 Lite 权重、Bergamot/ONNX 运行库），排除用户 PDF 和任何外部 API 响应。更新等待旧页关闭后激活，只删除自身 scope 的过期 shell。模型缓存、用户文档库与 shell 缓存职责独立。

首页导航（scope 根目录或 `index.html`，含查询参数）共用 `index.html` 缓存键。静态主机将该文件重定向到根目录时，预缓存的最终 HTML 保留 `redirected: true`；响应出口仅对同源已重定向首页，用原 body 流、状态和响应头新建 `Response`，使其满足导航请求的重定向约束。此逻辑兼容已有缓存，不改普通静态资源、运行库分支及模型加载策略，不需要删除缓存或数据库。

数据库名 `paper-bridge`，版本 2；所有对象仓库以 `id` 为 keyPath。升级仅新增缺失表，旧文档 folderId 缺省视为根目录，不重写或清除原数据。

| 表 | 核心字段 | 用途 / 不变量 |
| --- | --- | --- |
| documents | id, rootId, folderId?, name, pages, size, page, zoom, createdAt, updatedAt, translationId?, initialMd5? | folderId 为空代表根目录；rootId 是稳定逻辑组 ID；initialMd5 为原始 Blob 指纹，手动重复上传仍使用新 id/rootId |
| files | id, blob, updatedAt | id 与 documents 一致；原始或生成 PDF 不可变，避免编辑破坏源文件 |
| annotations | id, documentId, page, type, color, rects/points/x/y/text, selectedText?, fontSize?, width?, boxWidth?, boxHeight?, border?, strokeWidth?, shape?/start?/end?, deleted, recovered? | 下划线/删除线/高亮/新批注保存选区 rects；笔迹 points 与形状 start/end 使用归一化坐标；尺寸以 pt 保存；局部移除裁剪 rects，清空使用 tombstone |
| conversations | id, rootId, title, createdAt, updatedAt | 逻辑文档下多条独立会话；原文和译文共享 |
| messages | id, conversationId, role, content, status, error?, createdAt, updatedAt, recovered? | 用户先保存再请求；助手逐增量保存；不按轮数裁剪 |
| translations | id, documentId, rootId, content, language, providerId, status, error?, output, generatedDocumentId? | 多次全文翻译记录及 PDF 产物关联 |
| settings | id, value, updatedAt | `app` 存 LLM/API、basicTranslation、翻译/WebDAV、hideOnboarding；`workspace` 存标签/当前对话；`annotation-tools` 存工具偏好；`library-view` 存当前目录、卡片/列表及排序 |
| folders | id, parentId, name, createdAt, updatedAt | parentId 为空表示根目录，禁止自引用和循环，不以显示名称确定操作范围 |
| deletions | id, store, key, documentId?/rootId?/conversationId?, updatedAt | 精确删除标记，id=`store-key`；只记录已删实体 ID 和所有者，不保存文件内容，不递归推导额外删除 |

`status` 常见值：`streaming`、`complete`、`stopped`、`error`；从旧会话恢复的未完成 streaming 内容如实显示未完成，不在启动时批量篡改状态（避免影响另一个仍活动的窗口）。

所有恢复冲突副本 ID 为 `原ID-recovery-更新时间`，相同旧版本只保留一次。批注副本也保留在数据库和页面，可通过撤销/编辑处理，不会丢掉已有内容。文件 Blob 不随 metadata 合并被覆盖。

settings/app 新增 `readingFontSizes: {source,selection,full}`，值为各区域默认字号的百分比。默认 100，范围 70–180；按 APP 全局配置保存，不挂靠单个 PDF。普通备份/云同步均携带，导入需选择恢复设置。

## 内部模块 API / 函数

### offline-translation.js 与 offline/*

| API | 职责与调用关系 |
| --- | --- |
| `startOfflineTranslation()` | App 控件和初始引擎菜单就绪后调用；页面 load 后读取轻量安装目录，仅选中的本地引擎 idle/timeout 加载，监听 settings-changed，生产安全来源注册 SW |
| `offlineTranslate(text,{provider,source,target,signal,onProgress})` | 被 `basicTranslate` 的本地分支调用；方向验证、加载/推理状态、取消与模型切换；拒绝未选中模型的旧请求，选中模型保持待用 |
| `refreshOfflineModels({preserveDefault=false})` | RPC `list`，用完整安装标记更新目录并发布变更事件；取消清理时 preserveDefault=true，保证不改个人设置 |
| `manageOfflineModel(id,action,files?)` | 下载/导入/删除的独立 Worker；仅操作所指定的模型，完成后刷新列表 |
| `cancelOfflineModel(id)` | 终止该模型下载 Worker，并删除其部分文件；清理完成前保持 busy 状态 |
| `offlineJob(id)` / `subscribeOffline(callback)` | 读取任务进度、订阅 UI 状态，返回取消订阅函数 |
| `WorkerClient.call/close`（内部） | 请求 ID、pending map、事件绑定、超时、错误与终止；推理失败释放可能损坏的 WASM 实例 |
| `OFFLINE_MODELS` / `offlineOptions` / `offlineInstalled` | 小型 UI 目录；Lite 永久可选，其余仅完整安装后可选，权重和 URL 不进入此模块 |
| `setOfflineInstalled` / `isOfflineModel` / `validateDirection` | 合法 ID 和可用性管理、英→简中约束；Pro 映射现有八种语言至 NLLB token |
| `loadAsset(file,base,{remote,required,onProgress})` | IDB 命中优先，Lite 读取同源静态分片，Plus/Pro 读取固定 ModelScope URL；no-store 下载、解压、校验、持久保存，required 安装不得忽略存储错误 |
| `validateAsset` / `unpackFile` | 大小与分块 SHA-256；gzip 自动转换为可直接读取的二进制 Blob |
| `getAsset` / `putAsset` / `assetKey` | `paper-bridge-offline/assets` 中按内容哈希读写 Blob |
| `installedModels(manifest)` | 校验安装 revision、全部文件存在与长度；不将残缺缓存标记成已安装 |
| `installModel` / `clearModelCache` / `removeModel` | 空间估算、下载或逐文件导入、完整提交；事务内精确删除，不清空个人数据库 |
| `syncSelectedModel` / `scheduleSelectedModel` / `releaseInference`（内部） | 按有效引擎更新选中状态；取消旧调度与 Worker，同一模型复用，不清理磁盘；加载失败留给翻译请求提示 |
| `runtimeCacheName` / `runtimeCacheVersion` | 运行库缓存按静态 base URL 和固定运行库 SHA-256 命名，与 UI shell 哈希独立 |
| `cacheRuntimeAsset` / `cacheBergamotModule` | 在 Worker 内保存已验证运行库或 ESM 模块，首次选择/显式安装才触发，CacheStorage 不可用不阻止本地运行 |
| `createBergamot` / `createOnnx` | 统一返回 `{translate(text,source,target)}` 的加载器；全部在 Worker 内，ONNX 禁止远程模型回退 |

Worker 消息为 `{id,type,modelId,base,text?,source?,target?,files?}`。`type` 支持 `list/load/translate/install/import/delete`，成功为 `{id,result}`，错误为 `{id,error}`，过程事件为 `{id,type:'progress',modelId,phase,bytes?,total?}`。`phase` 为 `loading/ready/download/installed`；取消通过终止 Worker，避免长同步 WASM 推理无法响应取消消息。输入按句及有界长度完整分段，非中日目标间用空格连接，不静默截断长选区。

`manifest.schema=1`；`runtimes[]` 包含 `engine/path/bytes/sha256/url`，Mozilla glue 附固定 Git blob URL。`models[]` 包含 `id/name/engine/bundled/revision/license/source/target/files`，文件可附 `role/compression/parts/fallbackUrls`，模型可附 `sourceRevision`；哈希针对**解压并组合后**数据。清单为随应用发布的可信资源，用户只可导入匹配的模型文件，不能上传 JS 加载器。未来增加格式需扩展 Worker 加载器表及模型语言元数据。

### 离线 UI 映射

| HTML 元素/事件 | 功能与处理器 |
| --- | --- |
| `.offline-provider .basic-summary` | 位于百度配置上方；`aria-expanded`/`aria-controls` 切换折叠主体 |
| `#offline-models-body` / `.offline-models` | 容纳 Lite/Plus/Pro 三行，无额外页面或路由 |
| `[data-offline-model]` | 名称、彩色本地图标、语言、MiB、`role=status` 和操作按钮 |
| `[data-offline-action=install/import/delete/cancel]` | `OfflineSettings.run` / 隐藏文件输入 / `cancelOfflineModel`；busy 禁用冲突操作；Lite 永久禁删 |
| `.offline-import` | Plus/Pro 各自六个 JSON/ONNX 文件，可为 gzip；传给 Worker，不读取或执行外部代码 |
| `.offline-progress` | 自绘线性下载进度，ARIA 0–100，与原结果区环形推理动画分开 |
| `[data-select=basic-default]` | `BasicSettings` 保存基础默认值；模型安装变化即时更新菜单；删除当前模型切回 Lite |
| `#selection-engine` / `offline-models-changed` | `Assistant.renderEngine` 更新“机翻高速引擎”内“本地引擎 · 模型名”选项与彩色 LOGO |
| `#selection-result` 相邻 `.inline-loading` | 本地模型未就绪先显示“离线机翻模型加载中”，Worker ready 后显示“正在理解这段文字…” |

公共 Soft UI 样式位于 `base.css`；`desktop.css` 横排内容与右侧按钮、`mobile.css` 列式内容及下方按钮，保持原有两套导航与设置滚动行为。相关 `OfflineSettings.destroy` 仅解除 UI 订阅，关闭设置不擅自取消用户启动的模型下载。

### 离线模型生命周期

主 UI 的引擎选择仍经 saveTranslationEngine 持久保存并发出 settings-changed。有效引擎为 online 且 defaultProvider 属于本地目录时，selectedModelId 指向该模型；否则为空，不安排推理加载。首屏调用不等待任何模型 Promise；页面 load 后低优先级预加载仅处理选中模型。切换立即终止旧 Worker、取消调度并拒绝旧 pending 请求；相同模型不重启，无关保存不干扰。模型等待/推理仍使用原结果区环形状态；本地切换的 AbortError 不显示错误卡。

运行库的按需缓存以 paper-bridge-runtime-v1 加路径及哈希命名；Worker 在初始化所选模型前写入，SW 对该清单只提供 cache-first 读取，不提前下载，也不通过 waitUntil 延长取消任务。显式下载/导入也准备所需运行库磁盘缓存，但不进入加载状态。首次使用前未缓存的模型不能在断开远端站点后凭空加载；Tauri/本地静态源仍可读随包文件。

### 下载源与同版本缓存兼容

Lite 保持 Mozilla base-memory 原权重、预置分片、MPL-2.0；备份和用户数据格式不变。Plus 按用户最终体积约束保留 OPUS-MT INT8，Pro 保留 NLLB INT8，均不随包分发；二者浏览器下载改用 ModelScope 固定源。`revision` 保留原权重身份，`sourceRevision` 记录 ModelScope 文件提交，源切换不会让已验证缓存失效。Firefox base 的候选源未通过 CORS；没有 `public/offline/plus/` 或新增模型静态目录。

取消先关闭专属下载 Worker，再按 manifest 哈希调用 `clearModelCache`/`removeModel` 事务删除目标资源与安装标记，不扫描或清空其他数据库；共享权重与运行库保留。网络使用 `cache:no-store`，不额外保存浏览器 HTTP 副本；`preserveDefault` 阻止取消清理顺带改写个人设置。

### 离线构建与部署

`prepare-offline-assets.mjs` 验证仓库内独立二进制，缺失时按固定 URL 下载并验证；预先解压 `.gz`、分片大文件。原 Mozilla JS 保留，生成 `.mjs` 仅适配严格模式 global export 并导出工厂。`offline-service-worker.mjs` 在生产构建后生成 shell 安装列表及独立按需运行库列表；`verify-offline-dist.mjs` 启动临时子路径静态站、真实推理、关闭源站后重载验证。`dist/sw.js` 为生成文件，不手改。

`verify-offline-dist.mjs` 的 `PAPER_BRIDGE_TEST_INDEX_REDIRECT=1` 模式模拟静态托管的 `index.html` → 根目录 308，断言缓存保留重定向标记后执行在线刷新、带查询参数导航及断网重开。与 `PAPER_BRIDGE_SMOKE_ENGINE` 组合验证三内核；默认模式继续覆盖无重定向的本地静态部署。

HTTP(S) 服务需支持 `.mjs/.js` JavaScript 与 `.wasm` MIME；HTTPS/localhost 可安装 SW。Tauri WebView 无 SW 时仍从随包目录读取 Lite，宿主需允许 Worker、WASM 与本地模块请求；没有新增原生工程。Mozilla 二进制需要相应 SIMD/原子指令支持，ONNX 提供 SIMD/标量两种固定运行库，均无需 GPU、SharedArrayBuffer 或 COOP/COEP。

### storage.js

- `database()`：懒打开数据库，只在 upgrade 创建缺失结构；升级被其他窗口阻挡时发出事件。
- `all(store)`、`get(store,id)`：读取记录。
- `put(store,row)`：克隆、更新时间并等待事务；检查删除标记和批注/译文/会话/消息所有者仍存在，防止已删除内容被异步任务回填。
- `patch(store,id,values)`：在同一事务里读取再合并，避免覆盖无关字段。
- `addDocument(blob,name,pages,rootId?,folderId?,sourceId?)`：事务前计算原始 Blob 的 initialMd5，metadata/Blob 同事务写入；目标目录必须存在，生成译文时从 sourceId 的最新记录继承逻辑组与原文目录，来源已删除则拒绝创建。普通上传不按 MD5 复用任何 ID。
- `findDocumentsByMd5(digest)`：全库匹配初始 MD5；缺少/无效缓存的旧记录逐份读取 files.blob 计算，写前在 documents/files/deletions 事务复查存活与源文件时间/大小，仅补充 initialMd5，保留最新其他字段及 updatedAt。匹配前重新读取最新文档列表，不返回已删除记录。
- `snapshot()`：单个只读事务得到所有表的一致快照。
- `mergeSnapshot(data,{restoreSettings,restoreDeleted})`：跨表原子合并，保留冲突内容，合并目录/精确删除标记；被动同步不复活已删除对象。主动本地导入可移除对应标记并用晚于删除的时间恢复记录。
- `contextDocument(rootId,preferredId)`：优先原文，原文已删则选择当前或其他存活组成员，用于继续 AI 上下文。
- `applyExactDeletions(tx)`（内部）：仅处理标记中准确的键和所有者；较新本地编辑阻止陈旧删除，仍存活组的数据保留；移除被拒绝的删除标记；修复缺失父目录和合并循环为根目录，不删除其中内容。
- `requestPersistence()`：请求浏览器持久存储，返回实际授权结果，不承诺浏览器不会被主动清空。

### library.js

- `objectKey(kind,id)`：区分文档/文件夹选择键，避免跨类型 ID 混用。
- `readLibrary()`：同一只读事务获取目录和文档的一致列表。
- `validateFolderTree(folders)`：检查父目录存在和循环；不合法时中止操作。
- `expandSelection(state,keys)`：仅展开明确选中文件夹的后代及明确选中文档，使用集合去重；不按 rootId 扩大下载/删除集合。
- `sortLibraryObjects(objects,sort,direction)`：文件夹优先，组内按名称自然排序或 createdAt 正/倒序。
- `createFolder(name,parentId)`：校验名称、父目录及同级同名冲突，再保存。
- `moveSelection(keys,destination)`：单事务移动顶级选择、保持后代层级；阻止移入自己/后代；原文移动时其译文跟随原文目标目录，单独移动译文不反向移动原文。
- `planDeletion(state,keys)`：生成要审核的文档/文件夹 ID、名称和完整显示路径清单。
- `deleteSelection(plan)`：确认清单与执行时有效选区取交集，绝不纳入新后代；精确删 metadata/Blob/批注，仅无存活组成员时删共享会话、消息和全文历史；仍有成员则重绑必要引用；空目录逐层移除，非空目录保留；一个事务提交并写删除标记。
- `downloadPlan(state,keys)`：选中文件夹包含自身/所有后代/空目录，文件不会隐式携带配对文档；超过两 PDF 或含文件夹则 ZIP；安全路径与重名序号防止丢文件。
- `buildLibraryZip(plan)`：按计划逐份调用 editedDocumentBlob 合并当前编辑后生成 ZIP；任一文件缺失或导出失败则报错，不静默改用原始文件或漏掉内容。

### settings.js

- `PROVIDERS`：从 providers.js 兼容重导出，供启动引导与“添加”菜单复用。
- `normalizeSettings(raw)`：兼容海姆休息室单 API 和多 API 格式；规范化 URL、去重 provider ID、同步默认三字段。
- `translationProviderId`：划词/句子翻译专用 API 偏好；旧数据缺省取默认 API，不修改 `defaultChatProviderId`。
- `getSettings()`、`reloadSettings()`：读取/重载配置缓存。
- `saveSettings(nextOrUpdater)`：所有设置共用串行队列；对象入队时深拷贝，函数按执行时最新配置计算补丁，避免 LLM/基础/引导等交错写入丢字段；提交存储后更新缓存、派发 settings-changed。失败不阻断之后重试。
- `flushSettings()`：返回当前保存队列完成 Promise；备份在 snapshot 前等待它，避免漏掉最后一笔自动保存。
- normalizeSettings 将显式 chatProviders=[] 视为清空；仅字段不存在时兼容旧单 API，避免删除最后一项后被旧 baseUrl/apiKey 别名重新创建。
- `saveBasicTranslation(update,preferences?)`：委托全局设置队列读取最新 basicTranslation 后合并单项凭据/默认值，避免多家配置并发保存互相覆盖；阅读区基础引擎选择复用此入口，可同时保存风格等偏好。
- `getProvider(settings,id?)`：选择 API，缺少地址或模型时给出明确错误。

### providers.js / document-download.js

- `PROVIDERS`：DeepSeek、MiMO、Qwen、OpenAI、GLM、Kimi、LM Studio、自定义八个模板；名称、Base URL、model 按用户指定值，官网 keyUrl 仅供固定链接映射；模板不应用于已有配置。具体值见 README。
- `providerKeyUrl(baseUrl)`：读取当前输入，按完整主机名匹配已知服务；拒绝无效协议、内嵌凭据、自定义端口和仿冒后缀域名，返回固定官网 URL 或 null，绝不携带输入的查询参数/Key。
- `openExternalWebsite(url)`：只允许不带内嵌凭据的 HTTPS 链接，供已知官网及基础服务教程复用网页/Tauri 打开逻辑。
- `openProviderWebsite(baseUrl)`：映射固定官网后委托 openExternalWebsite；网页通过 noopener/noreferrer 打开新标签；Tauri 2 使用 opener.openUrl 或 plugin:opener|open_url，Tauri 1 使用 shell.open，唤起默认浏览器。打包需启用插件权限，仓库不包含原生安装包。
- `editedDocumentBlob(documentId)`：先等待 flushAnnotations，再 readonly 事务读取 documents/files/annotations 的同一快照；仅合并所属文档未删除记录。没有编辑直接返回原 Blob，有编辑按需加载 PDF.js/pdf-lib 并复用 exportAnnotatedPdf，finally 释放独立源解析器；不覆盖数据库文件、不依赖随标签切换销毁的阅读器实例。阅读栏、文档管理所有下载模式、已生成译文下载均复用。
- `hideOnboarding`：默认 false，只有显式开关设置为 true 才跳过引导；onboardingDone 保留兼容字段但不再控制弹出。切换开关立即保存，跳过/完成前等待保存，随既有设置备份流程持久化。

### basic-translation.js

- `BASIC_APIS` / `BASIC_FREE`：固定三家需凭据的服务元数据、字段标签与额度文案，以及 MyMemory/Google 两个免 Key 选项。
- `basicConfigured` / `basicOptions`：判断凭据完整度；只将完整配置加入选择器。
- `normalizeBasicTranslation`：规范化 `{defaultProvider,providers:{baidu,aliyun,volcengine}}`；每家为 `{keyId,secret,connection?}`。connection 仅保存成功状态、checkedAt 和测试风格，不保存测试文本或译文；旧设置缺省 MyMemory。
- `mergeBasicTranslation(local,incoming)`：存档恢复时保留缺失的本地凭据；无密钥的不同账号不覆盖现有完整账号；不混用账号 ID 和另一账号的密钥。
- `basicLanguage(provider,language)`：应用语言码映射到各服务语言码；Baidu academic 限中英，Google 保留标准代码。
- `buildBasicRequest(provider,config,text,source,target,style,{date,nonce})`：生成官方端点的完整请求；百度 MD5(appid+q+salt+[domain]+secret)，阿里 RPC POST HMAC-SHA1，火山 V4 HMAC-SHA256，region=cn-north-1/service=translate；从不手动设置浏览器禁止的 Host，只将域名纳入签名。
- `baiduJsonp(url,signal)`：仅允许固定官方 origin 及两个翻译路径；随机一次性 callback、无 Referrer，完成/错误/超时/取消时移除 script 与回调。
- `parseBasicResponse(provider,json)`：解析五种响应、多条译文、服务错误码；拒绝空结果/无效结构，不误标成功，不把原始密钥反射到错误文案。
- `sendBasicRequest`（内部）：fetch/JSONP、20 秒单次超时；百度在当前页面按全局队列维持至少 1050ms 请求间隔，支持取消等待。不会将选中文字发往未选服务或 LLM。
- `basicTranslate(text,options)`：清理 PDF 文本后按 UTF-8 字节分段完整翻译；MyMemory 450，Google/百度 GET 1500，阿里/火山 POST 4500 字节，保留全部段；清理与同语种处理沿用现有功能。
- `digest` / `hmac` / `encode` / `query` / `hex` / `bytes`：浏览器 Web Crypto、RFC3986 编码和签名序列化；MD5 按需加载已锁定的 @noble/hashes/legacy.js。

### text.js / translation.js

- `cleanPdfText(input)`：检测连续行号、修复断行连字、过滤数字引用、合并空白；保留公式上标与年份。
- `isSingleWord(text)`：英文单词（可含连字或撇号）走词典，其余走句子翻译。
- `splitForTranslation(text,byteLimit=450)`：按 Unicode 码点切片，以 UTF-8 字节限制请求，不破坏代理对。
- `CLEANING_INSTRUCTIONS`：统一 LLM 排版修复和文档内指令隔离提示。
- `onlineTranslate(text,source,target,signal,basic,style)`：按 basic.defaultProvider 委托 basicTranslate，缺省 MyMemory，保留超时/取消；lookupWord 的中文补充使用同一基础配置及通用风格。
- `lookupWord(word,signal,onUpdate,basic)`：客户端先尝试有道，网页跳过。普通流程仍并行查询 Free Dictionary/Wiktionary，按完成顺序验证并转换详细释义；中文简短词义和词形独立获取。无中文或无有效详细释义时顺序查询 FreeDictionaryAPI.com→3325；仅简短中文成功不提前结束，候选全部失败才报告。取消不继续下一候选、不发布旧更新，不调用 LLM。
- `updateDetails` / `addSupplement`（内部）：已转换的主要定义优先，其次采用可用备选；英文转换前只发布简短中文/音标/词形，转换后替换对应候选。返回 word/entries/chinese/forms/source/warning/chineseSource/credits，并以 definitionSources 记录详细释义的实际翻译服务；全部仅存在当前选词内存。
- `translateDetail` / `prepareDetails`（内部）：当前基础 API 优先，后续按 basicOptions 尝试免 Key/完整凭据服务，网页跳过明确不支持的火山方式。共享取消信号、失败服务集合、按原解释文本复用 Promise，逐条保留映射；中文转换失败则清除该候选未展示的正文解释并继续搜索，记录实际失败原因。不会改默认配置。
- `dictionaryJson(url,signal,request=fetch)` / `plainText(html)`（内部）：6.5 秒独立词典超时，支持有道宿主传输函数，提取词条 HTML 的纯文字。
- `LANGUAGES`：中简/中繁/英/日/韩/法/德/西的展示和 API 代码映射。

### dictionary-fallbacks.js

- `hasDictionaryDetails(result)`：至少一个 meaning 同时具有非空 partOfSpeech 和 definition；空壳和简短词义均不满足。
- `nativeDictionaryAvailable(host=globalThis)`：识别 Tauri 标识或显式宿主 transport，不用 User-Agent 猜测；普通网页为 false。
- `youdaoDictionaryResult(json,word)`：校验 result.code=200 和匹配词条，正则识别 n./v./vt./vi./adj. 等词性边界，保留词义内分号，输出统一 entries/chinese/forms/credit；不扩写接口省略的内容。
- `needsChineseTranslation(value)` / `chineseDictionaryEntries(entries,translate)`：识别英文及以英文为主的混合解释，在副本中翻译非中文 definition，常见/组合词性用 partsOfSpeech 映射，未知英文标签委托翻译；保留原文例句、音标、近义词与词形，不影响输入对象。
- `hasChinese(value)`：字符串含 Unicode Han 字符才视为有中文，空值、英文原词或拼音会触发备选。
- `freeDictionaryResult(json,word)`：只取 language.code=en 词条，递归展开 senses/subsenses；将 zh/zho/cmn 及子标签的 translations.word 去重为中文释义。pronunciations→phonetics、partOfSpeech/senses→meanings、examples→example、条目/词义 synonyms 合并、forms.word/tags→词形，保留 source.url/license 和 FreeDictionaryAPI.com 署名。
- `dictionary3325Result(json,word)`：校验 code=200、data 存在；british/american→phonetics，cx→partOfSpeech，jbjs→definition/chinese，url→来源；缺省空 synonyms/forms/audio，不额外请求无关接口。
- `text/list/unique/sensesOf`（内部）：纯数据类型检查、去重与子词义展开，无 DOM、持久化或网络副作用。

宿主接口 `globalThis.__PAPER_BRIDGE_DICTIONARY_FETCH__(url,{signal}) → Promise<Response>`：由后续客户端在应用启动前注入，只接收有道查询 URL，返回 Fetch 兼容响应并遵守取消/超时。未注入时 Tauri 客户端尝试 fetch，CORS 未解决则回退；普通网页无标识/钩子时完全跳过有道。本仓库不提供该代理服务。

### llm.js

- `headers(provider)`：按服务组装 JSON 与 Key 头，兼容 MiMo `api-key`。
- `sseEvents(body)`：流式 UTF-8 解码；支持分块 CRLF、多行 data、尾包，释放 reader 锁。
- `extractText(json)`：Chat 与 Responses 非流式文本统一提取。
- `requestLlm(options)`：构造协议请求，可附整份 PDF；处理增量、完成标记、错误和原生 PDF 容器文件。保留 await onDelta；全文回调仅更新内存并交给合并保存/显示调度，问答仍按原流程 await 落盘。
- Chat 兼容文件回退：只在 400 且错误匹配 `file must have a file_id or file_data` 时，从 `file: {filename,file_data}` 改为文件部分的顶层字段后重试一次。文件数据、完整历史、服务地址和凭据保持一致；不扩大到其他错误或自动截断/降级。
- `testProvider(provider,signal)`：短文本响应测试，不设置可能破坏结构的输出截断。
- `listModels(provider)`：读取 `/models`，超时后报告错误。

### text-annotations.js / annotation-writes.js

- `TextAnnotations.rememberFontSize(type,size)`：仅由 action 的浮栏字号赋值调用，统一限制 6–48 pt，通知 viewer.callbacks.annotationFontSize 并返回尺寸值；保留对象原输入/尺寸模式和撤销历史。
- `App.setAnnotationFontSize(type,size)`：同步 toolOptions.noteSize/textSize、viewer.drawingOptions，复用 saveToolOptions 保存 annotation-tools；使用既有 color-popover.dataset.tool 判断同类菜单，更新 #tool-size 并触发原 input 更新标签/进度。不修改其他类字号和颜色/笔宽偏好。

- `TextAnnotations` 仅管理 note/text，复用 PdfViewer 的文档、批注数组、历史与绘制。active 区分 text 输入和 size 尺寸模式；跨页新批注初次输入共享文本，后续对象可独立修改。
- `row/element/editing`：按稳定 ID 定位数据、DOM 和原位输入状态。`begin/activate/edit`：建立临时空对象或进入已有对象输入，清理 PDF 原选区并聚焦 textarea。
- `select`：单击尺寸模式、触控同对象双点进入输入。`showToolbar`：尺寸模式四/五按钮，文字模式仅字号增减/删除三按钮。`finish`：结束输入/尺寸手势、移除浮栏 DOM，空内容标记删除，放弃空新建不产生有效历史；最终几何写入后可供导出等待。
- `input/persist`：每次输入克隆数据并串行保存，一次文字编辑合为一条 before/after 历史；旧写入不会回填覆盖新输入。`action`：字号 ±1pt（6–48，且保存同类默认值）、文本框 border 开关、删除 width 恢复自动、无确认删除。文字模式改字号合入当前会话历史，点击不移走输入焦点；删除先完成编辑再建立独立删除历史，撤销恢复最新文字。
- `render/fit`：保留正在输入的 DOM/光标；Canvas 字宽测量、textarea.scrollHeight 调整宽高；默认宽度最大页面 45%，width 存在表示手动归一化宽度，boxWidth/boxHeight 缓存实际几何。Enter 与原文选区分离，不调用翻译。
- `resize`：左右手柄捕获鼠标/触控，左侧调整同时变更 x；范围不超页面，一次拖动一条历史，取消恢复 before。`positionToolbar`：浮栏作为对象子元素使用局部坐标，随对象同一次布局移动，无独立 fixed 跟随或位置过渡；滚动、尺寸变化时保持阅读视口内可操作。
- `emphasize`：按指针与源文 rects 命中添加柔和发光，不创建可拦截取词的文字覆盖层。
- `writeAnnotations(rows)`：捕获不可变快照，串行在同一事务写入一组记录，检查 documents/deletions，禁止复活已删除所有者；失败整组回滚。`flushAnnotations()`：供编辑结束、文档切换、下载和备份等待。
- annotations 新增可选 width（0–1，存在即手动模式）、boxWidth/boxHeight（正数实际尺寸）、border（布尔，仅文本框显示）；旧记录没有这些字段时按自动宽度、无文本框边框处理，无清库迁移。

### pdf-comments.js

- `appendPdfMark(pdf,page,annotation,viewport)`：underline/strike/highlight→Underline/StrikeOut/Highlight，归一化选区按页旋转/裁切转换为 QuadPoints；pen→Ink，一个对象中一条 InkList 子路径，按 strokeWidth 绘制连续圆角 AP。高亮 ca/CA=0.3、Multiply；所有标记只追加 Annots，不写入页面内容流。
- `appendPdfNote(pdf,page,note,viewport)`：有 rects 则建立 Underline 注释、QuadPoints、原色下划线 AP；旧自由便签建立 Text/Comment 注释；二者均关联独立 Popup/Parent，保存 UTF-16 Contents、标题、时间、稳定 NM，追加原 Annots 而不覆盖。批注不调用 page.drawText、不写入正文内容流。
- `wrapAnnotationText(text,measure,width)`：保留显式换行，优先空白断行、长词/CJK 按码点拆行，供文本框导出；自动宽度按导出字体测量并保留 45% 上限，手动宽度沿用数据，边框导出为页面矢量矩形。
- PDF.js 与 MuPDF 验证注释内容/链接，Chrome 实测悬停弹窗；Chrome/PDFium 会忽略文件原 Popup 外观并重建 ANSI 字体弹窗，中文漏显属于宿主限制，文件内容并未丢失。Acrobat 未在本轮运行。

### pdf-fonts.js

- `notoFontkit.create(data)`：委托原 fontkit，只为 NotoSansSC-Regular CFF 字体的 createSubset 添加局部适配。offSize 取原头部值；subsetFontdict 按原 FD 索引稳定映射到子集 FD，分别收集所用局部 Subrs，原字形程序保持不变。其他字体直接使用原实现。
- `repairNotoCffFonts(pdf,originalBytesOrLoader)`：仅检查名称匹配且 offSize 非法的 Noto FontFile3/CIDFontType0C 流；通过 Identity-H、ToUnicode 的 bfchar 恢复 CID→Unicode，从同一原始 OTF 按旧 CID 顺序重新编码。替换同一引用的字体流，保留字体名/宽度/ToUnicode，不触碰正常字体及其他字体；不安全映射显式报错。返回修复数量，原字体仅在需要修复时加载。
- `encodeSubset`（内部）：收集编码流为 Uint8Array；修复在 pdf.flush 后、最终 save 前执行，已正确编码的子集不会被重复生成。

### markdown.js / pdf-export.js

- `renderMarkdown(text)`：Markdown + KaTeX + 代码高亮后 DOMPurify 清理，允许所需的安全字体、颜色、表格样式。
- `mountMarkdown(element,text)`：将安全内容放入容器，链接隔离打开；远程图片改占位，避免隐式请求。
- `sanitizeMarkdown(html)` / `prepareMarkdown(element)`：共用现有 DOMPurify 白名单及链接隔离，全文 Worker 返回的 HTML 仍先净化再入 DOM。markdown-core 同时供原 mountMarkdown 与全文 Worker 使用，不改变问答、划词和导出的解析参数。

### 全文渲染与写入

- `MarkdownBlocks.render(source)`：完整 Markdown parse→顶层平衡 token 分组；复用相同 token 组的渲染 HTML，纯内联长段按平衡边界拆分，保留 Unicode、公式、嵌套和跨块 HTML 上下文。只保留上一快照缓存。
- `FullMarkdown.set/schedule/send/receive`：保存最新内容版本、约 80ms 合并，一项在途；Worker 返回块 HTML 后按差异净化/更新 DOM，约 7ms 分片让出主线程。新块脱离页面构建后一次挂载；flush 等待最新版本，finish 渲染结束后释放 Worker/cache 并保留 DOM，destroy 清理定时器/Worker。Worker 失败用同解析器本地回退，渲染错误不无限排队。
- `TranslationWriter.update/write/flush/close`：约 200ms 合并完整内容，串行在途保存及最新版本；flush 等待所有当前版本落盘，失败向任务上报。flushTranslationWrites 用于备份；隐藏/退出页面触发尽力刷新。
- `Assistant.mountFull(record)`：按 recordId 管理全文渲染器；相同结果在任务结束时保留 DOM，历史/文档切换重置。onStage 仅更新状态文案，onDelta 更新内存、写入队列及当前渲染器，不重复全文 innerHTML。

### PDF 内部链接

- `linkRects(annotation,viewport)`：Rect/QuadPoints 转换到已缩放/旋转的视口矩形并裁切边界。
- `resolvePdfDestination(pdf,dest)`：命名目标或显式数组→页引用/从零开始页码→XYZ/FitH/FitV/FitR 归一化目标坐标，保持阅读缩放比例。
- `mountInternalLinks(viewer,shell,annotations,viewport,generation)`：仅 Link.dest，透明链接层不截获取词；页面短按几何命中，拖动/长按/标注和绘图不触发；键盘链接、悬停反馈，异步跳转核对文档/渲染代数。clearInternalLinks 清理虚拟页面重建监听。
- `loadFont()`（内部）：导出页面文本框或修复旧损坏子集时按需加载同一原始 Noto 字体；仅含标准批注且源文件字体正常时不加载。
- `exportAnnotatedPdf(blob,annotations,sourcePdf)`：读取原 PDF 并注册 notoFontkit；批注交给 appendPdfNote，文字标记及笔迹交给 appendPdfMark；形状沿用矢量绘制，文本框按记录的 fontSize/手动宽度/边框绘制。flush 后修复旧 Noto 子集，保持源 Blob 不变。
- `markdownToPdf(text,onProgress)`：离屏渲染译文，逐块/逐页生成 PDF；过高块分片，逐页释放画布。输出为栅格视觉 PDF。

### pdf.js

- `PdfViewer.searchHighlightsVisible` / `setSearchHighlightsVisible(visible)`：仅控制 .search-highlights 的 hidden 属性，查询和 searchMatches 缓存不变；paintPage 新建搜索层时继承该标志。由 App.init 的既有 PdfNavigation.onMode 回调在 search 模式设为 true，其余页签/关闭设为 false。

- `pdf-engine.getPdfEngine()`：首次打开 PDF 时加载同一版本的官方 legacy 主库及匹配 Worker，所有平台一致；上游 core-js 在窗口/Worker 中提供缺失 Map/WeakMap/Iterator 等标准能力，失败清空加载 Promise 以便重试。
- `compat/apple-webkit.applePlatform()`：按 AppleWebKit UA、Mac/iPad 平台及触控能力选择专用交互规则；`installAppleWebKit` 仅设置 Apple 根节点标记；`applePdfOptions` 保留 Apple 图像解码参数；`releaseAppleCanvases` 在 Apple 切页/重排时释放旧画布。PDF JavaScript 能力补齐不再按此 UA 分流。
- `compat/pdf-runtime.installPdfRuntime()`：在 App.init、getPdfEngine 和 PDF Worker 中补齐缺失的 Promise.withResolvers 和 ReadableStream 异步迭代，原生实现不变；`installPromiseResolvers` 保留 Promise 子类语义，`installStreamIterator` 串行读取、结束释放锁、提前退出按 preventCancel 决定取消。
- `compat/apple-webkit.deferAppleTextPlacement()`：iPhone/iPad 的文本框创建等待 touchend，避免 touchstart 聚焦引发 pointercancel 和空框自动删除。`openAppleMenu/restoreAppleMenu`：只将 PDF 工具栏自绘比例菜单临时移动到 body 层，关闭后恢复原父节点。
- `loadPdf(blob,onPassword)`：传入本地二进制及本地 CMap/字体/WASM；密码通过回调获取；为 PDF.js 6 的 loading task 提供统一 destroy 适配。
- `extractPdfText(pdf,onProgress)`：顺序获取每页文字，按位置移除页边纯数字行号，附页码。
- `PdfViewer.constructor`：绑定 Pointer/Touch 按下、松开、取消和键盘释放；仅跟踪 PDF 选择手势，selectionchange 只更新选区状态。文档外松手也可完成从 PDF 开始的选择，多触点未全部离开时不翻译。
- `queueSelectionTranslation(delay)`：只在文字选择模式、无活动指针/触控/原位编辑时提交；鼠标松开立即提交，触控结束延迟 60ms 等待原生选区稳定，同一完成选区去重。
- `setDrawingOptions(options)`：同步后续批注/文本框字号、手绘笔宽和形状类型；绘制开始时冻结参数，不修改已有记录。
- `open(doc,pdf)`：结束并等待原位编辑，再取消旧渲染、切换文档和批注。
- `layout()`：先结束原位编辑，再计算比例、建立页面占位、观察可见页、记录滚动页码和已布局宽度/DPR。主入口仅在尺寸或 DPR 变化时请求 fit 重排，避免延迟清空选区。
- `renderPage(number,generation)`：返回或复用该页完整绘制 Promise，供可见页加载与搜索/历史精确定位等待文字层就绪。
- `paintPage(number,generation)`：建立画布/批注/搜索/手绘层；文字容器先脱离 DOM，由 renderAlignedText 的 mount 回调验证代数/画布后插在 ink 前，旧任务取消时不回填。延续原超采样与 600 万像素预算、字体、尺寸、裁切/旋转/UserUnit 对齐；加载后重绘搜索标记。
- `goTo(page)`、`setZoom(zoom)`：页码边界、滚动和重新布局。
- `goToLocation(page,rect)`：先等待页面就绪，再按归一化位置滚动纵/横轴并更新页码。
- `getPageContent(number)`：按当前 PDF 缓存文本提取 Promise，切换文档清除。
- `search(query,options,{signal,onProgress})`：逐页收集全部匹配，支持取消及页数进度；结果仅在内存，空查询清除高亮。
- `matchRects(match)`：按 itemIndex/字符范围创建真实 DOM Range，返回匹配文字的归一化矩形。
- `drawSearchMatches(page)` / `revealSearchMatch(match)`：绘制独立浅黄标记；点击结果定位实际文字而非只跳到页首。
- `setTool(tool,color)`：切换鼠标命中层；文本框/手绘/橡皮擦/形状使用 Canvas 命中层，进入绘图工具时清除旧 PDF 选区；选择工具保留文字选择。
- `captureSelection({translate=false})`：原位文字输入期间跳过；其余裁切 Range 与文字 span 的交集，转换归一化坐标，刷新按钮状态；仅明确 translate=true、没有按住的指针且内容未提交过时调用翻译回调。
- `clearSelection(clearNative)`：清空选区与按下状态，按需释放浏览器选区。
- `clearSelectionForEditing()`：绘图/原位编辑开始时取消内部选区；仅当浏览器选区属于 PDF 且不在批注输入框中，才移除原生 Range，避免清空正在输入的文字。
- `applySelectionAction(type,color)`：按注册规则添加或局部清除；空选区不执行，互斥防重复，完成后释放；新批注转交 TextAnnotations.begin，空草稿退出时不留下对象。
- `commitAnnotationChanges(rows)`：委托 writeAnnotations 串行事务提交同一操作的所有页面；提交成功再更新当前文档和绘制。
- `addAnnotation(value)`：先保存后绘制，记录当前文档撤销栈。
- `historyState()` / `notifyHistory()`：返回当前文档 undo/redo 可用性；空栈或提交中禁用按钮。
- `annotationLocation(annotation)`：便签/文本框取自身位置，其他标记取选区/笔迹/形状位置。
- `undo(redo)`：提交对应 before/after 或 tombstone，然后定位操作页及位置。失败恢复栈；历史仍仅本次会话有效。
- 选区动作历史为 `{changes:[{before,after}],location?}`，保留局部清除真实位置；拖动和编辑使用 before/after，兼容原笔迹创建的历史格式。
- `editAnnotation(annotation)`：委托原位 TextAnnotations.edit，不再打开输入弹窗。
- `startAnnotationDrag(event,page)`：选词手势期间或形状菜单首笔转发时不介入；其他情况下命中便签/文本框/形状后由页面捕获指针；3px 内视为进入尺寸模式，超过阈值捕获指针并预览位移，松手事务提交、取消恢复。`cancelAnnotationDrag` 清理手势、监听和捕获。
- `drawAnnotations(page)`：重绘标记、批注同色锚点及形状命中区域；note/text DOM 交给原位控制器复用以保留光标。输入区、尺寸手柄和已有取词手势均不被普通拖动劫持。
- `releaseTextSelection()`：指针和触控均已释放时移除 selecting-text；取词期间通过此类关闭所有覆盖元素 pointer-events，取消/窗口失焦也清理。
- `beginShapeFromPointer(event)`：菜单在窗口 pointerdown 捕获阶段关闭并激活后，若原目标尚非墨迹层，转发首次按下到同页画布，保留首笔鼠标/触控绘制。
- `bindInk(canvas,page)`：保留原手绘/形状创建；橡皮擦记录 pointerId/documentId/generation 并捕获指针，通过 eraseSweep 检测前一点到当前点的完整轨迹，连续删除本页所有命中的 pen/shape。stopErasing 在松开/取消/失去捕获或上下文失效时终止；鼠标未按下的移动和其他触点不擦除。
- `pendingEraseIds` / `eraserWrites`：避免异步落盘前反复命中同一对象，复用 writeAnnotations 的串行事务；成功后每对象加入独立历史，undo 等待在途擦除，失败保留原对象并报告错误。
- `shapes.hitEraserSweep(annotation,from,to,width,height,tolerance)`：归一化坐标转页面点单位，使用线段相交/最短距离及矩形/圆形命中；默认由调用者传 18/scale，保护 note/text/文字标记，支持点点击与退化笔迹。

### pdf-text.js / pdf-search.js

- `renderAlignedText(page,content,container,viewport,mount?)`：以原 PDF 字体离线构建官方 TextLayer，mount 验证成功后一次挂载；统一设置字重/斜体等，再一次性快照所有 computed 字宽/字体数值，最后批量写位置/缩放，避免读写交错强制重排。原基线、未旋转尺寸、旋转 CSS、itemIndex→span 映射保留；mount 返回 false 时终止旧任务并返回 null。
- `indexPageText(items)`：生成搜索字符串与每个原始文本片段的范围；换行和有间距片段间插空白，保留字符索引映射。
- `findPageMatches(index,query,{caseSensitive,wholeWord})`：转义查询中的正则字符，支持空白跨片段、大小写及 Unicode 词边界，返回全部匹配范围、parts 和单行摘要。

### selection-actions.js

- `registerSelectionAction(type,create)`：注册创建回调；返回额外字段，或返回 `null` 取消。当前注册 underline/strike/highlight/note，note 从 context 读取 fontSize 并产生空文字草稿。未来同类工具注册后可复用状态、删除和执行逻辑。
- `isSelectionAction(type)`：区分一次性选区动作与手绘/文本框持续模式。
- `overlaps(a,b)`：同页且水平相交、同一文字行的垂直重合判定。
- `subtractSelection(rects,selection)`：从已有标记矩形扣除选中文字对应部分，保留左右未选部分。
- `matchingAnnotations(type,annotations,selection)`：按类型和选区查找未删除标记。
- `selectionActionState(annotations,selection)`：返回所有注册工具的独立按下状态，可同时为 true。
- `planSelectionAction(type,annotations,selection,context)`：无选区空操作；有命中则生成局部移除计划；无命中调用 create 按页生成记录。纯规则不读写数据库，由 PdfViewer 统一提交。

旧版没有 rects 的自由便签仍保留原位、可双击原位编辑，不猜测其文本关联，也不迁移或清除旧记录。

### shapes.js

- `SHAPES`：rectangle/circle/line/arrow 的值、下载图标名、中文标签映射。
- `shapeGeometry(annotation,width,height)`：将归一化 start/end 转为 PDF pt；矩形允许反向拖动，圆形按短边保持正圆，箭头返回主线和两条箭头边。
- `drawShape(context,annotation,width,height)`：绘制 Canvas 路径；PDF 导出复用 shapeGeometry 生成矢量指令，保持几何一致。
- `distanceToSegment(point,start,end)`：命中笔迹/线形状，覆盖采样点之间的笔段。
- `hitShape(annotation,point,width,height,tolerance)`：矩形/圆内及直线/箭头附近命中，供拖动与橡皮擦复用。
- `translateAnnotation(annotation,dx,dy,box)`：在页面边界内平移自身坐标；便签原文 rects 锚点保留，形状尺寸不变。

### archive.js

- `createArchive({includeSecrets,password})`：先等待 flushSettings、flushAnnotations 和 flushTranslationWrites，再创建一致快照、二进制 PDF、SHA-256 清单、异步 ZIP；格式版本 2 保持不变。includeSecrets=false 清除密钥，字号及完整译文保留。
- `keyFor`、`encrypt`、`decrypt`（内部）：PBKDF2-SHA256 250000 次，AES-256-GCM；magic `PBRIDGE1` + 16 字节 salt + 12 字节 IV + 密文。
- `readArchive(blob,password)`：接受格式 1/2，旧版新表补空；验证层级、删除记录所有者、逻辑组根锚点、跨表引用、文件哈希和 PDF 头，全部通过才允许合并。
- 0.1.2 批注校验新增 strike、shape，校验形状枚举、起止点和可选字号/笔宽；兼容旧记录缺省字段。存档和数据库版本不变，新增记录应使用 0.1.2 或更新版本恢复。
- `importArchive(blob,options)`：验证后事务合并；显式本地导入启用 restoreDeleted 恢复备份中存在的已删对象，可恢复设置并刷新缓存；被动云合并不启用此选项。
- `importFritiaSettings(file)`：从 JSON 或原项目 ZIP 中查找旧设置字段，合并 provider，不修改来源文件。
- `auth`、`remoteUrl`、`dav`（内部）：UTF-8 Basic Auth、安全 HTTP(S) 路径与超时请求。
- `testWebDav(config)`：PROPFIND 检查实际浏览器跨域请求。
- `syncWebDav(onStatus)`：禁止重入；GET+校验+本地合并+条件 PUT；不暴露凭据到云端，无强 ETag 时拒绝覆盖已有数据。
- `scheduleSync(onStatus,onError)`：按保存的启用状态设置 30 分钟定时器（最小间隔 5 分钟）。

### utils.js

`uid` 创建 UUID；`esc` 转义 HTML；`sizeLabel`、`dateLabel` 格式化展示；`download` 创建下载链接并延迟释放 Blob URL；`sha256` 算文件摘要；`bytesToBase64` 分块编码；`safeUrl` 只允许 HTTP(S) 且拒绝 URL 中嵌凭据；`errorMessage` 转换取消/超时/网络/接口异常。

- `chooseSaveTarget(filename,{directory})`：由点击处理同步进入原生选址，返回文件/目录句柄或取消 null；API 缺失/NotSupportedError 返回 defaultDownload 标记，不额外提示。SecurityError 不伪装成不支持，不静默重复下载。
- `saveFile(blob,filename,{target})`：校验非空 Blob，写入已获取的句柄，或按 defaultDownload 下载到默认位置；没有预选目标时可获取一次。取消不下载，写失败 abort 并抛错，不重新选择或下载。
- `md5Blob(blob)`：按需加载现有 noble MD5，以 2 MiB 切片更新哈希，输出小写 32 位十六进制；WeakMap 缓存同一 Blob 的计算 Promise，失败移除缓存。不修改文件、不新增依赖。

存档文档可携带 initialMd5，readArchive 校验其可选的 32 位十六进制格式；旧存档缺少字段仍可恢复，在下次重复检测时补算。备份/云快照沿用文档元数据，不改变原有 PDF SHA-256 完整性校验。

### ui/library.js 的 LibraryView

- `constructor/open({folderId}?)/persist`：初始化目录、选择集合和视图/排序偏好，读取一致库状态，修复不存在的目录为根目录。显式 folderId（可为 null）在载入偏好后覆盖目录并清空搜索；没有参数时保留管理页当前目录。偏好仍保存在 settings/library-view。
- `breadcrumbs`：以父 ID 链构建路径，防止循环。
- `render/renderObjects/updateSelection`：页面骨架、文件夹优先的卡片/列表、左上选择框及批量按钮；切换目录/搜索清空选择，排序/视图切换保留选中 ID。
- `action`：分发新建、视图、排序、移动、下载和删除。
- `rename`：沿用文档重命名，并支持文件夹命名。
- `move`：展示根目录和内部文件树，屏蔽选中文件夹及其后代作为目标；在当前目标内新建子目录，确认后调用 moveSelection。
- `remove`：生成并展示删除对象路径清单；确认后等待受影响任务退出，执行精确事务，再协调工作区和重绘。
- `download`：从缓存库状态立即生成选择计划并选址；单文件直接存、两文件共用目录、超过两文件/含目录用 ZIP；无选择器默认下载。保存目录内遇同名文件采用新序号，每份文件经 editedDocumentBlob 合并编辑。

### ui/components.js

`icon` / `illustration` 读取构建时导入的本地图标/插画；`button` / `iconButton` 生成有 aria-label 的按钮；`select` / `selected` / `bindSelects` 实现自绘下拉与键盘选择；`closeMenus` 统一关闭；`toast` 展示临时状态；`modal` 管理焦点环、Esc 和遮罩；`inputDialog` 返回可等待的文本、密码、取消或删除操作。

Apple WebKit 的 PDF 工具栏下拉由 `bindSelects` 临时挂到 body，选项点击及 `closeMenus` 均调用 `restoreAppleMenu`；其他位置和平台仍按原 DOM 层级展示。

`select` 的可选第六参数 fallbackLabel 支持菜单外的当前值；缩放只显示真实比例而不追加选项。没有对应选项时，打开菜单聚焦第一项，支持方向键与 Esc。

`anchoredPopover(anchor,title,body)` 复用 modal 焦点和关闭机制，将浮层固定在按钮下方 8px；限制视口宽高、窗口变化时重定位、关闭后移除监听。只用于翻译设置，不改变其他设置弹窗布局。

### ui/basic-settings.js

- `BasicSettings`：render 生成标题、默认模型、三个默认折叠栏目与教程；section 定位配置，capture 读取表单输入，bindDefault/updateDefault 绑定自绘下拉并只列出已保存完整配置。
- `status`：未配置/未测试/测试中/可连接/连接失败，成功为绿点，tooltip 提供测试时间及百度风格。
- `test`：短句 en→zh-CN 按当前风格验证，按钮旋转等待；凭据变化递增 revision 并 abort，过期成功不覆盖当前状态；输入实时保存账号，测试完成后静默保存有效状态/时间。
- `save(id,silent=false)`：输入/change 和测试状态变化调用 silent=true，按 lastQueued 签名去重、捕获当前不可变值并入队，不弹成功提示；手动保存仍反馈成功。仅选项发生变化才重绘默认选择器，保持用户正在操作的下拉状态。
- `destroy`：捕获并静默保存最后输入，取消全部在途测试，设置 destroyed 标记防止旧回调更新新页面，返回当前写入完成 Promise。
- 教程链接委托 openExternalWebsite，新标签或宿主系统浏览器；密钥眼睛按钮仅切换 input.type。

API 页面紧凑样式只使用 #provider-form 范围选择器：桌面输入 padding 0.55rem / 下拉最小高 2.2rem，手机输入 0.6rem / 下拉 2.4rem；其他页面控件不受此规则影响。

### ui/settings-panel.js

- `bindProviderActions(form,readProvider,onModelSelected)`：设置/启动配置共用；读取当前地址和 Key、官网映射、模型列表请求/选择，设置页选择后自动保存；请求返回时表单已移除或凭据已改变则不填入过期列表。
- `providerMenu()`：复用 custom-select 的自绘服务商菜单、逐行厂商 LOGO，选择后 capture 现有草稿再追加新配置。
- `openSettings(app,tab)`：API、基础翻译、备份、WebDAV、帮助五视图；新增、填写、选择协议/能力/默认、移除均自动持久化；眼睛按钮仅切换输入类型，获取按钮监听当前 URL 输入并在点击时重读；测试不覆盖设置。
- `persistApi` / `autoSaveApi`（openSettings 内部）：capture 从当前表单自身读取协议和字段，使用 apiSnapshot 去重并调用串行 saveSettings；同步配置卡片名称，不重绘输入框。切换子页、配置及关闭窗口均捕获最后输入，自动保存只在失败时报告。
- `saveApi(close)`：顶部“保存当前设置”传 false，底部“保存设置”传 true，均等待真实落盘，前者保持窗口。
- `onboarding(app)`：hideOnboarding 为 false 时显示欢迎→服务商→配置流程，主标题为“纸间 · 文献翻译 & AI 分析”，作者链接通过 openExternalWebsite 打开；“直接进入 APP”与配置按钮居中，偏好开关右下角，新增右上角关闭按钮。关闭本次引导不等于不再显示，只有显式开关控制后续弹出。
- 启动配置复用 bindProviderActions，不添加明文切换；保存时同时更新默认问答与 translationEngine/translationProviderId，保留已有配置列表及其他设置。
- `#onboarding-form [data-action=get-api-key]` 映射官网获取，`[data-action=list-models]` 映射模型列表请求，`.model-list [data-model]` 映射填入当前模型名称；与 #provider-form 共用辅助动作但仅设置页提供眼睛按钮。

### ui/translation-engine.js / providers.js 品牌映射

- `translationEngines(settings)`：所有可用基础 API 和已配置 LLM 映射成 key/name/brand/kind；`translationEngineValue` 读取现有默认，保留 online/basic:/llm: 编码。
- `saveTranslationEngine(key,preferences)`：沿用设置写入队列，只更新选中引擎/明确传入的语言和风格；key 缺省时不改引擎。
- `engineMenu` / `engineTrigger`：自绘两组 listbox、品牌图标和类型；未知品牌复用 bot 图标。MyMemory 使用指定 Meta 图标，不改变请求服务。
- `providerBrand(provider)`：优先匹配配置地址，其次识别代理中的模型/公司名称；自定义未知品牌返回 custom，保存的 UUID 不用于推测公司。

### ui/assistant.js 的 Assistant

- `constructor` / `render`：绑定右栏标签，按渲染 epoch 防止旧异步视图覆盖新视图。
- `renderEngine(settings)`：划词页更新顶部引擎，其他页隐藏；订阅 settings-changed，按内容签名去重，保存时保留焦点，失败恢复已持久化的选项。
- `renderSelection` / `translateSelection`：内存缓存按文档分组；新选区取消旧请求；在线引擎的单词与句子分流，离线引擎全部本地推理。
- `readingFonts`：render 读取 settings 后 update；renderSelection、renderFull、全文历史/流式挂载后 apply，控制三块独立字号，不触发翻译或重建整个助手视图。
- `settings`：按钮下方的语言/风格浮层，仅全文/问答页另显示原样式的引擎下拉；与顶部引擎共用保存规则。
- `renderFull` / `startFull`：全文参数、历史、按文档分组的独立任务、流式落盘和阶段反馈。
- `setFullCollapsed(documentId,collapsed)`：首段译文保存后动画折叠参数；更新可展开的 sticky 进度栏，折叠内容 inert 防止焦点进入；手动展开不会在后续流式增量中重新折叠。
- `exportTranslation`：按译文记录互斥，复用或新建译文 PDF；写入关联根 ID；打开或经 editedDocumentBlob 合并译文编辑后下载。全文请求直接返回 PDF 时不重复进入本地转换分支。
- `renderChat` / `appendMessage`：按 rootId / conversationId 加载消息，显示部分结果和恢复副本。
- `appendMessage` 对仍有活动任务且尚无内容的助手消息显示“正在思考”环；onDelta 替换为内容，失败/停止后按最终状态渲染。
- `updateExportProgress()`：按 result-toolbar 的 translationId 读取转换互斥集合，设置打开/下载按钮的旋转图标、aria-busy 和禁用状态；转换的 try/finally 及历史切换均同步调用。
- `createThread`：创建独立会话并保存当前会话选择。
- `sendMessage`：先保存提问与回复占位，再组织完整文档及全部历史；每段流式先 patch，再更新当前匹配面板。
- `stopForDeletion(plan)`：中止选中 PDF 的全文任务，以及无存活组成员的聊天任务，并等待完成信号；保留其他文档/组任务。
- 原文物理记录删除后，问答通过 contextDocument 使用存活文件，完整历史仍按稳定 rootId 关联。下载结果时复用预选句柄，避免首次冷加载丢失用户点击授权。
- `needsDocument`、`copy`、`speak`：空态、剪贴板、系统语音朗读辅助。

### main.js 的 App（主入口职责）

| 方法 | 功能 |
| --- | --- |
| constructor / init | 初始化状态、数据库、界面、持久存储请求、恢复标签/对话和首次引导 |
| mount / bind / action | 生成静态界面骨架、委托动作、导入拖放、快捷键、尺寸变化 |
| importFiles(files,{folderId}?) | 捕获文件列表/目标目录，单页面队列串行处理；可用时以 Web Locks 同源锁协调多标签页，再委托 performImportFiles |
| performImportFiles / confirmDuplicate | 计算原始 MD5、全库匹配；重复时显示是/否，否及关闭跳过当前文件，是追加“副本”并创建独立 id/rootId；校验并事务入库后打开，批量目标目录保持最初选择 |
| importGenerated | 验证生成的 PDF，保存为共享原文 rootId 的新文档 |
| openDocument / performOpenDocument / closeDocument | 进行中 Promise 锁定第一次切换，后续点击不打断；加载后复查存在性，关闭只移除标签 |
| saveWorkspace | 保存标签、活动 PDF 和每个文档活动对话 |
| renderTabs / renderToolbar / toolButton | 单行文件卡片、指定顺序的工具条、颜色和激活反馈 |
| updateToolButtons | 依据选区规则同步多个按钮按下状态，不重建工具栏或打断选区 |
| updateHistoryButtons | 根据阅读器历史状态同步撤销/重做按钮禁用状态 |
| setTool / colorPicker / saveToolOptions | 选区动作或持续工具分发，颜色/形状与 pt 滑块浮层，保存后续工具偏好 |
| changeZoom / setPage | 比例、跳页和延迟保存滚动位置 |
| showReader / showSecondary | 工作区与管理页之间切换 |
| showLibrary / showRecords | 从阅读区进文件库时读取当前文档的最新 folderId，无活动文档传 null；管理页刷新保留目录。全文历史独立展示 |
| documentText | 顺序提取全文，缓存最近一份文本并释放临时 PDF Worker |
| downloadCurrent | 点击后先选址，再读 Blob/懒加载导出模块；保存互斥，每次操作只保存一次 |
| reload / refreshAssistant | 导入、设置、云同步后的界面刷新 |
| prepareLibraryDeletion / afterLibraryDeletion | 等待文件切换和受影响生成任务；删除后清理已删对象的标签/缓存及失效工作区引用 |
| updateSaved / setSyncStatus | 持久化提交及同步状态展示 |

### pdf-links.js / ui/open-pdf.js

- `parsePdfLink(value,rename?)`：校验 HTTP(S) 完整链接、禁止内嵌凭据；允许无后缀、查询参数和片段，从重命名或解码 URL 末段生成安全 basename，补齐固定 .pdf 后缀。返回 `{url,filename}`，不发网络请求，是否为 PDF 由后续解析决定。
- `OpenPdfMenu.toggle/close`：在触发按钮下方显示三项菜单，更新 ARIA、键盘焦点及左右视口约束，点击外部/Esc/尺寸改变时关闭；本地项同步触发已有文件输入。
- `openLibrary`：读取目录/文档一致快照，复用 folder-tree 布局递归展示可折叠目录、文件按钮；按名称文件夹优先，避免循环，点击文件复用 app.openDocument，进行中禁止重复打开。
- `openLink`：外部链接/重命名表单及只读后缀；禁用重复提交，fetch 60 秒超时、关闭取消、不携带凭据，正常跟随重定向；响应直接作为内存 Blob/File 交给 importFiles 验证/密码流程并显式入根目录，不触发本地下载/上传。失败不产生占位文件；成功打开沿用原阅读器和文档管理。

### 阅读字号：settings.js / ui/reading-fonts.js

- `READING_FONT_LIMITS` / `normalizeReadingFontSizes(raw)`：定义 70/180/10，校验并限制三组数值，旧配置回到 100。
- `adjustReadingFontSize(area,direction)`：校验目标及正负方向，通过 saveSettings 函数更新在队列提交时读取最新值，保留其他区域及配置。
- `readingFontButtons(area)`：生成缩小/加大两按钮，复用下载的 a-arrow-down/up，提供区域独立 ARIA 名称。
- `ReadingFonts.constructor/update/apply`：在 assistant-content 委托一次点击，收到设置后更新 CSS --reading-font-scale 和 disabled。仅作用 source-text、selection-result、full-result；绝对内联字号用变量缩放一次，重绘不累乘。

### ui/pdf-navigation.js 的 PdfNavigation

- `constructor(root,{navigate,onMode,error,search,navigateMatch})`：模式为 bookmarks/thumbnails/search/关闭，持有当前文档搜索条件及临时结果。
- `stopRendering()`：增加世代号、断开观察器、取消临时缩略图任务。
- `setDocument(pdf)`：切换来源、取消旧搜索并清空旧结果；无文档关闭导航。
- `toggle(mode)` / `setMode(mode)` / `close()`：工具按钮切换、顶部页签直达模式或关闭。桌面触发布局调整，窄屏保持渲染宽度。
- `render()`：缩略图模式建立每页按钮并观察可见项；书签读取目录树按深度缩进，getDestination 解析命名目标，getPageIndex 解析页面引用。
- `renderThumbnail(button,pdf,generation)`：约 150 CSS px 宽、1.5 倍像素渲染，生成本地 JPEG 后释放临时 Canvas；世代号阻止旧文档回填。
- `setPage(page)`：同步高亮与 aria-current，不写入其他用户数据。
- `renderSearch(content)`：输入、查找按钮、两个自绘筛选开关、进度和结果容器。
- `startSearch()`：冻结本次条件并取消上次任务，调用阅读器全页扫描，阻止切换 PDF 后旧结果回填。
- `updateSearchResults()`：工作中显示环形进度；完成后每条结果一行，点击调用 navigateMatch。关闭导航或切换页签保留当前 PDF 的完成结果，切换 PDF 清除。

### 独立布局交互

`initDesktopLayout()` 只在桌面启用分隔条 pointer/键盘交互，更新 `--reader-share`。

`initMobileLayout({closeNavigation})` 管理视口、分屏和窄屏浮窗外点击；只给 `.mobile-nav` 的 pane 按钮绑定切换，避免 HTML 状态属性被误当按钮。`setMobilePane(pane)` 切换阅读/助手，不改桌面列宽。

`data-pdf-nav` 存在时，桌面仍收窄功能侧栏并插入导航列；窄屏使用绝对定位浮窗，不显示左功能栏，不改变 PDF 宽度或 fit 比例。桌面查找列稍宽以容纳同一行筛选开关。

≤960px 的 `.mobile-header` 显示“纸间 · 文献翻译”及原打开菜单按钮；`.document-bar > .open-pdf` 在 mobile.css 中隐藏。桌面仍显示文件卡片行右侧入口、隐藏 mobile-header，desktop.css 不受这次修订影响。

## DOM 页面功能映射

| DOM / 标识 | 用户功能 | 处理模块 |
| --- | --- | --- |
| #app / .sidebar / .main-nav | 品牌、PDF 阅读、文档、翻译记录、设置/同步入口 | App.mount / action |
| html[data-apple-webkit] / [data-apple-touch] / .apple-select-portal | Apple 专用文字/触控规则及位于页面上方的工具栏比例菜单 | compat/apple-webkit / apple-webkit.css |
| #workspace / .reader-panel / .assistant-panel | 左 PDF 右翻译的工作区 | desktop/mobile |
| #split-handle | 拖动或方向键调整左右宽度 | desktop.js |
| #document-tabs / .document-tab | 已打开 PDF 的单行卡片、关闭和激活；页码保留在工具栏 | App.renderTabs |
| #pdf-input | 隐藏本地多文件选择器 | App.importFiles |
| [data-action=duplicate-yes] / [data-action=duplicate-no] | 重复 MD5 确认；是创建独立副本，否/关闭取消当前文件 | App.confirmDuplicate |
| [data-action=open-pdf] / .open-pdf-menu / [data-open-pdf] | 阅读栏和手机顶部打开菜单：本地、文档库、链接 | OpenPdfMenu |
| .open-document-tree / .tree-document | 可折叠文档树、点击已有 PDF 打开 | OpenPdfMenu.openLibrary |
| #external-pdf-form / .pdf-filename-field / .external-pdf-status | 链接、可选重命名及固定后缀、加载/错误反馈 | OpenPdfMenu.openLink / parsePdfLink |
| #pdf-toolbar / [data-select=zoom] / #page-input | 阅读缩放、导航、编辑工具、颜色指示和导出 | App.renderToolbar |
| .zoom-group .custom-select / .select-menu | 触发器宽度桌面 7rem、移动 6.3rem，展开菜单 8rem；不按选项文字自动收缩 | base.css / mobile.css（Apple portal 继承自身定位尺寸规则） |
| [data-select=zoom] .select-trigger | 非标准比例由 select 的 fallbackLabel 显示，菜单固定七项；减号先于加号 | App.renderToolbar / components.select |
| [data-action=thumbnails] / [data-action=bookmarks] / [data-action=search-pdf] / #pdf-navigation | 统一导航入口；桌面分栏或移动浮窗 | PdfNavigation / App |
| .pdf-thumbnail / .pdf-bookmark | 缩略图跳页、显式/命名书签跳页 | PdfNavigation |
| .pdf-navigation-tabs / .navigation-search-form / .search-filters | 三模式页签、搜索输入/按钮、大小写与全字开关 | PdfNavigation |
| .navigation-search-status / .search-result / .search-highlights | 环形进度、单行全部结果、独立浅黄色文本高亮 | PdfNavigation / PdfViewer |
| [data-annotation-id] / .annotation-shape-handle | 批注/文本框/形状拖动命中区 | PdfViewer |
| [data-action=undo] / [data-action=redo] | 有效历史操作与自动位置跳转，无历史禁用 | App / PdfViewer |
| [data-action=tool-strike] / [data-action=tool-shape] | 选中文字删除线 / 拖动绘制形状 | selection-actions / PdfViewer |
| #pdf-scroll / .pdf-page | 滚动阅读、页面占位与画布 | PdfViewer |
| .textLayer / .annotations / .ink-layer | 真正可选文字、标注和手绘命中层 | PdfViewer |
| #reader-empty | 空态导入与拖放提示 | App |
| #document-status / #save-status | 页数、大小、本地提交状态 | App |
| [data-assistant-tab] | 划词 / 全文 / AI 问答切换 | Assistant |
| #translation-settings | 翻译引擎和风格设置浮层 | Assistant.settings |
| [data-font-area=source/selection/full] / [data-font-direction] | 原文/划词译文/全文译文的独立字号增减，70%–180% 边界禁用 | ReadingFonts / adjustReadingFontSize |
| .source-text / .reading-output / --reading-font-scale | 只缩放阅读内容及 Markdown/词典层级，聊天与导出不受影响 | reading-fonts.js / base.css / mobile.css |
| #selection-engine / .engine-group-title / .engine-kind | 划词顶部引擎、机翻/AI 分组与随右栏宽度隐藏的类型文字 | Assistant.renderEngine / translation-engine.js / desktop.css / mobile.css |
| #selection-result | 在线词典或句子结果，不持久化 | Assistant.renderSelection |
| .dictionary-credit | 主要词典、中文词义与详细解释翻译来源、备选署名/词条/许可证；dictionaryLink 仅允许无凭据 HTTPS | Assistant.renderSelection / dictionaryLink |
| #full-stage / #full-result | 全文状态和完整 Markdown 结果 | Assistant.startFull |
| .full-markdown-block / 内部 span 片段 | 稳定的 Markdown 块/长段内联片段、屏幕外绘制优化 | FullMarkdown / MarkdownBlocks |
| .pdf-internal-links / .pdf-internal-link | PDF 内部引用的可访问键盘链接、悬停和坐标命中；指针交给原文字层 | mountInternalLinks |
| #full-controls / .full-summary / .full-toggle | 参数折叠动画、吸顶进度栏、停止与展开/收起按钮 | Assistant.setFullCollapsed |
| [data-select=translation-history] | 当前 PDF 的旧译文选择 | Assistant.renderFull |
| [data-select=chat-thread] / #chat-messages | 当前根文档的会话与全部消息 | Assistant.renderChat |
| #chat-form / #chat-input | 问题输入、API 选择、发送和停止 | Assistant.sendMessage |
| .message-thinking / [data-action=open-translated][aria-busy=true] | AI 首段回复前思考状态 / PDF 转换忙碌状态 | Assistant |
| #library-view / #library-search / #document-grid | 当前目录卡片/列表、名称筛选 | LibraryView |
| .library-check / .batch-actions | 多选及移动/下载/删除按钮 | LibraryView |
| .library-breadcrumbs / .library-view-tools | 目录导航、排序方向/依据、视图切换 | LibraryView |
| .folder-tree / .folder-create-row | 移动目标树和选中目录内创建子文件夹 | LibraryView.move |
| .delete-object-list / [data-action=confirm-delete] | 已审核路径清单、明确确认入口 | LibraryView.remove |
| .record-list / [data-record] | 打开对应 PDF 的全文历史 | App.showRecords |
| #overlay-root / .modal | 通用焦点受控弹窗、设置及密码 | components |
| .annotation-box / .annotation-input | 原位内容、实体/虚拟边框、双击输入 | TextAnnotations.render/input |
| .annotation-resize / .annotation-move | 左右宽度及顶部移动手柄 | TextAnnotations.resize / PdfViewer.startAnnotationDrag |
| .annotation-tools / [data-text-action] | 对象内部定位同步浮栏；尺寸模式四/五按钮，文字模式仅字号增减/删除 | TextAnnotations.showToolbar/action/positionToolbar |
| .note-anchor / .is-emphasized | 批注同色源文下划线与悬停强调 | PdfViewer.drawAnnotations / TextAnnotations.emphasize |
| #settings-content / #provider-form | 多 API 配置及能力设置 | settings-panel |
| [data-action=settings-basic] / [data-select=basic-default] | 基础翻译子页面与默认模型 | BasicSettings |
| .youdao-dictionary-note | 内置有道词典的网页限制及客户端 CORS 代理说明 | BasicSettings.render |
| .basic-summary / #basic-body-{id} / .basic-status | 单行折叠标题、展开配置及状态绿点 | BasicSettings.render/status |
| [data-basic-form] / [data-action=test-basic] / [data-action=show-basic-secret] | 账号/密钥、连接测试、保存及可见性 | BasicSettings.test/save |
| #cloud-form | WebDAV 账号、测试、同步和开关 | settings-panel / archive |
| #archive-input | 本地 ZIP / 加密存档选择 | settings-panel / archive |
| #onboarding-content / #onboarding-form / [name=hideOnboarding] | 启动引导步骤、右下角“不再显示”开关及标准关闭按钮 | onboarding |
| .welcome-actions / [data-author-link] | 居中进入按钮、Bilibili 作者新标签链接 | onboarding / openExternalWebsite |
| [data-action=save-current-settings] / .api-heading-actions | “添加”左侧保存当前配置并保留窗口 | saveApi(false) |
| .spinner / .icon-spin / --loading-spin-duration | 统一 1.2s 旋转；减少动态效果下 1.8s，避免 0.01ms 无限循环 | base.css |
| [data-select=provider-preset] / [data-action=add-provider] | 添加按钮下方的八种厂商模板菜单 | providerMenu / openSettings |
| #provider-api-key / [data-action=toggle-api-key] / [data-action=get-api-key] | Key 隐藏/显示、按当前 Base URL 打开官网 | openSettings / openProviderWebsite |
| #pdf-scroll.selecting-text | 鼠标/触控取词期间禁止覆盖元素交互 | PdfViewer.releaseTextSelection |
| #color-popover / #tool-size / .shape-options | 颜色、字号/笔宽滑块、右侧 pt 数值、四种形状选择 | App.colorPicker |
| .mobile-nav / [data-mobile-pane] | 手机阅读、翻译、文档与设置单页导航 | mobile.js |
| #toast-root | 保存、失败、导入等实时反馈 | toast |

## 核心数据流

```mermaid
flowchart LR
  A[本地 PDF] --> B[PDF.js 校验]
  B --> C[IndexedDB files + documents]
  C --> D[可见页面 Canvas + TextLayer]
  D --> E[选择文本]
  E --> F[词典 / 在线翻译 / LLM]
  C --> G[全文翻译与 AI 问答]
  G --> H[全文合并保存；问答逐段保存]
  H --> I[Markdown + KaTeX]
  I --> J[译文 PDF]
  J --> C
  C --> K[ZIP / 加密备份 / WebDAV]
```

模型返回内容不是可信 UI；必须通过统一 Markdown 清理函数。文件名、对话名和词典结果必须 HTML 转义。导入记录先验证；所有图片/图标从本地打包资产加载。未来改动不能引入清库迁移或未等待提交的“已保存”提示。
