/** @type {import('./_yurt_.js')} */
class GuaziManhua extends ComicSource {
  name = "瓜子漫画";

  key = "guazi";

  version = "1.0.1";

  minAppVersion = "1.4.0";

  // update url
  url = "https://gitee.com/biguoming/yurt-config/raw/main/guazi.js";

  static defaultDomain = "www.guazimanhua.com";

  get baseUrl() {
    let domain = this.loadSetting("domain") || GuaziManhua.defaultDomain;
    return `https://${domain}`;
  }

  init() {
    this.ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

    this.fetchHtml = async (path) => {
      let res = await Network.sendRequest("GET", this.baseUrl + path, {
        "user-agent": this.ua,
        referer: this.baseUrl + "/",
      });
      if (res.status !== 200) {
        throw `Invalid status code: ${res.status}`;
      }
      return res.body;
    };

    this.logger = {
      error: (msg) => log("error", this.name, msg),
      info: (msg) => log("info", this.name, msg),
      warn: (msg) => log("warning", this.name, msg),
    };
  }

  // 从列表页解析漫画卡片
  parseCards(doc) {
    let comics = [];
    let cards = doc.querySelectorAll("article.card");
    for (let i = 0; i < cards.length; i++) {
      let card = cards[i];
      let link = card.querySelector("a[href*='comic.php?id=']");
      if (!link) continue;
      let href = link.attributes.href || "";
      let m = /[?&]id=(\d+)/.exec(href);
      if (!m) continue;
      let img = card.querySelector("img");
      let titleEl = card.querySelector("h3 a");
      let metaEl = card.querySelector(".meta");
      let genreEl = card.querySelector(".genre");
      let scoreEl = card.querySelector(".score");
      let metaText = metaEl ? metaEl.text.trim() : "";
      let metaParts = metaText
        .split("·")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      let tags = metaParts.slice(1);
      let statusText = genreEl ? genreEl.text.trim() : "";
      let comic = new Comic({
        id: m[1],
        title: titleEl ? titleEl.text.trim() : m[1],
        subTitle: metaParts[0] || "",
        cover: img ? img.attributes.src : "",
        tags: tags,
        description: "",
        status: statusText,
        stars: scoreEl ? parseFloat(scoreEl.text) : undefined,
      });
      comics.push(comic);
    }
    return comics;
  }

  // 从 "第 1 / 23 页" 或分页链接解析总页数
  parseMaxPage(html) {
    let m = /第\s*(\d+)\s*\/\s*(\d+)\s*页/.exec(html);
    if (m) {
      return parseInt(m[2]);
    }
    let pages = [1];
    let re = /[?&]page=(\d+)/g;
    let mm;
    while ((mm = re.exec(html)) !== null) {
      pages.push(parseInt(mm[1]));
    }
    return Math.max.apply(null, pages);
  }

  // 提取页面中所有 JSON-LD 数据(展开 @graph)
  getJsonLd(doc) {
    let result = [];
    let scripts = doc.querySelectorAll("script");
    for (let i = 0; i < scripts.length; i++) {
      let attrs = scripts[i].attributes;
      if (!attrs || attrs.type !== "application/ld+json") continue;
      let text = scripts[i].text;
      if (!text) continue;
      try {
        let data = JSON.parse(text);
        let arr = Array.isArray(data) ? data : [data];
        for (let j = 0; j < arr.length; j++) {
          let node = arr[j];
          if (node && node["@graph"]) {
            result = result.concat(node["@graph"]);
          } else if (node) {
            result.push(node);
          }
        }
      } catch (e) {
        // ignore invalid json-ld
      }
    }
    return result;
  }

  // 加载列表型页面(分类/搜索/排序), 返回 {comics, maxPage}
  loadComicList = async (path) => {
    let html = await this.fetchHtml(path);
    let doc = new HtmlDocument(html);
    let comics;
    try {
      comics = this.parseCards(doc);
    } finally {
      doc.dispose();
    }
    return {
      comics: comics,
      maxPage: this.parseMaxPage(html),
    };
  };

  // explore page list
  explore = [
    {
      title: "今日热门",
      type: "multiPageComicList",
      load: async (page) => {
        return await this.loadComicList(`/category.php?sort=daily&page=${page}`);
      },
    },
    {
      title: "人气漫画",
      type: "multiPageComicList",
      load: async (page) => {
        return await this.loadComicList(`/category.php?sort=hits&page=${page}`);
      },
    },
    {
      title: "最近更新",
      type: "multiPageComicList",
      load: async (page) => {
        return await this.loadComicList(`/category.php?sort=update&page=${page}`);
      },
    },
    {
      title: "评分最高",
      type: "multiPageComicList",
      load: async (page) => {
        return await this.loadComicList(`/category.php?sort=score&page=${page}`);
      },
    },
  ];

  // categories
  category = {
    title: "分类",
    parts: [
      {
        name: "类型",
        type: "fixed",
        categories: [
          "全部",
          "热血",
          "古风",
          "都市",
          "玄幻",
          "科幻",
          "悬疑",
          "搞笑",
          "恋爱",
          "校园",
          "冒险",
          "霸总",
          "穿越",
          "奇幻",
          "灵异",
          "动作",
          "恐怖",
          "系统",
          "耽美",
          "逆袭",
          "脑洞",
          "复仇",
          "真人",
          "其它",
        ],
        itemType: "category",
        categoryParams: [
          "",
          "13",
          "23",
          "42",
          "25",
          "22",
          "11",
          "15",
          "9",
          "29",
          "30",
          "5",
          "8",
          "31",
          "21",
          "54",
          "14",
          "148",
          "41",
          "97",
          "55",
          "61",
          "17",
          "27",
        ],
      },
    ],
    enableRankingPage: false,
  };

  /// category comic loading related
  categoryComics = {
    load: async (category, param, options, page) => {
      let params = [];
      if (param) {
        params.push("cid=" + param);
      }
      // options[0]: 进度
      if (options[0] == "1") {
        params.push("is_end=2");
      } else if (options[0] == "2") {
        params.push("is_end=1");
      }
      // options[1]: 排序
      if (options[1] == "1") {
        params.push("sort=daily");
      } else if (options[1] == "2") {
        params.push("sort=hits");
      } else if (options[1] == "3") {
        params.push("sort=update");
      } else if (options[1] == "4") {
        params.push("sort=score");
      }
      // options[2]: 地区
      if (options[2] != "0") {
        params.push("city=" + options[2]);
      }
      params.push("page=" + page);
      let path = "/category.php?" + params.join("&");
      return await this.loadComicList(path);
    },
    optionList: [
      {
        options: ["0-全部", "1-连载中", "2-已完结"],
      },
      {
        options: ["0-默认", "1-今日热门", "2-人气", "3-更新", "4-评分"],
      },
      {
        options: ["0-全部", "42-大陆", "43-欧美", "77-港台", "78-日韩", "338-国漫"],
      },
    ],
  };

  /// search related
  search = {
    load: async (keyword, options, page) => {
      let path =
        "/category.php?keyword=" +
        encodeURIComponent(keyword) +
        "&page=" +
        page;
      return await this.loadComicList(path);
    },
  };

  /// single comic related
  comic = {
    loadInfo: async (id) => {
      let html = await this.fetchHtml(`/comic.php?id=${id}`);
      let doc = new HtmlDocument(html);
      let title = "";
      let author = "";
      let cover = "";
      let description = "";
      let tags = [];
      let jsonLdChapters = null; // [id, title][] 正序, 可能被截断
      let updateTime = "";

      try {
        let nodes = this.getJsonLd(doc);
        for (let i = 0; i < nodes.length; i++) {
          let node = nodes[i];
          let type = node["@type"];
          if (type === "ComicStory") {
            title = node.name || title;
            if (node.author && node.author.name) {
              author = node.author.name;
            }
            cover = node.image || cover;
            description = node.description || description;
            if (Array.isArray(node.genre)) {
              tags = node.genre;
            }
            updateTime = node.dateModified || updateTime;
          } else if (
            type === "ItemList" &&
            node.name &&
            node.name.indexOf("章节") !== -1 &&
            Array.isArray(node.itemListElement)
          ) {
            let items = node.itemListElement.slice();
            items.sort(function (a, b) {
              return (a.position || 0) - (b.position || 0);
            });
            let list = [];
            for (let j = 0; j < items.length; j++) {
              let item = items[j];
              let url = item.url || (item.item && item.item.url) || "";
              let name = item.name || (item.item && item.item.name) || "";
              let m = /[?&]id=(\d+)/.exec(url);
              if (m) {
                list.push([m[1], name]);
              }
            }
            jsonLdChapters = list;
          }
        }

        // 状态: 从页面徽章或 meta 描述中提取
        let status = "";
        let badge = doc.querySelector("span.badge");
        if (badge) {
          status = badge.text.trim();
        }
        if (!status) {
          let metaMatch = /当前状态为(完结|连载)/.exec(html);
          if (metaMatch) {
            status = metaMatch[1] === "完结" ? "已完结" : "连载中";
          }
        }
        if (status === "连载") {
          status = "连载中";
        } else if (status === "完结") {
          status = "已完结";
        }

        // JSON-LD 缺失时的兜底: 解析基础字段
        if (!title || !jsonLdChapters) {
          let authorLink = doc.querySelector("a[href*='author.php?name=']");
          if (authorLink && !author) {
            author = authorLink.text.trim();
          }
          let coverImg = doc.querySelector("img.mobile-comic-cover, img.cover");
          if (coverImg && !cover) {
            cover = coverImg.attributes.src || "";
          }
          if (!title) {
            let titleEl = doc.querySelector(".mobile-comic-title, h1");
            if (titleEl) {
              title = titleEl.text.trim();
            }
          }
          if (!description) {
            let descEl = doc.querySelector(".mobile-comic-desc");
            if (descEl) {
              description = descEl.text.trim();
            }
          }
        }

        // 章节目录: 优先解析页面章节网格(完整列表, 倒序)
        // 注意: JSON-LD 的章节 itemListElement 最多只列前50章(numberOfItems 才是总数)
        let gridChapters = [];
        let grid = doc.querySelector("[data-mobile-chapter-list]");
        if (grid) {
          let links = grid.querySelectorAll("a[href*='chapter.php?id=']");
          let seen = {};
          for (let k = 0; k < links.length; k++) {
            let link = links[k];
            let href = link.attributes.href || "";
            let m = /[?&]id=(\d+)/.exec(href);
            if (!m || seen[m[1]]) continue;
            seen[m[1]] = true;
            gridChapters.push([m[1], link.text.trim()]);
          }
          // 页面章节链接为倒序(最新在前), 转为正序
          gridChapters.reverse();
        }
        let chapters =
          gridChapters.length >= (jsonLdChapters ? jsonLdChapters.length : 0)
            ? gridChapters
            : jsonLdChapters || [];
        // 最后兜底: 全文任意章节链接
        if (chapters.length === 0) {
          chapters = [];
          let links = doc.querySelectorAll("a[href*='chapter.php?id=']");
          let seen = {};
          for (let k = 0; k < links.length; k++) {
            let link = links[k];
            let href = link.attributes.href || "";
            let m = /[?&]id=(\d+)/.exec(href);
            if (!m || seen[m[1]]) continue;
            seen[m[1]] = true;
            chapters.push([m[1], link.text.trim()]);
          }
          chapters.reverse();
        }

        let chapterMap = new Map();
        for (let k = 0; k < chapters.length; k++) {
          chapterMap.set(chapters[k][0], chapters[k][1]);
        }

        let tagMap = {};
        if (tags.length > 0) {
          tagMap["分类"] = tags;
        }
        if (status) {
          tagMap["状态"] = [status];
        }

        return new ComicDetails({
          title: title,
          subTitle: author,
          cover: cover,
          description: description,
          tags: tagMap,
          chapters: chapterMap,
          updateTime: updateTime,
        });
      } finally {
        doc.dispose();
      }
    },
    /**
     * load images of a chapter
     * @param comicId {string}
     * @param epId {string?} - chapter.php?id= 的 id
     * @returns {Promise<{images: string[]}>}
     */
    loadEp: async (comicId, epId) => {
      let html = await this.fetchHtml(`/chapter.php?id=${epId}`);
      let doc = new HtmlDocument(html);
      let images = [];
      try {
        // 主解析: 页面 img.reading-image 标签(完整列表, 按 data-page 排序)
        // 注意: JSON-LD 的 itemListElement 每章最多只列前20张(numberOfItems 才是总数)
        let imgs = doc.querySelectorAll("img.reading-image");
        let arr = [];
        for (let k = 0; k < imgs.length; k++) {
          let src = imgs[k].attributes.src;
          if (!src || !/^https?:\/\//.test(src)) continue;
          let page = parseInt(imgs[k].attributes["data-page"] || "0");
          arr.push([isNaN(page) ? k : page, src]);
        }
        arr.sort(function (a, b) {
          return a[0] - b[0];
        });
        images = arr.map(function (x) {
          return x[1];
        });

        // 兜底: JSON-LD 图片列表(仅当页面无 reading-image 标签时)
        if (images.length === 0) {
          let nodes = this.getJsonLd(doc);
          for (let i = 0; i < nodes.length; i++) {
            let node = nodes[i];
            if (
              node["@type"] === "ItemList" &&
              Array.isArray(node.itemListElement)
            ) {
              let items = node.itemListElement.slice();
              items.sort(function (a, b) {
                return (a.position || 0) - (b.position || 0);
              });
              for (let j = 0; j < items.length; j++) {
                let item = items[j];
                let obj = item.item || item;
                if (
                  obj &&
                  typeof obj.url === "string" &&
                  /img\./.test(obj.url)
                ) {
                  images.push(obj.url);
                }
              }
            }
          }
        }
      } finally {
        doc.dispose();
      }
      return {
        images: images,
      };
    },
  };

  settings = {
    domain: {
      title: "自定义域名",
      type: "input",
      validator: String.raw`^(?!:\/\/)(?=.{1,253})([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$`,
      default: GuaziManhua.defaultDomain,
    },
  };
}
