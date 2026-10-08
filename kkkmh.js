/** @type {import('./_yurt_.js')} */

/**
 * 极速漫画 (m.1kkk.com)
 *
 * 动漫屋(dm5)家族的移动端镜像站, 与 dm5 共用 cdndm5.com 的资源与模板。
 *
 * 站点结构:
 * - 详情: /manhua{id}/ (章节为 a.chapteritem, href 形如 /ch{n}-{cid}/)
 * - 阅读: /ch{n}-{cid}/, 图片列表内嵌在页面中的 Dean Edwards packer
 *   (eval(function(p,a,c,k,e,d)...)) 里, 解包后为 newImgs=['..'] 数组
 * - 搜索: /search?title={kw}&language=1 (SSR, .book-list)
 * - 分类: /manhua-{tag}/ 第一页 SSR, 翻页 POST /dm5.ashx
 *   (action=getclasscomics, 页面内 var tagid 提供分类id)
 * - 全部列表: /manhua-list/ (tagid=0)
 *
 * 注意:
 * - 必须使用移动端 UA (桌面 UA 部分页面 404)
 * - 正文图片(签名URL)有防盗链, 需携带本站 Referer; 封面无限制
 * - 部分漫画个别章节被版权过滤, 打开为提示页(与 dm5 主站同策略)
 */

const UA =
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

const DEFAULT_DOMAIN = "m.1kkk.com";

/** 分类: label-路径 */
const CATEGORIES = [
    "全部-list", "原创精品-original", "日漫-jpkr", "已完结-completed", "热血-rexue", "恋爱-aiqing",
    "校园-xiaoyuan", "冒险-maoxian", "职场-zhichang", "后宫-hougong", "治愈-zhiyu",
    "科幻-kehuan", "励志-lizhi", "生活-shenghuoqinqing", "战争-zhanzheng", "悬疑-xuanyi",
    "推理-zhentan", "搞笑-gaoxiao", "奇幻-qihuan", "魔法-mofa", "神鬼-dongfangshengui",
    "萌系-mengxi", "历史-lishi", "美食-meishi", "同人-tongren", "运动-jingji",
    "绅士-jiecao", "机甲-jizhan", "伪娘-weiniang",
];

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Dean Edwards packer 解包 (eval(function(p,a,c,k,e,d){...}))
 * @param packed {string} 完整的 eval(...) 语句
 * @returns {string|null} 解包后的 JS 源码
 */
function unpackPacker(packed) {
    const m = /\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\),0,\{\}\)/.exec(packed);
    if (!m) return null;
    const p = m[1].replace(/\\'/g, "'");
    const a = parseInt(m[2]);
    const keys = m[4].replace(/\\'/g, "'").split("|");

    function base36(n) {
        if (n === 0) return "0";
        let s = "";
        while (n > 0) {
            s = DIGITS[n % 36] + s;
            n = Math.floor(n / 36);
        }
        return s;
    }

    function replaceToken(tok) {
        let v = 0;
        for (let i = 0; i < tok.length; i++) {
            const idx = DIGITS.indexOf(tok[i]);
            if (idx < 0 || idx >= a) return tok;
            v = v * a + idx;
        }
        if (v < keys.length && keys[v] !== "") return keys[v];
        return v > 35 ? base36(v) : DIGITS[v];
    }

    return p.replace(/\b\w+\b/g, replaceToken);
}

class KKKMH extends ComicSource {
    name = "极速漫画";

    key = "kkkmh";

    version = "1.0.0";

    minAppVersion = "1.4.6";

    url = "https://raw.githubusercontent.com/yybwx/yurt-config/main/kkkmh.js";

    settings = {
        domain: {
            title: "域名",
            type: "input",
            default: DEFAULT_DOMAIN,
        },
    };

    init() {
        /** 分类页 tagid 缓存: cat -> tagid */
        this._tagIds = {};
    }

    get base() {
        const domain = (this.loadSetting("domain") || DEFAULT_DOMAIN).trim();
        return "https://" + domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
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

    async _getHtml(path, referer) {
        const res = await Network.get(this.base + path, this._headers(referer));
        if (res.status !== 200) {
            throw `Invalid status code: ${res.status}`;
        }
        return res.body;
    }

    /**
     * 解析漫画条目 (分类页 .manga-list-2 / 搜索页 .book-list)
     * @param html {string}
     * @returns {Comic[]}
     */
    parseList(html) {
        const doc = new HtmlDocument(html);
        const comics = [];
        const seen = {};
        for (let li of doc.querySelectorAll(".manga-list-2 li, .book-list li")) {
            const titleA = li.querySelector(".manga-list-2-title a, .book-list-info-title a")
                || li.querySelector("a[href*='/manhua']");
            if (!titleA) continue;
            const m = /\/manhua(\d+)\//.exec(titleA.attributes["href"] || "");
            if (!m) continue;
            if (seen[m[1]]) continue;
            seen[m[1]] = true;
            const img = li.querySelector("img");
            comics.push(new Comic({
                id: m[1],
                title: (titleA.text || "").trim(),
                cover: img ? (img.attributes["src"] || img.attributes["data-src"] || "") : "",
                subTitle: (li.querySelector(".manga-list-2-tip a, .book-list-info-tip a")?.text || "").trim(),
                tags: [],
                description: "",
            }));
        }
        doc.dispose();
        return comics;
    }

    /**
     * 通过 dm5.ashx 加载分类列表页
     * @param page {number}
     * @param tagid {string}
     * @returns {Promise<Comic[]>}
     */
    async loadClassComics(page, tagid) {
        const res = await Network.post(
            `${this.base}/dm5.ashx`,
            {
                "user-agent": UA,
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                "x-requested-with": "XMLHttpRequest",
                "referer": this.base + "/",
                "accept": "application/json, text/javascript, */*; q=0.01",
            },
            `action=getclasscomics&pageindex=${page}&pagesize=10&categoryid=0&tagid=${tagid}` +
            `&status=0&usergroup=0&pay=-1&areaid=0&sort=10&iscopyright=0`
        );
        if (res.status !== 200) {
            throw `Invalid status code: ${res.status}`;
        }
        const data = JSON.parse(res.body);
        const comics = [];
        for (let item of data.UpdateComicItems || []) {
            comics.push(new Comic({
                id: String(item.ID),
                title: item.Title,
                cover: item.ShowPicUrlB || "",
                subTitle: (item.Status === 1 ? "完结 " : "最新 ") + (item.ShowLastPartName || ""),
                tags: [],
                description: "",
            }));
        }
        return comics;
    }

    // explore page list
    explore = [
        {
            title: "最新更新",
            type: "multiPageComicList",
            load: async (page) => {
                if (page === 1) {
                    const html = await this._getHtml("/manhua-list/", this.base + "/");
                    const comics = this.parseList(html);
                    this._tagIds["list"] = "0";
                    return {comics: comics, maxPage: 2};
                }
                const comics = await this.loadClassComics(page, "0");
                return {comics: comics, maxPage: comics.length > 0 ? page + 1 : page};
            },
        },
    ];

    // categories
    category = {
        title: "极速漫画",
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
            let tagid = this._tagIds[category];
            if (page === 1 || tagid === undefined) {
                const html = await this._getHtml(`/manhua-${category}/`, this.base + "/");
                const m = /var tagid = "(\d+)"/.exec(html);
                tagid = m ? m[1] : "0";
                this._tagIds[category] = tagid;
                if (page === 1) {
                    const comics = this.parseList(html);
                    return {comics: comics, maxPage: comics.length > 0 ? 2 : 1};
                }
            }
            const comics = await this.loadClassComics(page, tagid);
            return {comics: comics, maxPage: comics.length > 0 ? page + 1 : page};
        },
    };

    /// search related
    search = {
        load: async (keyword, options, page) => {
            if (page > 1) {
                return {comics: [], maxPage: 1};
            }
            const html = await this._getHtml(
                `/search?title=${encodeURIComponent(keyword)}&language=1`,
                this.base + "/"
            );
            return {comics: this.parseList(html), maxPage: 1};
        },

        enableTagsSuggestions: false,
    };

    /// single comic related
    comic = {
        /**
         * @param id {string} - 数字漫画id, 如 87063
         */
        loadInfo: async (id) => {
            const html = await this._getHtml(`/manhua${id}/`, this.base + "/");
            const doc = new HtmlDocument(html);

            const title = (doc.querySelector(".detail-main-info-title")?.text || "").trim();
            const cover = doc.querySelector(".detail-main-cover img")?.attributes["src"] || "";
            const description = (doc.querySelector(".detail-desc")?.text || "").trim();
            const authors = [];
            for (let a of doc.querySelectorAll(".detail-main-info-author a")) {
                const t = a.text.trim();
                if (t) authors.push(t);
            }
            const genres = [];
            for (let a of doc.querySelectorAll(".detail-main-info-class a")) {
                const t = a.text.trim();
                if (t) genres.push(t);
            }
            const status = (doc.querySelector(".detail-selector-item")?.text || "").trim();

            const tags = {};
            if (authors.length > 0) tags["作者"] = authors;
            if (genres.length > 0) tags["分类"] = genres;
            if (status) tags["状态"] = [status];

            const chapters = {};
            const entries = [];
            for (let a of doc.querySelectorAll("a.chapteritem")) {
                const m = /\/ch\d+-(\d+)\//.exec(a.attributes["href"] || "");
                if (!m) continue;
                entries.push([m[1], (a.text || "").trim()]);
            }
            // 站点按最新在前返回, 反转为正序
            for (let i = entries.length - 1; i >= 0; i--) {
                chapters[entries[i][0]] = entries[i][1];
            }
            doc.dispose();

            if (entries.length === 0) {
                throw "未找到章节";
            }

            return {
                title: title,
                cover: cover,
                description: description,
                tags: tags,
                chapters: chapters,
                updateTime: entries[0][1],
                url: `${this.base}/manhua${id}/`,
            };
        },

        loadEp: async (comicId, epId) => {
            const html = await this._getHtml(`/ch0-${epId}/`, `${this.base}/manhua${comicId}/`);
            // 图片列表在 packer 加密的 eval 脚本中
            const m = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('[\s\S]*?\.split\('\|'\),0,\{\}\)\)/.exec(html);
            if (!m) {
                throw "未找到图片数据(章节可能已被屏蔽)";
            }
            const unpacked = unpackPacker(m[0]);
            const images = [];
            const re = /'(https?:\/\/[^']+)'/g;
            let mm;
            while ((mm = re.exec(unpacked)) !== null) {
                images.push(mm[1]);
            }
            if (images.length === 0) {
                throw "图片解析失败";
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

        link: {
            domains: ["1kkk.com"],
            linkToId: (url) => {
                const m = /^https?:\/\/[^\/]*1kkk\.com\/manhua(\d+)\/?/i.exec(url);
                return m ? m[1] : null;
            },
        },

        // enable tags translate
        enableTagsTranslate: false,
    }
}
