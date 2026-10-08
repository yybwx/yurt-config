/** @type {import('./_yurt_.js')} */

/**
 * 漫画160 (mh160mh.com)
 *
 * qTcms 漫画CMS 的手机版(必须使用移动端 UA, 桌面 UA 会被直接 404)。
 *
 * 站点结构:
 * - 更新/排行: /kanmanhua/zaixian_recent.html, /kanmanhua/zaixian_hit.html (各50部, 单页)
 * - 分类: /kanmanhua/{category}/ 第2页起 /kanmanhua/{category}/{page}.html
 * - 详情: /kanmanhua/{slug}/ (og: meta 标签带元数据, 章节在 #chapterList_ul_1)
 * - 阅读: /kanmanhua/{slug}/{chapterId}.html, 图片列表在 qTcms_S_m_murl_e (base64,
 *   以 $qingtiandy$ 分隔), 前缀取图片镜像域名
 * - 搜索: POST /statics/qingtiancms.ashx (action=GetWapSear1, 返回JSON);
 *   失败时回退 GET /statics/search.aspx?key= (有 Cloudflare, 需先通过验证)
 *
 * 注意:
 * - 图片镜像(tgmhfc.uk)与封面(p.miyeye.cn)均有防盗链, 必须携带本站 Referer
 * - .ashx 动态接口对部分海外 IP 直接返回 404, 属站点端地理限制
 */

const UA =
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

const DEFAULT_DOMAIN = "m.mh160mh.com";

/** 图片镜像, 对应站点 JS 中 gethost() 的服务器列表 */
const IMAGE_HOSTS = [
    {value: "xwdf.tgmhfc.uk"},
    {value: "mhreswhm.tgmhfc.uk"},
    {value: "qwe123.tgmhfc.uk"},
    {value: "resmhpic.tgmhfc.uk"},
    {value: "reszxc.tgmhfc.uk"},
];

/** 分类: label-路径 */
const CATEGORIES = [
    "连载中-lianzai", "已完结-wanjie", "日韩-zaixian_rhmh", "内地-zaixian_dlmh", "港台-zaixian_gtmh",
    "欧美-zaixian_ommh", "热血-rexue", "格斗-gedou", "科幻-kehuan", "竞技-jingji", "搞笑-gaoxiao",
    "推理-tuili", "恐怖-kongbu", "冒险-maoxian", "玄幻-xuanhuan", "校园-xiaoyuan", "悬疑-xuanyi",
    "萌系-mengxi", "穿越-chuanyue", "后宫-hougong", "都市-dushi", "武侠-wuxia", "历史-lishi",
    "同人-tongren", "百合-baihe", "治愈-zhiyu", "机甲-jijia", "纯爱-chunai", "美食-meishi",
    "恋爱-lianai", "青春-qingchun", "浪漫-langman", "唯美-weimei", "耽美-danmei", "少女-shaonvqu",
];

class MH160 extends ComicSource {
    name = "漫画160";

    key = "mh160";

    version = "1.0.0";

    minAppVersion = "1.4.6";

    url = "https://raw.githubusercontent.com/yybwx/yurt-config/main/mh160.js";

    settings = {
        domain: {
            title: "域名",
            type: "input",
            default: DEFAULT_DOMAIN,
        },
        imageHost: {
            title: "图片线路",
            type: "select",
            options: IMAGE_HOSTS,
            default: "xwdf.tgmhfc.uk",
        },
    };

    get base() {
        const domain = (this.loadSetting("domain") || DEFAULT_DOMAIN).trim();
        return "https://" + domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    }

    get imageHost() {
        return this.loadSetting("imageHost") || "xwdf.tgmhfc.uk";
    }

    _headers(referer) {
        const h = {
            "user-agent": UA,
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "zh-CN,zh;q=0.9",
        };
        if (referer) h["referer"] = referer;
        return h;
    }

    /**
     * GET 页面, 404 时返回 null
     * @param path {string}
     * @param referer {string?}
     * @returns {Promise<string|null>}
     */
    async _getHtml(path, referer) {
        const res = await Network.get(this.base + path, this._headers(referer));
        if (res.status === 404) return null;
        if (res.status !== 200) {
            throw `Invalid status code: ${res.status}`;
        }
        return res.body;
    }

    /**
     * 从 HTML 中提取 og: meta 值
     * @param html {string}
     * @param prop {string}
     * @returns {string|null}
     */
    _meta(html, prop) {
        const re = new RegExp(`<meta[^>]*property="${prop}"[^>]*content="([^"]*)"`);
        const m = re.exec(html);
        if (m) return m[1];
        const re2 = new RegExp(`<meta[^>]*content="([^"]*)"[^>]*property="${prop}"`);
        const m2 = re2.exec(html);
        return m2 ? m2[1] : null;
    }

    /**
     * 解析更新/排行页条目 (.UpdateList .itemBox)
     * @param html {string}
     * @returns {Comic[]}
     */
    parseUpdateList(html) {
        const doc = new HtmlDocument(html);
        const comics = [];
        for (let box of doc.querySelectorAll(".UpdateList .itemBox")) {
            const link = box.querySelector(".itemImg a");
            if (!link) continue;
            const m = /\/kanmanhua\/([a-z0-9_]+)\/?/.exec(link.attributes["href"] || "");
            if (!m) continue;
            const img = box.querySelector(".itemImg img");
            comics.push(new Comic({
                id: m[1],
                title: (box.querySelector(".itemTxt .title")?.text || "").trim(),
                cover: img ? img.attributes["src"] : "",
                tags: [],
                description: "",
            }));
        }
        doc.dispose();
        return comics;
    }

    /**
     * 解析分类页条目 (li > a.ImgA + a.txtA)
     * @param html {string}
     * @returns {Comic[]}
     */
    parseCategoryList(html) {
        const doc = new HtmlDocument(html);
        const comics = [];
        for (let li of doc.querySelectorAll("ul.list li")) {
            const imgA = li.querySelector("a.ImgA");
            const txtA = li.querySelector("a.txtA");
            if (!imgA || !txtA) continue;
            const m = /\/kanmanhua\/([a-z0-9_]+)\/?/.exec(imgA.attributes["href"] || "");
            if (!m) continue;
            const img = imgA.querySelector("img");
            comics.push(new Comic({
                id: m[1],
                title: (txtA.text || "").trim(),
                cover: img ? img.attributes["src"] : "",
                subTitle: (li.querySelector(".info")?.text || "").trim(),
                tags: [],
                description: "",
            }));
        }
        doc.dispose();
        return comics;
    }

    // explore page list
    explore = [
        {
            title: "漫画160",
            type: "multiPartPage",
            load: async () => {
                const recentHtml = await this._getHtml("/kanmanhua/zaixian_recent.html", this.base + "/");
                const hitHtml = await this._getHtml("/kanmanhua/zaixian_hit.html", this.base + "/");
                return [
                    {title: "最新更新", comics: this.parseUpdateList(recentHtml)},
                    {title: "热门排行", comics: this.parseUpdateList(hitHtml)},
                ];
            },
        },
    ];

    // categories
    category = {
        title: "漫画160",
        parts: [
            {
                name: "分类",
                type: "fixed",
                categories: CATEGORIES.map((c) => {
                    const [label, value] = c.split("-");
                    return {
                        label: label,
                        target: {page: "category", attributes: {category: value, param: null}},
                    };
                }),
            },
        ],
        enableRankingPage: false,
    };

    /// category comic loading related
    categoryComics = {
        load: async (category, param, options, page) => {
            const path = page > 1 ? `/kanmanhua/${category}/${page}.html` : `/kanmanhua/${category}/`;
            const html = await this._getHtml(path, this.base + "/");
            if (html === null) {
                return {comics: [], maxPage: page};
            }
            const comics = this.parseCategoryList(html);
            return {comics: comics, maxPage: comics.length > 0 ? page + 1 : page};
        },
    };

    /// search related
    search = {
        load: async (keyword, options, page) => {
            if (page > 1) {
                return {comics: [], maxPage: 1};
            }
            // 1) 联想接口 (JSON)
            try {
                const res = await Network.post(
                    `${this.base}/statics/qingtiancms.ashx`,
                    {
                        "user-agent": UA,
                        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "x-requested-with": "XMLHttpRequest",
                        "referer": this.base + "/",
                        "accept": "*/*",
                    },
                    `action=GetWapSear1&key=${encodeURIComponent(keyword)}`
                );
                if (res.status === 200 && res.body.indexOf("{err!}") !== 0) {
                    const data = JSON.parse(res.body);
                    if (data.result === 1000 && data.data instanceof Array) {
                        const comics = [];
                        for (let item of data.data) {
                            const m = /\/kanmanhua\/([a-z0-9_]+)\/?/.exec(item.url || "");
                            if (!m) continue;
                            comics.push(new Comic({
                                id: m[1],
                                title: item.name || m[1],
                                cover: "",
                                tags: [],
                                description: "",
                            }));
                        }
                        if (comics.length > 0) {
                            return {comics: comics, maxPage: 1};
                        }
                    }
                }
            } catch (e) {
                // 落到搜索页方案
            }
            // 2) 搜索页 (可能需要先通过 Cloudflare 验证, 见 account.loginWithWebview)
            let html;
            try {
                html = await this._getHtml(
                    `/statics/search.aspx?key=${encodeURIComponent(keyword)}`,
                    this.base + "/"
                );
            } catch (e) {
                throw "搜索被拦截, 请在源设置的账号中点击登录完成网页验证后重试";
            }
            if (html === null) {
                throw "搜索接口不可用";
            }
            const doc = new HtmlDocument(html);
            const comics = [];
            for (let a of doc.querySelectorAll("a")) {
                const m = /\/kanmanhua\/([a-z0-9_]+)\/?/.exec(a.attributes["href"] || "");
                if (!m || m[1].indexOf("zaixian_") === 0) continue;
                const title = (a.attributes["title"] || a.text || "").trim();
                if (!title) continue;
                comics.push(new Comic({
                    id: m[1],
                    title: title,
                    cover: "",
                    tags: [],
                    description: "",
                }));
            }
            doc.dispose();
            // 去重
            const seen = {};
            const unique = comics.filter((c) => (seen[c.id] ? false : (seen[c.id] = true)));
            return {comics: unique, maxPage: 1};
        },

        enableTagsSuggestions: false,
    };

    // [Optional] account related
    account = {
        /**
         * 通过 webview 打开站点, 通过 Cloudflare 验证后 Cookie 自动保存,
         * 供搜索页 /statics/search.aspx 使用 (列表/详情/正文不受影响)。
         */
        loginWithWebview: {
            url: (() => {
                try {
                    const domain = (this.loadSetting("domain") || DEFAULT_DOMAIN).trim();
                    return "https://" + domain.replace(/^https?:\/\//, "").replace(/\/+$/, "") + "/";
                } catch (e) {
                    return "https://" + DEFAULT_DOMAIN + "/";
                }
            })(),
            checkStatus: (url, title) => {
                if (/Just a moment|Cloudflare|Attention Required/i.test(title || "")) {
                    return false;
                }
                return (title || "").indexOf("漫画160") !== -1;
            },
            onLoginSuccess: () => {
            },
        },

        logout: () => {
            Network.deleteCookies("https://" + DEFAULT_DOMAIN);
        },

        registerWebsite: null,
    };

    /// single comic related
    comic = {
        /**
         * @param id {string} - 详情页 slug, 如 aishanglaoshi
         */
        loadInfo: async (id) => {
            const html = await this._getHtml(`/kanmanhua/${id}/`, this.base + "/");
            if (html === null) {
                throw "漫画不存在或已下架";
            }
            const doc = new HtmlDocument(html);

            const title = this._meta(html, "og:novel:book_name")
                || (doc.querySelector(".txtItme.h1")?.text || "").trim();
            let cover = this._meta(html, "og:image") || "";
            cover = cover.split("@!")[0];
            const status = this._meta(html, "og:novel:status") || "";
            const categoryName = this._meta(html, "og:novel:category") || "";
            const updateTime = this._meta(html, "og:novel:update_time") || "";
            const description = (doc.querySelector(".detailContent p")?.text || "").trim();

            const tags = {};
            if (categoryName) tags["分类"] = [categoryName];
            if (status) tags["状态"] = [status];

            const chapters = {};
            const entries = [];
            for (let a of doc.querySelectorAll("#chapterList_ul_1 li a")) {
                const m = /\/kanmanhua\/[a-z0-9_]+\/(\d+)\.html/.exec(a.attributes["href"] || "");
                if (!m) continue;
                entries.push([m[1], (a.text || "").trim()]);
            }
            doc.dispose();
            // 站点按最新在前返回, 反转为正序
            for (let i = entries.length - 1; i >= 0; i--) {
                chapters[entries[i][0]] = entries[i][1];
            }

            return {
                title: title,
                cover: cover,
                description: description,
                tags: tags,
                chapters: chapters,
                updateTime: updateTime,
                url: `${this.base}/kanmanhua/${id}/`,
            };
        },

        loadEp: async (comicId, epId) => {
            const html = await this._getHtml(
                `/kanmanhua/${comicId}/${epId}.html`,
                `${this.base}/kanmanhua/${comicId}/`
            );
            if (html === null) {
                throw "章节不存在";
            }
            const encoded = /qTcms_S_m_murl_e\s*=\s*"([^"]+)"/.exec(html);
            if (!encoded) {
                throw "未找到图片数据";
            }
            const mId = (/qTcms_S_m_id\s*=\s*"(\d+)"/.exec(html) || [])[1] || "";
            // base64 解码为 UTF-8 路径列表
            let b64 = encoded[1];
            while (b64.length % 4 !== 0) b64 += "=";
            const decoded = Convert.decodeUtf8(Convert.decodeBase64(b64));
            const paths = decoded.split("$qingtiandy$");
            const images = [];
            for (let p of paths) {
                p = p.trim();
                if (!p) continue;
                if (p.startsWith("/")) {
                    images.push(`https://${this.imageHost}${encodeURI(p)}`);
                } else {
                    // 相对路径走站点图片代理
                    const escaped = p.replace(/\?/g, "a1a1").replace(/&/g, "b1b1").replace(/%/g, "c1c1");
                    images.push(`${this.base}/statics/pic/?p=${encodeURIComponent(escaped)}&wapif=1&picid=${mId}&m_httpurl=`);
                }
            }
            return {images: images};
        },

        onImageLoad: (url, comicId, epId) => {
            return {
                headers: {
                    "user-agent": UA,
                    "referer": `${this.base}/`,
                },
            };
        },

        onThumbnailLoad: (url) => {
            return {
                headers: {
                    "user-agent": UA,
                    "referer": `${this.base}/`,
                },
            };
        },

        link: {
            domains: ["mh160mh.com"],
            linkToId: (url) => {
                const m = /^https?:\/\/[^\/]*mh160mh\.com\/kanmanhua\/([a-z0-9_]+)\/?$/i.exec(url);
                if (m && m[1] !== "all") {
                    return m[1];
                }
                return null;
            },
        },

        // enable tags translate
        enableTagsTranslate: false,
    }
}
