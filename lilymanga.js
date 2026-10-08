/** @type {import('./_yurt_.js')} */

/**
 * Lily Manga (lilymanga.net)
 *
 * WordPress + Madara 主题的百合/GL 漫画站。
 *
 * 站点结构:
 * - 归档: /gl/ (全部), /gl-genre/{genre}/ (题材), /gl-tag/{type}/ (类型), 分页 /page/{n}/
 * - 搜索: /?s={kw}&post_type=wp-manga&paged={n}
 * - 详情: {seriesUrl}, 章节列表不在首屏 HTML 中
 * - 章节列表: POST {seriesUrl}ajax/chapters/ (wp-manga 插件)
 * - 阅读页: {chapterUrl}, 图片为 img.wp-manga-chapter-img 直链(src 有前导空格需 trim)
 *
 * 注意:
 * - 正文图片按章节新旧分布在不同域名(lilymanga.net / glcomic / imgftp 等),
 *   直接使用页面内的绝对 URL, 不做域名改写
 * - 部分旧章节的图片 CDN 在某些网络环境下可能无法访问
 */

const UA =
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

const DEFAULT_DOMAIN = "lilymanga.net";

/** gl-genre 题材, value 为 URL 路径 */
const GENRES = [
    "action-Action", "adventure-Adventure", "comedy-Comedy", "doujinshi-Doujinshi",
    "drama-Drama", "ecchi-Ecchi", "fantasy-Fantasy", "gender-bender-Gender Bender",
    "harem-Harem", "historical-Historical", "horror-Horror", "isekai-Isekai",
    "josei-Josei", "mature-Mature", "mecha-Mecha", "mystery-Mystery",
    "oneshots-Oneshots", "psychological-Psychological", "romance-Romance",
    "school-life-School Life", "sci-fi-Sci-fi", "seinen-Seinen", "shoujo-ai-Shoujo Ai",
    "shoujo-Shoujo", "slice-of-life-Slice of Life", "smut-Smut", "sports-Sports",
    "supernatural-Supernatural", "tragedy-Tragedy", "yuri-Yuri",
];

/** gl-tag 作品类型 */
const TYPES = [
    "manga-Manga", "manhua-Manhua", "manhwa-Manhwa", "webtoon-Webtoon",
];

class LilyManga extends ComicSource {
    name = "Lily Manga";

    key = "lilymanga";

    version = "1.0.0";

    minAppVersion = "1.4.6";

    url = "https://raw.githubusercontent.com/yybwx/yurt-config/main/lilymanga.js";

    settings = {
        domain: {
            title: "域名",
            type: "input",
            default: DEFAULT_DOMAIN,
        },
    };

    get base() {
        const domain = (this.loadSetting("domain") || DEFAULT_DOMAIN).trim();
        return "https://" + domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    }

    _headers(referer) {
        const h = {
            "user-agent": UA,
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.9",
        };
        if (referer) h["referer"] = referer;
        return h;
    }

    /**
     * GET 页面并返回 HTML 字符串
     * @param url {string}
     * @param referer {string?}
     * @returns {Promise<string>}
     */
    async _getHtml(url, referer) {
        const res = await Network.get(url, this._headers(referer));
        if (res.status !== 200) {
            throw `Invalid status code: ${res.status}`;
        }
        return res.body;
    }

    /**
     * 解析漫画卡片列表 (.page-item-detail)
     * @param html {string}
     * @returns {Comic[]}
     */
    parseComicList(html) {
        const doc = new HtmlDocument(html);
        const comics = [];
        for (let item of doc.querySelectorAll(".page-item-detail")) {
            const titleLink = item.querySelector(".post-title a");
            if (!titleLink) continue;
            const href = titleLink.attributes["href"] || "";
            const m = /^https?:\/\/[^\/]+\/([^\/]+\/[^\/]+)\/?$/.exec(href);
            if (!m) continue;
            const img = item.querySelector(".item-thumb img");
            const cover = ((img && (img.attributes["src"] || img.attributes["data-src"])) || "").trim();
            const authors = [];
            for (let a of item.querySelectorAll(".author a")) {
                const t = a.text.trim();
                if (t) authors.push(t);
            }
            comics.push(new Comic({
                id: m[1],
                title: titleLink.text.trim(),
                subTitle: authors.join(", "),
                cover: cover,
                tags: [],
                description: "",
            }));
        }
        doc.dispose();
        return comics;
    }

    /**
     * 加载归档页 (如 gl, gl-genre/action), page 从 1 开始
     * @param path {string} - 不含首尾斜杠的路径
     * @param page {number}
     * @returns {Promise<{comics: Comic[], maxPage: number}>}
     */
    async loadArchive(path, page) {
        const pageSeg = page > 1 ? `page/${page}/` : "";
        const url = `${this.base}/${path}/${pageSeg}`;
        const html = await this._getHtml(url, this.base + "/");
        const comics = this.parseComicList(html);
        // WordPress 数字分页只输出到当前页+1 的链接, 用下一页链接判断是否还有更多
        const hasNext = html.includes(`/${path}/page/${page + 1}/`);
        return {comics: comics, maxPage: hasNext ? page + 1 : page};
    }

    // explore page list
    explore = [
        {
            title: "最新更新",
            type: "multiPageComicList",
            load: async (page) => {
                return await this.loadArchive("gl", page);
            },
        },
    ];

    // categories
    category = {
        title: "Lily Manga",
        parts: [
            {
                name: "题材",
                type: "fixed",
                categories: [
                    {label: "全部", target: {page: "category", attributes: {category: "gl", param: null}}},
                    ...GENRES.map((g) => {
                        const [value, text] = g.split("-");
                        return {
                            label: text,
                            target: {page: "category", attributes: {category: `gl-genre/${value}`, param: null}},
                        };
                    }),
                ],
            },
            {
                name: "类型",
                type: "fixed",
                categories: TYPES.map((t) => {
                    const [value, text] = t.split("-");
                    return {
                        label: text,
                        target: {page: "category", attributes: {category: `gl-tag/${value}`, param: null}},
                    };
                }),
            },
        ],
        enableRankingPage: false,
    };

    /// category comic loading related
    categoryComics = {
        load: async (category, param, options, page) => {
            return await this.loadArchive(category, page);
        },
    };

    /// search related
    search = {
        load: async (keyword, options, page) => {
            let url = `${this.base}/?s=${encodeURIComponent(keyword)}&post_type=wp-manga`;
            if (page > 1) url += `&paged=${page}`;
            const html = await this._getHtml(url, this.base + "/");
            const comics = this.parseComicList(html);
            // 搜索页无数字分页标记, 每页固定 24 条, 满页则允许继续翻页
            return {comics: comics, maxPage: comics.length >= 24 ? page + 1 : page};
        },

        enableTagsSuggestions: false,
    };

    /// single comic related
    comic = {
        /**
         * @param id {string} - 形如 "gl/love-gives-me-superpowers" 的路径
         */
        loadInfo: async (id) => {
            const seriesUrl = `${this.base}/${id}/`;
            const html = await this._getHtml(seriesUrl, this.base + "/");
            const doc = new HtmlDocument(html);

            const title = (doc.querySelector(".post-title h1")?.text || "").trim();
            const cover = ((doc.querySelector(".summary_image img")?.attributes || {})["src"] || "").trim();
            const description = (doc.querySelector(".summary__content")?.text || "").trim();

            const genres = [];
            for (let a of doc.querySelectorAll(".genres-content a")) {
                const t = a.text.trim();
                if (t) genres.push(t);
            }
            const authors = [];
            for (let a of doc.querySelectorAll(".author-content a")) {
                const t = a.text.trim();
                if (t) authors.push(t);
            }
            const tags = {
                "作者": authors,
                "题材": genres,
            };
            // 状态/别名在 .post-content_item 中按标题匹配
            let status = "";
            let altTitle = "";
            for (let item of doc.querySelectorAll(".post-status .post-content_item, .post-content_item")) {
                const heading = (item.querySelector(".summary-heading")?.text || "").trim().toLowerCase();
                const content = (item.querySelector(".summary-content")?.text || "").trim();
                if (heading === "status" && !status) {
                    status = content;
                } else if (heading === "alternative" && !altTitle) {
                    altTitle = content;
                }
            }
            if (status) tags["状态"] = [status];
            if (altTitle) tags["别名"] = [altTitle];

            // 章节列表通过 wp-manga 插件的 ajax 接口加载
            const chapRes = await Network.post(
                `${seriesUrl}ajax/chapters/`,
                {
                    "user-agent": UA,
                    "x-requested-with": "XMLHttpRequest",
                    "referer": seriesUrl,
                    "accept": "*/*",
                }
            );
            if (chapRes.status !== 200) {
                throw `Invalid status code: ${chapRes.status}`;
            }
            const chapDoc = new HtmlDocument(chapRes.body);
            const entries = [];
            for (let li of chapDoc.querySelectorAll("li.wp-manga-chapter")) {
                const a = li.querySelector("a");
                if (!a) continue;
                const href = a.attributes["href"] || "";
                // 章节链接为完整路径, 如 gl/{slug}/episode-01
                const m = /^https?:\/\/[^\/]+\/(.+?)\/?$/.exec(href);
                if (!m) continue;
                entries.push([m[1], a.text.trim()]);
            }
            chapDoc.dispose();
            doc.dispose();

            const chapters = {};
            // 接口按最新在前返回, 反转为正序
            for (let i = entries.length - 1; i >= 0; i--) {
                chapters[entries[i][0]] = entries[i][1];
            }

            return {
                title: title,
                subtitle: authors.join(", "),
                cover: cover,
                description: description,
                tags: tags,
                chapters: chapters,
                updateTime: entries.length > 0 ? entries[0][1] : null,
                url: seriesUrl,
            };
        },

        loadEp: async (comicId, epId) => {
            const html = await this._getHtml(`${this.base}/${epId}/`, `${this.base}/${comicId}/`);
            const doc = new HtmlDocument(html);
            const images = [];
            for (let img of doc.querySelectorAll("img.wp-manga-chapter-img")) {
                const src = (img.attributes["src"] || img.attributes["data-src"] || "").trim();
                if (src) images.push(src);
            }
            doc.dispose();
            return {images: images};
        },

        link: {
            domains: ["lilymanga.net"],
            linkToId: (url) => {
                const m = /^https?:\/\/[^\/]*lilymanga\.net\/(gl(?:-[^\/]+)?\/[^\/]+)\/?$/i.exec(url);
                if (m) {
                    return m[1].toLowerCase();
                }
                return null;
            },
        },

        // enable tags translate
        enableTagsTranslate: false,
    }
}
