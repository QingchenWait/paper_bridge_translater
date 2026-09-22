# 第三方代码、素材与来源

项目许可证：GPL-3.0-only，见 `LICENSE`。本项目改编了“海姆休息室”设置模型和存档工作流，因此保留 GPL 分发要求。该项目仅作只读参考，未修改原目录。

| 来源 | 用途 | 许可证 / 说明 |
| --- | --- | --- |
| `D:/Models/vibe_coding/fritia_online_next_chat/src/js/settings.js` | 多 API 字段兼容、provider 规范化思路，改编至 `settings.js` | GPL-3.0 |
| 同项目 `onboarding.js` | 选择服务商→填配置→测试→保存的引导流程，适配为 PDF 场景 | GPL-3.0 |
| 同项目 `archive_sync.js` | 备份/WebDAV/CORS/定时同步流程，重写为 PDF 数据库事务合并 | GPL-3.0 |
| [PDF.js](https://mozilla.github.io/pdf.js/examples/) | 渲染、文本提取、选择层及文字层 CSS | Apache-2.0；版本由 package-lock 固定 |
| [pdf-lib](https://pdf-lib.js.org/) | 修改和生成 PDF | MIT |
| [Lucide](https://github.com/lucide-icons/lucide) | `src/_logo/icons` 中 61 个 SVG，使用主分支或 0.468.0 下载版本；0.2.0 新增文件夹/移动/视图/排序七个图标，保留原文件内容 | ISC；见 `src/_logo/LUCIDE-LICENSE` |
| [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) | `src/_logo/art/open-book.png` 与 `sparkles.png`，3D 插画 | MIT；见 `src/_logo/FLUENT-LICENSE` |
| [Noto CJK](https://github.com/notofonts/noto-cjk) | `public/fonts/NotoSansSC-Regular.otf`，按需加载的批注中文字体 | SIL OFL 1.1；见 `public/fonts/LICENSE` |
| markdown-it、markdown-it-texmath、KaTeX、highlight.js | Markdown、数学与代码渲染 | 各包许可证见 node_modules；构建固定依赖版本 |
| DOMPurify | HTML 净化 | Apache-2.0 OR MPL-2.0 |
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

外部接口文档在开发时核对；最终运行不加载 CDN 代码。只有用户发起在线翻译、问答或云同步时访问对应外部服务。
