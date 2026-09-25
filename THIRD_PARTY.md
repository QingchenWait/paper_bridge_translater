# 第三方代码、素材与来源

## v0.4.0 离线翻译资源

以下资源在 2026-09-25 至 2026-09-26 核实并固定到 `public/offline/manifest.json`，下载后按大小与 SHA-256 校验；不在推理时调用 CDN。模型权重是独立文件，不嵌入主 JavaScript bundle。

| 资源 | 来源、版本及用途 | 许可证 |
| --- | --- | --- |
| Firefox Lite 模型 | [Mozilla translations](https://github.com/mozilla/translations)、[模型注册表](https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/db/models.json)：Release `en→zh base-memory`，训练标识 `llmaat_finetune10M_qe8_f2_ByQcSxGXQRqGi-UTxYE43g`；使用该导出的 Marian 权重、SentencePiece 源/目标词表和 shortlist | MPL-2.0；随包 `offline/licenses/BERGAMOT-MPL-2.0.txt` |
| Bergamot 推理 | [Firefox 官方集成](https://github.com/mozilla-firefox/firefox/tree/main/toolkit/components/translations/bergamot-translator)，v0.6.0；glue 固定 Git blob `4cc89e7b56dfa6d33e9b85deea3fdb9c8c11cffa`，WASM 固定 Mozilla Remote Settings 附件，SHA-256 `a3a89d9ad0a4ed8f27bf3e403701b23f5709816f6376438503f2fa5b0182c2dc` | MPL-2.0；原 JS 未修改，派生 `.mjs` 标注 `globalThis` 严格模式修复和 ESM 导出，由准备脚本可复现生成 |
| Plus 模型 | [ModelScope Xenova/opus-mt-en-zh](https://modelscope.cn/models/Xenova/opus-mt-en-zh)，固定文件版本 `563922a09e0e294a0f5785bffdaa758732da3714`；六个文件与原 Hugging Face `046f55aec303cdee3e0318604406d4df20f1e8ea` 的大小/SHA-256 一致，保留原缓存身份 | Apache-2.0；不预置权重 |
| Pro 模型 | [ModelScope Xenova/nllb-200-distilled-600M](https://modelscope.cn/models/Xenova/nllb-200-distilled-600M)，固定文件 revision `23881c60efa6920de9bfa90f71038155c7ffe465`；与原 Hugging Face 版本的六文件哈希一致，保留缓存身份；量化 encoder/merged decoder 与四个 JSON | CC-BY-NC-4.0，非商业；不随 APP 分发权重，设置行与 README 明示。原模型定位研究用途，不宣称为生产级或专业认证翻译 |
| Transformers.js | [2.17.2 浏览器构建](https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js)，动态加载于 Worker；本地模型与自定义缓存参考[官方文档](https://huggingface.co/docs/transformers.js/v2.17.2/en/custom_usage) | Apache-2.0，`TRANSFORMERS-APACHE-2.0.txt`；内含 Hugging Face Jinja MIT 许可证 `JINJA-MIT.txt` |
| ONNX Runtime Web | [1.14.0](https://github.com/microsoft/onnxruntime/tree/v1.14.0)，与上述浏览器构建匹配；独立 SIMD/标量 WASM、CPU 单线程 | MIT，`ONNXRUNTIME-MIT.txt` 与 `ONNXRUNTIME-NOTICES.txt` 保留第三方声明 |
| 本地模型彩色图标 | [Microsoft Fluent Emoji Desktop computer](https://github.com/microsoft/fluentui-emoji/blob/main/assets/Desktop%20computer/Color/desktop_computer_color.svg)，下载原始 SVG 至 `src/_logo/llms/local.svg`，未自行重绘 | MIT；复用 `src/_logo/FLUENT-LICENSE` |

本项目未更改模型参数。Bergamot 原始 `.gz` 仅解压并将大权重分片，Worker 组合后字节/哈希与原导出相同。Mozilla 的 Google Storage 导出 shortlist 与 Remote Settings 同名附件大小不同，本项目采用指定训练导出的配套文件，并通过真实译句验证；manifest 记录实际字节与校验值，不能用文件名推断可互换。

运行时：Lite 始终从随包同源资源读取；Plus/Pro 从 ModelScope 固定版本下载，没有受 CORS 限制的备用站点。构建期修复缺失 Lite 时使用 `hf-mirror.com` 镜像（TiberiuCristianLeon/Bergamot 固定 revision `18008da9d2922dde09dae47f5fee71cac4253701`）并可回退 Mozilla GCS，按原始 Mozilla 哈希验证；该构建脚本不受浏览器 CORS 约束。开发期 WABT 1.0.37 只在 `.cache` 检查 WASM 指令，不进入发布。

Firefox base 源调研（2026-09-25/26）：Mozilla GCS、Firefox 附件 CDN 和所测 HF 镜像均未通过浏览器跨域读取，虽能命令行下载且哈希一致，也未用于 Plus 发布。Mozilla 注册表的 base 条目 `releaseStatus=null`，不能称其为当前 Release 或保证比 base-memory 更强。未找到同时满足大陆可达、CORS 和版本可信的第三方源；按用户指定回退 OPUS，删除试验中的额外 Plus 静态资源，部署包不扩充。ModelScope 已验证实际浏览器 CORS 和文件哈希，但单点网络测试不是对所有大陆运营商永久可用的保证。

项目许可证：GPL-3.0-only，见 `LICENSE`。本项目改编了“海姆休息室”设置模型和存档工作流，因此保留 GPL 分发要求。该项目仅作只读参考，未修改原目录。

| 来源 | 用途 | 许可证 / 说明 |
| --- | --- | --- |
| `D:/Models/vibe_coding/fritia_online_next_chat/src/js/settings.js` | 多 API 字段兼容、provider 规范化思路，改编至 `settings.js` | GPL-3.0 |
| 同项目 `onboarding.js` | 选择服务商→填配置→测试→保存的引导流程，适配为 PDF 场景 | GPL-3.0 |
| 同项目 `archive_sync.js` | 备份/WebDAV/CORS/定时同步流程，重写为 PDF 数据库事务合并 | GPL-3.0 |
| [PDF.js](https://mozilla.github.io/pdf.js/examples/) | 渲染、文本提取、选择层及文字层 CSS；所有平台使用同包 legacy 构建及匹配 Worker | Apache-2.0；版本由 package-lock 固定 |
| [core-js 3.50.0](https://github.com/zloirock/core-js/tree/v3.50.0) | PDF.js legacy 自带的 ECMAScript 兼容实现，无独立新增 npm 依赖 | MIT；原始许可证见 public/licenses/CORE-JS.txt |
| [pdf-lib](https://pdf-lib.js.org/) | 修改和生成 PDF | MIT |
| [@pdf-lib/fontkit](https://github.com/Hopding/fontkit/blob/master/src/subset/CFFSubset.js) | Noto 字体子集；pdf-fonts.js 对已安装 1.1.1 的 CFF 编码作局部兼容适配 | MIT；Devon Govett / Andrew Dillon，见 public/licenses/FONTKIT.txt |
| [Lucide](https://github.com/lucide-icons/lucide) | `src/_logo/icons` 中 66 个 SVG，使用主分支或 0.468.0 下载版本；0.2.0 新增文件夹/移动/视图/排序七个图标，保留原文件内容 | ISC；见 `src/_logo/LUCIDE-LICENSE` |
| [Lobe Icons](https://github.com/lobehub/lobe-icons/tree/2e76c48721e91b9aaa40803a0fa2eb8aca7399c4/packages/static-svg/icons) | `src/_logo/llms` 七家厂商 LOGO，源文件分别为 deepseek-color、xiaomimimo、qwen-color、openai、zhipu-color、kimi-color、lmstudio，2026-09-23 直接下载，未重绘 | MIT；见 `src/_logo/LOBE-ICONS-LICENSE`；产品标识归对应品牌所有 |
| [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) | `src/_logo/art/open-book.png` 与 `sparkles.png`，3D 插画 | MIT；见 `src/_logo/FLUENT-LICENSE` |
| [Noto CJK](https://github.com/notofonts/noto-cjk) | `public/fonts/NotoSansSC-Regular.otf`，按需加载的批注中文字体 | SIL OFL 1.1；见 `public/fonts/LICENSE` |
| markdown-it、markdown-it-texmath、KaTeX、highlight.js | Markdown、数学与代码渲染 | 各包许可证见 node_modules；构建固定依赖版本 |
| DOMPurify | HTML 净化 | Apache-2.0 OR MPL-2.0 |
| [@noble/hashes](https://github.com/paulmillr/noble-hashes) 2.4.0 | 百度 MD5 签名及原始 PDF 重复检测指纹，按需加载 legacy.js，PDF 使用增量分块更新；SHA/HMAC 使用浏览器 Web Crypto | MIT；分发包保留 NOBLE-HASHES.txt |
| idb、fflate、html2canvas、fontkit | 存储、存档、视觉 PDF、字体子集 | 各包原许可证保留于依赖目录 |

素材下载脚本为 `tools/download-assets.ps1`。源图标并未重绘；CSS 只调整显示尺寸、颜色滤镜和透明度。UI 参考图和规则来自用户提供的 `src/ui_rules`。

v0.3.3 从同一 Lobe Icons 固定提交下载 `meta-color`、`google-color`、`baidu-color`、`alibabacloud-color`、`volcengine-color`，原始 SVG 分别保存为 src/_logo/llms/meta、google、baidu、aliyun、volcengine.svg，沿用 LOBE-ICONS-LICENSE。MyMemory 按用户指定使用 Meta 彩色图标，仅为本应用的显示映射，不代表两家服务的归属关系。

## PDF 注释参考与验证

- v0.3.5 内链参照 [PDFPageProxy.getAnnotations](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html) 及本地 6.3.289 PageViewport/LinkAnnotationElement 源码；按其原始目标与坐标跳转，复用兼容主库/Worker。
- 长译文参照 [markdown-it token 架构](https://github.com/markdown-it/markdown-it/blob/master/docs/architecture.md) 拆分渲染工作，完整解析仍使用锁定的原库；[content-visibility](https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility) 仅作屏幕外绘制的渐进增强，旧浏览器仍保留完整 DOM。

- [PDF.js 官方浏览器兼容说明](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#which-browsersenvironments-are-supported)：常规构建面向最新浏览器，legacy 构建提供转换及能力补齐。本项目复用相同锁定版本的 legacy/core-js，修正原先只在 Apple 启用、遗漏 Chromium 142 的能力覆盖；没有修改上游包或降低 PDF 版本。

- [Adobe 发布的 ISO 32000-1 PDF 参考](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf)，12.5.6.10 / 12.5.6.13 / 12.5.6.14：文字标记注释、Contents、QuadPoints、Ink/InkList 和 Popup/Parent。
- [Adobe CFF 格式规范](https://adobe-type-tools.github.io/font-tech-notes/pdfs/5176.CFF.pdf)：文件头 offSize 合法范围、FDArray/FDSelect、局部 Subrs。与上游 CFFSubset.js 源码对照，修复原 Noto 字体子集编码，未更换字体。
- [PDF.js 注释解析器](https://github.com/mozilla/pdf.js/blob/master/src/core/annotation.js)：UnderlineAnnotation、PopupAnnotation、Unicode 内容与外观读取，采用实际库回读验证。
- [PDFium 弹窗创建](https://github.com/chromium/pdfium/blob/main/core/fpdfdoc/cpdf_annotlist.cpp) 与 [弹窗外观生成](https://github.com/chromium/pdfium/blob/main/core/fpdfdoc/cpdf_generateap.cpp)：Chrome 忽略文件内 Popup 并创建自有弹窗，GenerateFallbackFontDict 使用 WinAnsi，解释本轮实测的中文漏显；没有通过压平批注内容来伪装兼容。
- 新增 move、rotate-ccw、a-arrow-up、a-arrow-down 四个 Lucide 0.468.0 图标，原始下载文件保留在 src/_logo/icons。
- 开发期使用临时目录中的 PyMuPDF 1.28.2 独立检查导出文件及渲染，不引入静态应用依赖、不打包其 Python 代码。Chrome 实测为本机临时浏览器资料；未运行 Acrobat。

## API 官方参考

- [有道 suggest 接口（用户指定）](https://dict.youdao.com/suggest?q=love&num=1&doctype=json)：客户端优先词典，result.code / data.entries[].entry/explain；按返回词性标记拆分，不扩写省略数据。实测无 Origin 可返回 JSON，带网页 Origin 被拒绝；仅客户端尝试，预留宿主 CORS 请求钩子，代理后续打包时接入。显示有道及词条来源，不声明其数据采用开放许可证。
- [Free Dictionary API](https://dictionaryapi.dev/)：英文词典。词条显示接口返回的许可证信息。
- [FreeDictionaryAPI.com](https://freedictionaryapi.com/) / [官方 OpenAPI](https://freedictionaryapi.com/api/v1/openapi.json)：中文释义第一备选，与 dictionaryapi.dev 是不同服务。GET entries/en/{word}?translations=true，解析词义/子词义的中文翻译及音标、词性、例句、近义词和词形；Wiktionary 数据按返回的 CC BY-SA 4.0 署名，在结果中展示服务名、原始词条和许可证链接。官方当前标注每 IP 每小时 1000 次，无 Key、支持 CORS。
- [3325 词典官方文档](https://3325.cn/api-docs)：中文释义第二备选。GET /api/word/{word}，code/data 外层、british/american/cx/jbjs/url 字段；当前每 IP 每分钟 60 次，429 表示限流，CORS 允许直接浏览器调用。保留词条来源链接，不擅自宣称其数据采用开放许可证。
- [PDF.js PDFDocumentProxy](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFDocumentProxy.html)：缩略图使用 getPage/render；内置书签使用 getOutline/getDestination/getPageIndex。结合已安装 6.3.289 的类型定义验证。
- [Wiktionary REST 定义接口](https://en.wiktionary.org/api/rest_v1/#/Page_content/get_page_definition__term_)：0.1.1 新增并行备用词典，通过 `/page/definition/{word}` 读取英文定义，只显示纯文本与来源；不依赖私有代理。
- [MyMemory API](https://mymemory.translated.net/doc/spec.php)：`get?q=...&langpair=en|zh-CN`，每段控制为 450 UTF-8 字节。此文档在执行环境返回过 403，真实 API 已完成无凭据请求验证。
- [MediaWiki Parse API](https://www.mediawiki.org/wiki/API:Parsing_wikitext)：通过 Wiktionary 获取英文 headword 词形，仅显示文本，不注入远端 HTML；词形链接回词条，遵循站点内容署名要求。
- [OpenAI 文件输入](https://developers.openai.com/api/docs/guides/file-inputs)：Responses `input_file`、Chat Completions `file` 的 Base64 文件输入格式。
- [OpenAI Code Interpreter](https://developers.openai.com/api/docs/guides/tools-code-interpreter)：工具容器、`container_file_citation` 与生成文件下载。

- [Tauri opener 官方源码](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/opener/guest-js/index.ts)：核对 openUrl → plugin:opener|open_url 默认系统浏览器调用；实现按需调用已有宿主桥接，不引入原生打包依赖。

- [Google 接口参考（用户指定）](https://juejin.cn/post/7384632027230519330)：仅采用“翻译 API 信息”章节的 client=gtx/dt=t 参数思路，不引入文章中的代理；已直接请求 Google 官方域名验证返回与 CORS。
- [阿里云 TranslateGeneral](https://help.aliyun.com/zh/machine-translation/developer-reference/api-alimt-2018-10-12-translategeneral) 与 [官方 RPC 签名器](https://github.com/aliyun/aliyun-openapi-python-sdk/blob/master/aliyun-python-sdk-core/aliyunsdkcore/auth/composer/rpc_signature_composer.py)：通用版参数、返回结构、HMAC-SHA1 签名。
- [百度领域翻译](https://fanyi-api.baidu.com/product/123) / [百度通用翻译](https://fanyi-api.baidu.com/product/113)：academic 中英领域、MD5 拼接顺序、语言映射；直接请求验证两个官方端点的 JSONP 回调。
- [火山文本翻译](https://docs.volcengine.com/docs/MachineTranslation/TextTranslationAPI) / [官方签名器](https://github.com/volcengine/volc-sdk-python/blob/master/volcengine/auth/SignerV4.py)：POST TextList、TranslationList，地域 cn-north-1、服务 translate 及 HMAC-SHA256 V4 签名。

外部接口文档在开发时核对；依赖和图标均本地打包；百度翻译请求会加载其官方 API 的 JSONP 数据回调脚本。用户发起在线翻译、问答、云同步或外部 PDF 下载时访问对应外部服务。
