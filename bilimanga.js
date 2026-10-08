/** @type {import('./_yurt_.js')} */

/**
 * 嗶哩漫畫 (bilimanga.net)
 *
 * 站点结构:
 * - 详情页: /detail/{id}.html
 * - 目录页: /read/{id}/catalog (全部卷 + 章节)
 * - 阅读页: /read/{id}/{chapterId}.html
 * - 分类: /filter/{Category}/{page}.html
 * - 最近更新: /filter/postdate_0_0_0_0_0_0_0_{page}_0_0_0.html
 * - 完本: /filter/fullflag_0_0_0_0_0_0_0_{page}_0_0_0.html
 * - 排行: /top/{allvisit|monthvisit|goodnum|monthvote|monthflower|newhot}/{page}.html
 * - 搜索: POST /search.html (searchkey=...), 翻页 GET /search/{kw}_{page}.html
 *
 * 注意:
 * - 站点有 Cloudflare WAF, 请求必须携带完整浏览器头(特别是 Accept / Accept-Language)
 * - 搜索 POST 前需走 search_guard 流程种下 jieqiSearchJs cookie
 * - 阅读页图片为服务端按客户端环境输出, 部分网络环境会返回占位页(见 loadEp)
 * - 正文图片为 AVIF 格式
 */

const UA =
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

const DEFAULT_BASE = "https://www.bilimanga.net";

/** 分类列表, param 为 URL 中的英文名 */
const CATEGORIES = [
    "FantasyAdventure-奇幻冒險",
    "Action-戰鬥熱血",
    "SuspenseHorror-懸疑驚悚",
    "SchoolLife-校園青春",
    "Romance-愛情浪漫",
    "Workplace-職場都市",
    "Historical-歷史文化",
    "Sci-Fi-科幻未來",
    "Supernatural-奇異幻想",
    "Healing-治癒溫馨",
    "Survival-末日生存",
    "Other-其他分類",
];

class BiliManga extends ComicSource {
    name = "嗶哩漫畫";
    key = "bilimanga";

    version = "1.0.0";
    minAppVersion = "1.4.6";

    url =
        "https://raw.githubusercontent.com/yybwx/yurt-config/main/bilimanga.js";

    init() {}

    get base() {
        const domain = (this.loadSetting("domain") || "").trim();
        if (domain) {
            return domain.startsWith("http")
                ? domain.replace(/\/+$/, "")
                : "https://" + domain;
        }
        return DEFAULT_BASE;
    }

    _headers(referer) {
        const h = {
            "user-agent": UA,
            accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "accept-language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
            "upgrade-insecure-requests": "1",
        };
        if (referer) h["referer"] = referer;
        return h;
    }

    /**
     * 请求页面并返回 HtmlDocument
     * @param path {string}
     * @param referer {string?}
     * @returns {Promise<HtmlDocument>}
     */
    async _getDoc(path, referer) {
        const url = path.startsWith("http")
            ? path
            : this.base + (path.startsWith("/") ? path : "/" + path);
        const res = await Network.get(url, this._headers(referer));
        if (res.status !== 200) {
            throw `Invalid status code: ${res.status}`;
        }
        return new HtmlDocument(res.body);
    }

    async _getHtml(path, referer) {
        const url = path.startsWith("http")
            ? path
            : this.base + (path.startsWith("/") ? path : "/" + path);
        const res = await Network.get(url, this._headers(referer));
        if (res.status !== 200) {
            throw `Invalid status code: ${res.status}`;
        }
        return res.body;
    }

    /**
     * search_guard 流程: 获取 jieqiSearchJs cookie 并 redeem
     */
    async _ensureSearchGuard() {
        try {
            const guardJs = await this._getHtml(
                "/search.html?search_guard=js",
                this.base + "/search.html"
            );
            const m = /jieqiSearchJs=([^;"']+)/.exec(guardJs);
            if (m) {
                let host = this.base.replace(/^https?:\/\//, "");
                Network.setCookies(this.base + "/", [
                    new Cookie({
                        name: "jieqiSearchJs",
                        value: m[1],
                        domain: host,
                    }),
                ]);
                await this._getHtml(
                    "/search.html?search_guard=redeem&r=" + Date.now(),
                    this.base + "/search.html"
                );
            }
        } catch (e) {
            // guard 失败不阻塞搜索, 尽力而为
        }
    }

    /**
     * 解析列表项(li.book-li) -> Comic
     * @param doc {HtmlDocument}
     * @returns {Comic[]}
     */
    _parseComicList(doc) {
        const items = doc.querySelectorAll("li.book-li");
        const comics = [];
        for (const li of items) {
            try {
                const link = li.querySelector('a[href*="/detail/"]');
                if (!link) continue;
                const href = link.attributes["href"] || "";
                const idm = /\/detail\/(\d+)\.html/.exec(href);
                if (!idm) continue;

                const img = li.querySelector("img");
                let cover = "";
                if (img) {
                    cover =
                        img.attributes["data-src"] ||
                        img.attributes["src"] ||
                        "";
                }

                const titleEl = li.querySelector(".book-title");
                const title = titleEl ? titleEl.text.trim() : idm[1];

                const authorEl = li.querySelector(".book-author");
                let author = authorEl ? authorEl.text.trim() : "";
                author = author.replace(/^作者/, "").trim();

                const descEl = li.querySelector(".book-desc");
                const description = descEl ? descEl.text.trim() : "";

                const tags = [];
                const ems = li.querySelectorAll("em.tag-small");
                for (const em of ems) {
                    const t = em.text.trim();
                    if (!t) continue;
                    // 第一个 em 内含空格分隔的多个标签
                    for (const part of t.split(/\s+/)) {
                        const p = part.trim();
                        if (!p) continue;
                        // 过滤人气值 (如 0.1萬)
                        if (/^\d+(\.\d+)?萬?$/.test(p)) continue;
                        if (tags.indexOf(p) === -1) tags.push(p);
                    }
                }

                let stars;
                const ratingEl = li.querySelector(".corner em");
                if (ratingEl) {
                    const v = parseFloat(ratingEl.text.trim());
                    if (!isNaN(v)) stars = Math.max(0, Math.min(5, v / 2));
                }

                comics.push(
                    new Comic({
                        id: idm[1],
                        title,
                        subTitle: author,
                        cover,
                        tags,
                        description,
                        language: "zh-Hant",
                        stars,
                    })
                );
            } catch (e) {
                // 跳过解析失败的条目
            }
        }
        return comics;
    }

    /**
     * 解析分页最大页数
     * 通过对比 a.first 与 a.last 的 href 找出页码槽位,
     * 支持 /filter/Romance/5.html 与 /filter/postdate_0_..._2_..._0.html 两种格式
     * @param doc {HtmlDocument}
     * @returns {number}
     */
    _parseMaxPage(doc) {
        const first = doc.querySelector("a.first");
        const last = doc.querySelector("a.last");
        if (!last) return 1;
        const lastHref = (last.attributes["href"] || "").split("?")[0];

        if (first) {
            const firstHref = (first.attributes["href"] || "").split("?")[0];
            const a = firstHref.split("/");
            const b = lastHref.split("/");
            if (a.length === b.length) {
                for (let i = a.length - 1; i >= 0; i--) {
                    if (a[i] !== b[i]) {
                        // 长格式: 以下划线分段, 找到数值不同的槽位
                        const fa = a[i].split("_");
                        const fb = b[i].split("_");
                        if (fa.length === fb.length && fa.length > 1) {
                            for (let j = 0; j < fb.length; j++) {
                                if (
                                    fa[j] !== fb[j] &&
                                    /^\d+$/.test(fb[j])
                                ) {
                                    return parseInt(fb[j], 10);
                                }
                            }
                        }
                        // 普通格式: 取段末尾数字 (如 Romance/5.html)
                        const m = /(\d+)(?=\.html?$)/.exec(b[i]);
                        if (m) return parseInt(m[1], 10);
                    }
                }
            }
        }

        // 兜底: 最后路径段的末尾数字
        const seg =
            lastHref.split("/").filter(Boolean).pop() || "";
        const m = /(\d+)(?=\.html?$)/.exec(seg);
        return m ? Math.max(1, parseInt(m[1], 10)) : 1;
    }

    /// explore
    explore = [
        {
            title: "最近更新",
            type: "multiPageComicList",
            load: async (page) => {
                if (!page) page = 1;
                const doc = await this._getDoc(
                    `/filter/postdate_0_0_0_0_0_0_0_${page}_0_0_0.html`
                );
                return {
                    comics: this._parseComicList(doc),
                    maxPage: this._parseMaxPage(doc),
                };
            },
            loadNext(next) {},
        },
        {
            title: "人氣完本",
            type: "multiPageComicList",
            load: async (page) => {
                if (!page) page = 1;
                const doc = await this._getDoc(
                    `/filter/fullflag_0_0_0_0_0_0_0_${page}_0_0_0.html`
                );
                return {
                    comics: this._parseComicList(doc),
                    maxPage: this._parseMaxPage(doc),
                };
            },
            loadNext(next) {},
        },
    ];

    // 分类
    category = {
        title: "嗶哩漫畫",
        parts: [
            {
                name: "分類",
                type: "fixed",
                categories: CATEGORIES.map((c) => {
                    const [param, label] = c.split("-");
                    return {
                        label,
                        target: {
                            page: "category",
                            attributes: {
                                category: label,
                                param,
                            },
                        },
                    };
                }),
            },
        ],
        enableRankingPage: true,
    };

    categoryComics = {
        /**
         * @param category {string}
         * @param param {string?} - 分类英文名
         * @param options {string[]}
         * @param page {number}
         */
        load: async (category, param, options, page) => {
            if (!page) page = 1;
            if (!param) param = "Other";
            const doc = await this._getDoc(
                `/filter/${encodeURIComponent(param)}/${page}.html`
            );
            return {
                comics: this._parseComicList(doc),
                maxPage: this._parseMaxPage(doc),
            };
        },
        optionList: [],
        ranking: {
            options: [
                "allvisit-總排行",
                "monthvisit-月排行",
                "newhot-最新熱門",
                "goodnum-好評榜",
                "monthvote-月推薦",
                "monthflower-月鮮花",
            ],
            load: async (option, page) => {
                if (!page) page = 1;
                if (!option) option = "allvisit";
                const doc = await this._getDoc(`/top/${option}/${page}.html`);
                return {
                    comics: this._parseComicList(doc),
                    maxPage: this._parseMaxPage(doc),
                };
            },
        },
    };

    /// 搜索
    search = {
        load: async (keyword, options, page) => {
            if (!page) page = 1;
            const kw = (keyword || "").trim();
            if (!kw) return { comics: [], maxPage: 1 };

            if (page === 1) {
                // 首页走 POST (需先走 search_guard 流程)
                await this._ensureSearchGuard();
                const res = await Network.post(
                    this.base + "/search.html",
                    {
                        ...this._headers(this.base + "/search.html"),
                        "content-type":
                            "application/x-www-form-urlencoded",
                        origin: this.base,
                    },
                    "searchkey=" + encodeURIComponent(kw)
                );
                if (res.status !== 200) {
                    throw `Invalid status code: ${res.status}`;
                }
                // 精确命中时 POST 可能返回空, 尝试 GET 兜底
                if (!res.body || res.body.trim().length < 10) {
                    const html = await this._getHtml(
                        "/search.html?searchkey=" + encodeURIComponent(kw),
                        this.base + "/search.html"
                    );
                    if (!html || html.trim().length < 10) {
                        throw "搜索被站点拦截, 请稍后重试或在浏览器中完成一次验证";
                    }
                    const doc = new HtmlDocument(html);
                    return {
                        comics: this._parseComicList(doc),
                        maxPage: this._parseMaxPage(doc),
                    };
                }
                const doc = new HtmlDocument(res.body);
                return {
                    comics: this._parseComicList(doc),
                    maxPage: this._parseMaxPage(doc),
                };
            }

            // 翻页走 GET
            const doc = await this._getDoc(
                "/search/" +
                    encodeURIComponent(kw) +
                    "_" +
                    page +
                    ".html",
                this.base + "/search.html"
            );
            return {
                comics: this._parseComicList(doc),
                maxPage: this._parseMaxPage(doc),
            };
        },
        loadNext: async (keyword, options, next) => {},
        optionList: [],
        enableTagsSuggestions: false,
    };

    /// 单本漫画
    comic = {
        /**
         * 载入漫画信息和章节列表
         * @param id {string}
         * @returns {Promise<ComicDetails>}
         */
        loadInfo: async (id) => {
            const detailUrl = this.base + "/detail/" + id + ".html";
            const doc = await this._getDoc("/detail/" + id + ".html");

            const titleEl = doc.querySelector("h1.book-title");
            const title = titleEl ? titleEl.text.trim() : id;

            const backupEl = doc.querySelector(".backupname");
            const backupName = backupEl ? backupEl.text.trim() : "";

            const authors = [];
            const authorLinks = doc.querySelectorAll(
                ".authorname a, .illname a"
            );
            for (const a of authorLinks) {
                const t = a.text.trim();
                if (t && authors.indexOf(t) === -1) authors.push(t);
            }

            const coverImg = doc.querySelector("img.book-cover");
            const cover = coverImg
                ? coverImg.attributes["src"] ||
                  coverImg.attributes["data-src"] ||
                  ""
                : "";

            // 简介
            let description = "";
            const summaryEl = doc.querySelector("#bookSummary");
            if (summaryEl) description = summaryEl.text.trim();

            // 标签
            const genres = [];
            const tagLinks = doc.querySelectorAll(".tag-small-group a");
            for (const a of tagLinks) {
                const t = a.text.trim();
                if (t && genres.indexOf(t) === -1) genres.push(t);
            }

            // 状态 + 更新时间
            let status = "";
            const metaEms = doc.querySelectorAll(".book-meta em");
            for (const em of metaEms) {
                const t = em.text.trim();
                if (/^(連載中|已完結|連載完了)/.test(t)) {
                    status = t;
                    break;
                }
            }
            let updateTime = "";
            let latestChapter = "";
            const statusEl = doc.querySelector("a.book-status");
            if (statusEl) {
                const l = statusEl.querySelector(".book-meta-l");
                if (l) {
                    const m = /(\d{4}-\d{2}-\d{2})/.exec(l.text);
                    if (m) updateTime = m[1];
                }
                const r = statusEl.querySelector(".book-meta-r p");
                if (r) latestChapter = r.text.trim();
            }

            // 目录页: 全部卷 + 章节
            const cataDoc = await this._getDoc(
                "/read/" + id + "/catalog",
                detailUrl
            );
            const chapters = new Map();
            const thumbnails = [];
            const volumes = cataDoc.querySelectorAll("div.catalog-volume");
            for (const vol of volumes) {
                const coverImg2 = vol.querySelector(".volume-cover img");
                if (coverImg2) {
                    const c =
                        coverImg2.attributes["data-src"] ||
                        coverImg2.attributes["src"] ||
                        "";
                    if (c && c.indexOf("book-cover-no.svg") === -1) {
                        thumbnails.push(c);
                    }
                }
                const chapterLinks = vol.querySelectorAll(
                    'a[href*="/read/' + id + '/"]'
                );
                for (const a of chapterLinks) {
                    const href = a.attributes["href"] || "";
                    const m = /\/read\/\d+\/(\d+)\.html/.exec(href);
                    if (!m) continue;
                    const span = a.querySelector(".chapter-index");
                    let text = span
                        ? span.text.trim()
                        : a.text.trim();
                    if (!text) text = "第" + m[1] + "話";
                    if (!chapters.has(m[1])) {
                        chapters.set(m[1], text);
                    }
                }
            }

            const tags = new Map();
            if (authors.length) tags.set("作者", authors);
            if (genres.length) tags.set("分類", genres);
            if (status) tags.set("狀態", [status]);

            let descFull = description;
            if (backupName && backupName !== title) {
                descFull = "又名: " + backupName + "\n" + descFull;
            }
            if (latestChapter) {
                descFull = descFull + "\n最新: " + latestChapter;
            }

            return new ComicDetails({
                title,
                subTitle: authors.join(", "),
                cover,
                description: descFull,
                tags,
                chapters,
                thumbnails: thumbnails.length ? thumbnails : [cover],
                updateTime,
                url: detailUrl,
            });
        },

        /**
         * 载入章节图片
         * @param comicId {string}
         * @param epId {string}
         * @returns {Promise<{images: string[]}>}
         */
        loadEp: async (comicId, epId) => {
            const html = await this._getHtml(
                "/read/" + comicId + "/" + epId + ".html",
                this.base + "/detail/" + comicId + ".html"
            );

            // VIP 章节判断
            const vipM = /chapterisvip:'(\d)'/.exec(html);
            if (vipM && vipM[1] === "1") {
                throw "VIP 章節, 需登錄購買後閱讀";
            }

            // 占位页判断 (站点对非手机浏览器环境返回提示页)
            if (html.indexOf("center-note") !== -1) {
                throw "章節內容被站點攔截(返回了占位頁)。請先在手機瀏覽器打開該章節通過驗證後再試, 或反饋給維護者";
            }

            const doc = new HtmlDocument(html);
            const images = [];

            // 正文图片: img.imagecontent (data-src 懒加载)
            const contentImgs = doc.querySelectorAll("img.imagecontent");
            for (const img of contentImgs) {
                const u =
                    img.attributes["data-src"] ||
                    img.attributes["src"] ||
                    "";
                if (u) images.push(u);
            }

            // 兜底: 内容区内全部图片
            if (!images.length) {
                const allImgs = doc.querySelectorAll(
                    "#acontentz img, .apage img, #acontent img"
                );
                for (const img of allImgs) {
                    const u =
                        img.attributes["data-src"] ||
                        img.attributes["src"] ||
                        "";
                    if (
                        u &&
                        u.indexOf("book-cover-no.svg") === -1 &&
                        u.indexOf("/themes/") === -1
                    ) {
                        images.push(u);
                    }
                }
            }

            if (!images.length) {
                throw "未解析到章節圖片, 站點可能更新了閱讀頁結構";
            }

            return { images };
        },

        onImageLoad: (url, comicId, epId) => {
            return {
                url,
                headers: {
                    "user-agent": UA,
                    referer: this.base + "/",
                    accept:
                        "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                },
            };
        },

        onThumbnailLoad: (url) => {
            return {
                url,
                headers: {
                    "user-agent": UA,
                    referer: this.base + "/",
                    accept:
                        "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                },
            };
        },

        onClickTag: (namespace, tag) => {
            // 分類标签跳回分类页(按名称匹配), 其余走搜索
            const CATEGORIES = [
                "FantasyAdventure-奇幻冒險",
                "Action-戰鬥熱血",
                "SuspenseHorror-懸疑驚悚",
                "SchoolLife-校園青春",
                "Romance-愛情浪漫",
                "Workplace-職場都市",
                "Historical-歷史文化",
                "Sci-Fi-科幻未來",
                "Supernatural-奇異幻想",
                "Healing-治癒溫馨",
                "Survival-末日生存",
                "Other-其他分類",
            ];
            for (const c of CATEGORIES) {
                const [param, label] = c.split("-");
                if (tag === label) {
                    return {
                        page: "category",
                        attributes: { category: label, param },
                    };
                }
            }
            return {
                page: "search",
                attributes: { keyword: tag },
            };
        },

        link: {
            domains: [
                "bilimanga.net",
                "www.bilimanga.net",
                "bilicomic.net",
                "www.bilicomic.net",
            ],
            linkToId: (url) => {
                const m = /\/detail\/(\d+)\.html/.exec(url);
                if (!m) throw new Error("Invalid bilimanga url");
                return m[1];
            },
        },
    };

    /// 设置
    settings = {
        domain: {
            title: "站點域名",
            type: "input",
            validator:
                "^[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$|^https?:\\/\\/[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
            default: "",
        },
    };

    translation = {
        zh_CN: {
            站點域名: "站点域名",
        },
        zh_TW: {},
        en: {
            站點域名: "Domain",
        },
    };
}
