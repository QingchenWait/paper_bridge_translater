# 第三方代码、素材与来源

项目许可证：GPL-3.0-only，见 `LICENSE`。本项目改编了“海姆休息室”设置模型和存档工作流，因此保留 GPL 分发要求。该项目仅作只读参考，未修改原目录。

| 来源 | 用途 | 许可证 / 说明 |
| --- | --- | --- |
| `D:/Models/vibe_coding/fritia_online_next_chat/src/js/settings.js` | 多 API 字段兼容、provider 规范化思路，改编至 `settings.js` | GPL-3.0 |
| 同项目 `onboarding.js` | 选择服务商→填配置→测试→保存的引导流程，适配为 PDF 场景 | GPL-3.0 |
| 同项目 `archive_sync.js` | 备份/WebDAV/CORS/定时同步流程，重写为 PDF 数据库事务合并 | GPL-3.0 |
| [PDF.js](https://mozilla.github.io/pdf.js/examples/) | 渲染、文本提取、选择层及文字层 CSS | Apache-2.0；版本由 package-lock 固定 |
| [pdf-lib](https://pdf-lib.js.org/) | 修改和生成 PDF | MIT |
| [Lucide](https://github.com/lucide-icons/lucide) | `src/_logo/icons` 中 62 个 SVG，使用主分支或 0.468.0 下载版本；0.2.0 新增文件夹/移动/视图/排序七个图标，保留原文件内容 | ISC；见 `src/_logo/LUCIDE-LICENSE` |
| [Lobe Icons](https://github.com/lobehub/lobe-icons/tree/2e76c48721e91b9aaa40803a0fa2eb8aca7399c4/packages/static-svg/icons) | `src/_logo/llms` 七家厂商 LOGO，源文件分别为 deepseek-color、xiaomimimo、qwen-color、openai、zhipu-color、kimi-color、lmstudio，2026-09-23 直接下载，未重绘 | MIT；见 `src/_logo/LOBE-ICONS-LICENSE`；产品标识归对应品牌所有 |
| [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) | `src/_logo/art/open-book.png` 与 `sparkles.png`，3D 插画 | MIT；见 `src/_logo/FLUENT-LICENSE` |
| [Noto CJK](https://github.com/notofonts/noto-cjk) | `public/fonts/NotoSansSC-Regular.otf`，按需加载的批注中文字体 | SIL OFL 1.1；见 `public/fonts/LICENSE` |
| markdown-it、markdown-it-texmath、KaTeX、highlight.js | Markdown、数学与代码渲染 | 各包许可证见 node_modules；构建固定依赖版本 |
| DOMPurify | HTML 净化 | Apache-2.0 OR MPL-2.0 |
| [@noble/hashes](https://github.com/paulmillr/noble-hashes) 2.4.0 | 百度官方接口要求的 MD5 签名，按需加载 legacy.js；SHA/HMAC 使用浏览器 Web Crypto | MIT；分发包保留 NOBLE-HASHES.txt |
| idb、fflate、html2canvas、fontkit | 存储、存档、视觉 PDF、字体子集 | 各包原许可证保留于依赖目录 |

素材下载脚本为 `tools/download-assets.ps1`。源图标并未重绘；CSS 只调整显示尺寸、颜色滤镜和透明度。UI 参考图和规则来自用户提供的 `src/ui_rules`。

## API 官方参考

- [Free Dictionary API](https://dictionaryapi.dev/)：英文词典。词条显示接口返回的许可证信息。
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

外部接口文档在开发时核对；依赖和图标均本地打包；百度翻译请求会加载其官方 API 的 JSONP 数据回调脚本。只有用户发起在线翻译、问答或云同步时访问对应外部服务。
