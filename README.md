# Yurt Config

Yurt 的漫画源配置仓库，维护源列表与 JavaScript 脚本。

## 在 Yurt 中使用

将漫画源列表地址设置为：

```text
https://raw.githubusercontent.com/yybwx/yurt-config/main/index.json
```

列表通过 `fileName` 获取同目录的脚本；各脚本的 `url` 指向本仓库的 Raw 文件，用于后续更新。文件地址需要无需登录即可返回 JSON 或 JavaScript 内容。

已安装的旧源需要换成使用本仓库更新地址的脚本。仅修改列表地址不会改写手机上已有脚本中的 `url`；迁移时保持 `key` 不变，以继续关联已有漫画记录。

## 编写与维护漫画源

1. 将 `_template_.js` 和 `_yurt_.js` 放在同一目录。
2. 把 `_template_.js` 复制为新源文件，按注释填写配置。
3. `_yurt_.js` 提供 IDE 的 API 类型提示，不需要作为漫画源导入。
4. 在 `index.json` 中登记源名称、文件名、唯一 `key` 和版本；版本应与脚本的 `version` 一致。
5. 脚本的 `url` 填写本仓库中该脚本的 Raw 地址。

仓库分发与漫画网站的可用性分别维护。网站接口或域名变化时，需要更新对应脚本。
