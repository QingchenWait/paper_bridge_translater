# 项目结构与开发逻辑

适用版本：0.1.3。入口为 `index.html` → `src/js/main.js`。这是静态前端工程，**没有 `main.py`，也没有 Python 运行时或后端函数**；与原需求中 main.py 对应的应用协调职责由 `App` 类承担。

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
│  │  ├─ icons/*.svg               54 个已下载 Lucide 图标，清单见下
│  │  └─ art/{open-book,sparkles}.png
│  ├─ js/
│  │  ├─ main.js                   应用协调、标签、工具栏、文档管理
│  │  ├─ storage.js                七表 IndexedDB、事务写入和合并
│  │  ├─ settings.js               多 API 兼容配置、归一化、默认服务
│  │  ├─ utils.js                  转义、UUID、下载、哈希、格式化
│  │  ├─ text.js                   PDF 排版清洗、单词判断、按字节切片
│  │  ├─ translation.js            免费词典、词形补充、MyMemory 翻译
│  │  ├─ llm.js                    Chat/Responses、文件输入、SSE、原生 PDF
│  │  ├─ markdown.js               Markdown/KaTeX/高亮/安全 HTML
│  │  ├─ pdf.js                    PDF.js 加载、文本提取、可见页和批注交互
│  │  ├─ pdf-text.js               同源字体、准确尺寸/旋转与字宽/基线对齐
│  │  ├─ pdf-search.js             文本索引、字符位置映射与大小写/全字匹配
│  │  ├─ selection-actions.js      可注册的选区动作、命中状态及局部清除规则
│  │  ├─ shapes.js                 形状选择清单、共享 PDF 点坐标几何及画布路径
│  │  ├─ pdf-export.js             带批注 PDF、视觉版全文译文 PDF
│  │  ├─ archive.js                ZIP、AES、校验、迁移、WebDAV
│  │  └─ ui/
│  │     ├─ components.js          图标、按钮、下拉、弹窗、提示、输入框
│  │     ├─ assistant.js           划词、全文、AI 会话与任务状态
│  │     ├─ pdf-navigation.js      缩略图、内置书签、目标解析及导航渲染生命周期
│  │     ├─ settings-panel.js      设置四页、首次引导、迁移入口
│  │     ├─ desktop.js             桌面状态和分栏调整独立交互
│  │     └─ mobile.js              移动端分屏、视口；保留阅读选区供标注
│  └─ styles/
│     ├─ base.css                  Tokens、公共组件、所有功能模块通用样式
│     ├─ pdf-text-layer.css        PDF.js 文字层必要规则及许可证来源注释
│     ├─ desktop.css               >960px 桌面横屏布局
│     └─ mobile.css                ≤960px 移动竖屏布局
├─ public/
│  ├─ fonts/{NotoSansSC-Regular.otf,LICENSE}
│  ├─ pdfjs/{cmaps,standard_fonts,wasm}/   构建前从锁定的 PDF.js 包复制
│  └─ licenses/                    构建时复制项目与素材许可证
├─ tools/
│  ├─ download-assets.ps1          下载开源图标、插画、字体与文档
│  ├─ prepare-assets.mjs           拷贝 PDF.js 资源和分发许可证
│  ├─ check.mjs                    递归进行 JavaScript 语法检查
│  └─ verify-dist.mjs              生产子路径静态部署、无 CDN、中文导出检查
├─ tests/
│  ├─ core.test.mjs                数据、清洗、SSE 和存档协议测试
│  ├─ selection-actions.test.mjs   选区规则、多类型/多页与局部清除测试
│  ├─ save-file.test.mjs           单次保存、取消和写失败不重复下载测试
│  ├─ shapes.test.mjs              形状几何、删除线及字号规则测试
│  ├─ search-geometry.test.mjs     搜索过滤、跨文本片段、移动边界与命中测试
│  └─ e2e/
│     ├─ app.spec.js               原有合成 PDF 的真实浏览器功能回归
│     ├─ optimizations.spec.js     状态反馈、松手翻译、绘图尺寸和导航回归
│     └─ reader-refinements.spec.js 字形坐标、旋转/裁切、高 DPI、拖动/历史及搜索浮窗
├─ dist/                           构建产物，不手工编辑
├─ node_modules/                   npm 依赖，不手工编辑
├─ .cache/                         npm 缓存、开发期官方文档，不进入发布
└─ test-results/                   测试截图、失败 trace，不属于用户数据
```

图标文件名（均为 `.svg`）：`arrow-left`、`arrow-up-right`、`book-open`、`bot`、`check`、`chevron-down`、`chevron-left`、`chevron-right`、`circle-alert`、`circle-help`、`cloud`、`copy`、`database`、`download`、`eraser`、`expand`、`external-link`、`eye`、`file-text`、`folder-open`、`highlighter`、`history`、`key-round`、`languages`、`loader-circle`、`menu`、`message-square`、`minus`、`monitor`、`panel-left-close`、`pencil`、`plus`、`redo-2`、`refresh-cw`、`search`、`send`、`settings-2`、`shield-check`、`smartphone`、`sparkles`、`stop-circle`、`trash-2`、`type`、`underline`、`undo-2`、`upload`、`volume-2`、`x`。

`public/pdfjs` 内的文件清单由 `node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm}` 与 package-lock 唯一决定，属于供应商静态数据而非应用模块；构建无 CDN 依赖。

0.1.2 追加的六个图标文件：`strikethrough.svg`、`shapes.svg`、`rectangle-horizontal.svg`、`circle.svg`、`gallery-vertical-end.svg`、`bookmark.svg`。直线、箭头和转换进度复用已有 minus、arrow-up-right、loader-circle 图标。

## 数据模型与不变量

数据库名 `paper-bridge`，版本 1；所有对象仓库以 `id` 为 keyPath。

| 表 | 核心字段 | 用途 / 不变量 |
| --- | --- | --- |
| documents | id, rootId, name, pages, size, page, zoom, createdAt, updatedAt, translationId? | 标签、管理栏、阅读进度；原文 rootId=id，译文指向原文根 ID |
| files | id, blob, updatedAt | id 与 documents 一致；原始或生成 PDF 不可变，避免编辑破坏源文件 |
| annotations | id, documentId, page, type, color, rects/points/x/y/text, selectedText?, fontSize?, strokeWidth?, shape?/start?/end?, deleted, recovered? | 下划线/删除线/高亮/新批注保存选区 rects；笔迹 points 与形状 start/end 使用归一化坐标；尺寸以 pt 保存；局部移除裁剪 rects，清空使用 tombstone |
| conversations | id, rootId, title, createdAt, updatedAt | 逻辑文档下多条独立会话；原文和译文共享 |
| messages | id, conversationId, role, content, status, error?, createdAt, updatedAt, recovered? | 用户先保存再请求；助手逐增量保存；不按轮数裁剪 |
| translations | id, documentId, rootId, content, language, providerId, status, error?, output, generatedDocumentId? | 多次全文翻译记录及 PDF 产物关联 |
| settings | id, value, updatedAt | `app` 存 API、翻译和 WebDAV；`workspace` 存标签、活动文档和各文档活动对话；`annotation-tools` 存 colors 和 noteSize/textSize/penWidth/shape 偏好 |

`status` 常见值：`streaming`、`complete`、`stopped`、`error`；从旧会话恢复的未完成 streaming 内容如实显示未完成，不在启动时批量篡改状态（避免影响另一个仍活动的窗口）。

所有恢复冲突副本 ID 为 `原ID-recovery-更新时间`，相同旧版本只保留一次。批注副本也保留在数据库和页面，可通过撤销/编辑处理，不会丢掉已有内容。文件 Blob 不随 metadata 合并被覆盖。

## 内部模块 API / 函数

### storage.js

- `database()`：懒打开数据库，只在 upgrade 创建缺失结构；升级被其他窗口阻挡时发出事件。
- `all(store)`、`get(store,id)`：读取记录。
- `put(store,row)`：克隆对象、设置更新时间并等待事务提交。
- `patch(store,id,values)`：在同一事务里读取再合并，避免覆盖无关字段。
- `addDocument(blob,name,pages,rootId?)`：文档 metadata 和文件 Blob 在同一事务写入。
- `snapshot()`：单个只读事务得到所有表的一致快照。
- `mergeSnapshot(data,{restoreSettings})`：跨表原子合并，保留冲突内容；可选合并设置/API；错误回滚。
- `requestPersistence()`：请求浏览器持久存储，返回实际授权结果，不承诺浏览器不会被主动清空。

### settings.js

- `PROVIDERS`：首次引导用服务商模板。OpenAI 和 MiMo 模型名称由用户填写。
- `normalizeSettings(raw)`：兼容海姆休息室单 API 和多 API 格式；规范化 URL、去重 provider ID、同步默认三字段。
- `translationProviderId`：划词/句子翻译专用 API 偏好；旧数据缺省取默认 API，不修改 `defaultChatProviderId`。
- `getSettings()`、`reloadSettings()`：读取/重载配置缓存。
- `saveSettings(next)`：先提交存储再更新缓存和派发 `settings-changed`。
- `getProvider(settings,id?)`：选择 API，缺少地址或模型时给出明确错误。

### text.js / translation.js

- `cleanPdfText(input)`：检测连续行号、修复断行连字、过滤数字引用、合并空白；保留公式上标与年份。
- `isSingleWord(text)`：英文单词（可含连字或撇号）走词典，其余走句子翻译。
- `splitForTranslation(text,byteLimit=450)`：按 Unicode 码点切片，以 UTF-8 字节限制请求，不破坏代理对。
- `CLEANING_INSTRUCTIONS`：统一 LLM 排版修复和文档内指令隔离提示。
- `onlineTranslate(text,source,target,signal)`：按段请求 MyMemory，验证服务状态/额度，支持超时和取消。
- `lookupWord(word,signal,onUpdate)`：Free Dictionary/Wiktionary REST 英文定义并行竞速，中文与词形独立并行；增量回调显示先到结果，单源超时不阻断其他来源。仅中文可用时说明缺少详细词典，不查询 LLM。
- `dictionaryJson(url,signal)` / `plainText(html)`（内部）：6.5 秒独立词典超时，提取词条 HTML 的纯文字。
- `LANGUAGES`：中简/中繁/英/日/韩/法/德/西的展示和 API 代码映射。

### llm.js

- `headers(provider)`：按服务组装 JSON 与 Key 头，兼容 MiMo `api-key`。
- `sseEvents(body)`：流式 UTF-8 解码；支持分块 CRLF、多行 data、尾包，释放 reader 锁。
- `extractText(json)`：Chat 与 Responses 非流式文本统一提取。
- `requestLlm(options)`：构造协议请求，可附整份 PDF；处理 Markdown 增量、完成标记、错误、截断与原生 PDF 容器文件。`onDelta` 是异步回调，必须 await 持久化。
- Chat 兼容文件回退：只在 400 且错误匹配 `file must have a file_id or file_data` 时，从 `file: {filename,file_data}` 改为文件部分的顶层字段后重试一次。文件数据、完整历史、服务地址和凭据保持一致；不扩大到其他错误或自动截断/降级。
- `testProvider(provider,signal)`：短文本响应测试，不设置可能破坏结构的输出截断。
- `listModels(provider)`：读取 `/models`，超时后报告错误。

### markdown.js / pdf-export.js

- `renderMarkdown(text)`：Markdown + KaTeX + 代码高亮后 DOMPurify 清理，允许所需的安全字体、颜色、表格样式。
- `mountMarkdown(element,text)`：将安全内容放入容器，链接隔离打开；远程图片改占位，避免隐式请求。
- `loadFont()`（内部）：第一次含文本的批注导出加载 Noto 字体。
- `exportAnnotatedPdf(blob,annotations,sourcePdf)`：读取原 PDF，按 viewport 转换归一化坐标，绘制高亮、下划线、删除线、指定笔宽笔迹及形状矢量轮廓，中英文字使用记录的 fontSize；保持原文件不变。
- `markdownToPdf(text,onProgress)`：离屏渲染译文，逐块/逐页生成 PDF；过高块分片，逐页释放画布。输出为栅格视觉 PDF。

### pdf.js

- `loadPdf(blob,onPassword)`：传入本地二进制及本地 CMap/字体/WASM；密码通过回调获取；为 PDF.js 6 的 loading task 提供统一 destroy 适配。
- `extractPdfText(pdf,onProgress)`：顺序获取每页文字，按位置移除页边纯数字行号，附页码。
- `PdfViewer.constructor`：绑定 Pointer/Touch 按下、松开、取消和键盘释放；仅跟踪 PDF 选择手势，selectionchange 只更新选区状态。文档外松手也可完成从 PDF 开始的选择，多触点未全部离开时不翻译。
- `queueSelectionTranslation(delay)`：无活动指针/触控时才提交；鼠标松开立即提交，触控结束延迟 60ms 等待原生选区稳定，同一完成选区去重。
- `setDrawingOptions(options)`：同步后续批注/文本框字号、手绘笔宽和形状类型；绘制开始时冻结参数，不修改已有记录。
- `open(doc,pdf)`：取消旧渲染、切换文档和批注。
- `layout()`：计算比例、建立页面占位、观察可见页、记录滚动页码和已布局宽度/DPR。主入口仅在尺寸或 DPR 变化时请求 fit 重排，避免延迟清空选区。
- `renderPage(number,generation)`：返回或复用该页完整绘制 Promise，供可见页加载与搜索/历史精确定位等待文字层就绪。
- `paintPage(number,generation)`：建立画布/文字/批注/搜索/手绘层，防止旧任务回填；延续原超采样与 600 万像素预算。调用 renderAlignedText 保持字体、尺寸、裁切/旋转/UserUnit 一致；加载后重绘搜索标记。
- `goTo(page)`、`setZoom(zoom)`：页码边界、滚动和重新布局。
- `goToLocation(page,rect)`：先等待页面就绪，再按归一化位置滚动纵/横轴并更新页码。
- `getPageContent(number)`：按当前 PDF 缓存文本提取 Promise，切换文档清除。
- `search(query,options,{signal,onProgress})`：逐页收集全部匹配，支持取消及页数进度；结果仅在内存，空查询清除高亮。
- `matchRects(match)`：按 itemIndex/字符范围创建真实 DOM Range，返回匹配文字的归一化矩形。
- `drawSearchMatches(page)` / `revealSearchMatch(match)`：绘制独立浅黄标记；点击结果定位实际文字而非只跳到页首。
- `setTool(tool,color)`：切换鼠标命中层；文本框/手绘/橡皮擦/形状使用 Canvas 命中层，选择工具保留文字选择。
- `captureSelection({translate=false})`：裁切 Range 与文字 span 的交集，转换归一化坐标，刷新按钮状态；仅明确 translate=true、没有按住的指针且内容未提交过时调用翻译回调。
- `clearSelection(clearNative)`：清空选区与按下状态，按需释放浏览器选区。
- `applySelectionAction(type,color)`：按注册规则添加或局部清除；空选区不执行，互斥防重复，完成后释放；批注输入取消不创建记录。
- `commitAnnotationChanges(rows)`：一次 annotations 事务提交同一操作的所有页面；提交成功再更新当前文档和绘制。
- `addAnnotation(value)`：先保存后绘制，记录当前文档撤销栈。
- `historyState()` / `notifyHistory()`：返回当前文档 undo/redo 可用性；空栈或提交中禁用按钮。
- `annotationLocation(annotation)`：便签/文本框取自身位置，其他标记取选区/笔迹/形状位置。
- `undo(redo)`：提交对应 before/after 或 tombstone，然后定位操作页及位置。失败恢复栈；历史仍仅本次会话有效。
- 选区动作历史为 `{changes:[{before,after}],location?}`，保留局部清除真实位置；拖动和编辑使用 before/after，兼容原笔迹创建的历史格式。
- `editAnnotation(annotation)`：文本或便签编辑/删除回调，纳入历史。
- `startAnnotationDrag(event,page)`：命中便签/文本框/形状后由页面捕获指针；3px 内仍视为点击编辑，超过阈值预览位移，松手事务提交、取消恢复。`cancelAnnotationDrag` 清理手势、监听和捕获。
- `drawAnnotations(page)`：重绘标记和带 touch-action 的透明形状命中区域；字体/笔宽继续按已有数据绘制。
- `bindInk(canvas,page)`：原手绘/形状创建保留；橡皮擦按笔迹线段或形状几何命中并删除整个对象，纳入历史。

### pdf-text.js / pdf-search.js

- `renderAlignedText(page,content,container,viewport)`：从 PDF.js 已加载字体取得同源字体/字重/斜体，统一文档语言；保留官方 TextLayer 并校正实际 DOM 字宽、精确位置和基线，显式设置未旋转页面尺寸并应用旋转 CSS。返回文字段与 itemIndex→span 映射供搜索定位。
- `indexPageText(items)`：生成搜索字符串与每个原始文本片段的范围；换行和有间距片段间插空白，保留字符索引映射。
- `findPageMatches(index,query,{caseSensitive,wholeWord})`：转义查询中的正则字符，支持空白跨片段、大小写及 Unicode 词边界，返回全部匹配范围、parts 和单行摘要。

### selection-actions.js

- `registerSelectionAction(type,create)`：注册创建回调；返回额外字段，或返回 `null` 取消。当前注册 underline/strike/highlight/note，note 从 context 读取 fontSize。未来同类工具注册后可复用状态、删除和执行逻辑。
- `isSelectionAction(type)`：区分一次性选区动作与手绘/文本框持续模式。
- `overlaps(a,b)`：同页且水平相交、同一文字行的垂直重合判定。
- `subtractSelection(rects,selection)`：从已有标记矩形扣除选中文字对应部分，保留左右未选部分。
- `matchingAnnotations(type,annotations,selection)`：按类型和选区查找未删除标记。
- `selectionActionState(annotations,selection)`：返回所有注册工具的独立按下状态，可同时为 true。
- `planSelectionAction(type,annotations,selection,context)`：无选区空操作；有命中则生成局部移除计划；无命中调用 create 按页生成记录。纯规则不读写数据库，由 PdfViewer 统一提交。

旧版没有 rects 的自由便签仍保留原位、可点击编辑，不猜测其文本关联，也不迁移或清除旧记录。

### shapes.js

- `SHAPES`：rectangle/circle/line/arrow 的值、下载图标名、中文标签映射。
- `shapeGeometry(annotation,width,height)`：将归一化 start/end 转为 PDF pt；矩形允许反向拖动，圆形按短边保持正圆，箭头返回主线和两条箭头边。
- `drawShape(context,annotation,width,height)`：绘制 Canvas 路径；PDF 导出复用 shapeGeometry 生成矢量指令，保持几何一致。
- `distanceToSegment(point,start,end)`：命中笔迹/线形状，覆盖采样点之间的笔段。
- `hitShape(annotation,point,width,height,tolerance)`：矩形/圆内及直线/箭头附近命中，供拖动与橡皮擦复用。
- `translateAnnotation(annotation,dx,dy,box)`：在页面边界内平移自身坐标；便签原文 rects 锚点保留，形状尺寸不变。

### archive.js

- `createArchive({includeSecrets,password})`：一致快照、二进制 PDF、SHA-256 清单、异步 ZIP；可剥除凭据和加密。
- `keyFor`、`encrypt`、`decrypt`（内部）：PBKDF2-SHA256 250000 次，AES-256-GCM；magic `PBRIDGE1` + 16 字节 salt + 12 字节 IV + 密文。
- `readArchive(blob,password)`：解密、限制解压内存、检查格式版本、ID、安全字段、跨表引用、文件哈希和 PDF 头。
- 0.1.2 批注校验新增 strike、shape，校验形状枚举、起止点和可选字号/笔宽；兼容旧记录缺省字段。存档和数据库版本不变，新增记录应使用 0.1.2 或更新版本恢复。
- `importArchive(blob,options)`：验证后事务合并；可恢复设置并刷新缓存。
- `importFritiaSettings(file)`：从 JSON 或原项目 ZIP 中查找旧设置字段，合并 provider，不修改来源文件。
- `auth`、`remoteUrl`、`dav`（内部）：UTF-8 Basic Auth、安全 HTTP(S) 路径与超时请求。
- `testWebDav(config)`：PROPFIND 检查实际浏览器跨域请求。
- `syncWebDav(onStatus)`：禁止重入；GET+校验+本地合并+条件 PUT；不暴露凭据到云端，无强 ETag 时拒绝覆盖已有数据。
- `scheduleSync(onStatus,onError)`：按保存的启用状态设置 30 分钟定时器（最小间隔 5 分钟）。

### utils.js

`uid` 创建 UUID；`esc` 转义 HTML；`sizeLabel`、`dateLabel` 格式化展示；`download` 创建下载链接并延迟释放 Blob URL；`saveFile` 先校验非空 Blob，选择器不支持/调用条件不满足且未获取文件句柄时可退回普通下载，取消直接返回，写失败 abort 并抛错，绝不再次下载；`sha256` 算文件摘要；`bytesToBase64` 分块编码；`safeUrl` 只允许 HTTP(S) 且拒绝 URL 中嵌凭据；`errorMessage` 转换取消/超时/网络/接口异常。

### ui/components.js

`icon` / `illustration` 读取构建时导入的本地图标/插画；`button` / `iconButton` 生成有 aria-label 的按钮；`select` / `selected` / `bindSelects` 实现自绘下拉与键盘选择；`closeMenus` 统一关闭；`toast` 展示临时状态；`modal` 管理焦点环、Esc 和遮罩；`inputDialog` 返回可等待的文本、密码、取消或删除操作。

`anchoredPopover(anchor,title,body)` 复用 modal 焦点和关闭机制，将浮层固定在按钮下方 8px；限制视口宽高、窗口变化时重定位、关闭后移除监听。只用于翻译设置，不改变其他设置弹窗布局。

### ui/settings-panel.js

- `openSettings(app,tab)`：API、备份、WebDAV、帮助四视图；API 草稿只在保存后持久化；测试不覆盖设置。
- `onboarding(app)`：首次欢迎→选择服务→填地址/Key/模型→测试→保存；也可先使用免费翻译。

### ui/assistant.js 的 Assistant

- `constructor` / `render`：绑定右栏标签，按渲染 epoch 防止旧异步视图覆盖新视图。
- `renderSelection` / `translateSelection`：内存缓存按文档分组；新选区取消旧请求；单词与句子严格分流。
- `settings`：按钮下方的紧凑引擎、源/目标语言、学术风格浮层；引擎逐行列出 MyMemory 和全部配置的 LLM，保存专用 API 选择。
- `renderFull` / `startFull`：全文参数、历史、按文档分组的独立任务、流式落盘和阶段反馈。
- `setFullCollapsed(documentId,collapsed)`：首段译文保存后动画折叠参数；更新可展开的 sticky 进度栏，折叠内容 inert 防止焦点进入；手动展开不会在后续流式增量中重新折叠。
- `exportTranslation`：按译文记录互斥，复用或新建译文 PDF；写入关联根 ID；打开或下载。全文请求直接返回 PDF 时不重复进入本地转换分支。
- `renderChat` / `appendMessage`：按 rootId / conversationId 加载消息，显示部分结果和恢复副本。
- `appendMessage` 对仍有活动任务且尚无内容的助手消息显示“正在思考”环；onDelta 替换为内容，失败/停止后按最终状态渲染。
- `updateExportProgress()`：按 result-toolbar 的 translationId 读取转换互斥集合，设置打开/下载按钮的旋转图标、aria-busy 和禁用状态；转换的 try/finally 及历史切换均同步调用。
- `createThread`：创建独立会话并保存当前会话选择。
- `sendMessage`：先保存提问与回复占位，再组织完整文档及全部历史；每段流式先 patch，再更新当前匹配面板。
- `needsDocument`、`copy`、`speak`：空态、剪贴板、系统语音朗读辅助。

### main.js 的 App（主入口职责）

| 方法 | 功能 |
| --- | --- |
| constructor / init | 初始化状态、数据库、界面、持久存储请求、恢复标签/对话和首次引导 |
| mount / bind / action | 生成静态界面骨架、委托动作、导入拖放、快捷键、尺寸变化 |
| importFiles | 逐份校验加载 PDF，事务保存后打开；失败不产生半成品 |
| importGenerated | 验证生成的 PDF，保存为共享原文 rootId 的新文档 |
| openDocument / closeDocument | 处理并发打开序号、资源释放、历史切换；关闭只移除标签 |
| saveWorkspace | 保存标签、活动 PDF 和每个文档活动对话 |
| renderTabs / renderToolbar / toolButton | 单行文件卡片、指定顺序的工具条、颜色和激活反馈 |
| updateToolButtons | 依据选区规则同步多个按钮按下状态，不重建工具栏或打断选区 |
| updateHistoryButtons | 根据阅读器历史状态同步撤销/重做按钮禁用状态 |
| setTool / colorPicker / saveToolOptions | 选区动作或持续工具分发，颜色/形状与 pt 滑块浮层，保存后续工具偏好 |
| changeZoom / setPage | 比例、跳页和延迟保存滚动位置 |
| showReader / showSecondary | 工作区与管理页之间切换 |
| showLibrary / showRecords | PDF 库搜索、重命名、原文件下载、全文翻译历史 |
| documentText | 顺序提取全文，缓存最近一份文本并释放临时 PDF Worker |
| downloadCurrent | 保存互斥和按钮禁用，原文件直接下载或加载导出模块写入批注，每次动作只保存一次 |
| reload / refreshAssistant | 导入、设置、云同步后的界面刷新 |
| updateSaved / setSyncStatus | 持久化提交及同步状态展示 |

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

`initMobileLayout({closeNavigation})` 管理视口高度、分屏状态和窄屏浮窗外点击关闭；底部功能导航保持。`setMobilePane(pane)` 切换阅读/助手，同时退出管理页，不改桌面列宽。

`data-pdf-nav` 存在时，桌面仍收窄功能侧栏并插入导航列；窄屏使用绝对定位浮窗，不显示左功能栏，不改变 PDF 宽度或 fit 比例。桌面查找列稍宽以容纳同一行筛选开关。

## DOM 页面功能映射

| DOM / 标识 | 用户功能 | 处理模块 |
| --- | --- | --- |
| #app / .sidebar / .main-nav | 品牌、PDF 阅读、文档、翻译记录、设置/同步入口 | App.mount / action |
| #workspace / .reader-panel / .assistant-panel | 左 PDF 右翻译的工作区 | desktop/mobile |
| #split-handle | 拖动或方向键调整左右宽度 | desktop.js |
| #document-tabs / .document-tab | 已打开 PDF 的单行卡片、关闭和激活；页码保留在工具栏 | App.renderTabs |
| #pdf-input | 隐藏本地多文件选择器 | App.importFiles |
| #pdf-toolbar / [data-select=zoom] / #page-input | 阅读缩放、导航、编辑工具、颜色指示和导出 | App.renderToolbar |
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
| #selection-result | 在线词典或句子结果，不持久化 | Assistant.renderSelection |
| #full-stage / #full-result | 全文状态和完整 Markdown 结果 | Assistant.startFull |
| #full-controls / .full-summary / .full-toggle | 参数折叠动画、吸顶进度栏、停止与展开/收起按钮 | Assistant.setFullCollapsed |
| [data-select=translation-history] | 当前 PDF 的旧译文选择 | Assistant.renderFull |
| [data-select=chat-thread] / #chat-messages | 当前根文档的会话与全部消息 | Assistant.renderChat |
| #chat-form / #chat-input | 问题输入、API 选择、发送和停止 | Assistant.sendMessage |
| .message-thinking / [data-action=open-translated][aria-busy=true] | AI 首段回复前思考状态 / PDF 转换忙碌状态 | Assistant |
| #library-view / #library-search / #document-grid | 文档网格和名称筛选 | App.showLibrary |
| .record-list / [data-record] | 打开对应 PDF 的全文历史 | App.showRecords |
| #overlay-root / .modal | 通用焦点受控弹窗、设置、密码和批注输入 | components |
| #settings-content / #provider-form | 多 API 配置及能力设置 | settings-panel |
| #cloud-form | WebDAV 账号、测试、同步和开关 | settings-panel / archive |
| #archive-input | 本地 ZIP / 加密存档选择 | settings-panel / archive |
| #onboarding-content / #onboarding-form | 首次引导步骤 | onboarding |
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
  G --> H[每段流式先保存]
  H --> I[Markdown + KaTeX]
  I --> J[译文 PDF]
  J --> C
  C --> K[ZIP / 加密备份 / WebDAV]
```

模型返回内容不是可信 UI；必须通过统一 Markdown 清理函数。文件名、对话名和词典结果必须 HTML 转义。导入记录先验证；所有图片/图标从本地打包资产加载。未来改动不能引入清库迁移或未等待提交的“已保存”提示。
