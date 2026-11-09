# XArrPay 插件应用源

## 应用源链接

在 XArrPay 后台的应用商店里添加下面任意一个链接：

| 线路 | 链接 |
|---|---|
| GitHub 直连 | `https://raw.githubusercontent.com/HunterWangwei/xarr-plugins/main/source.json` |
| jsDelivr 加速（国内推荐） | `https://cdn.jsdelivr.net/gh/HunterWangwei/xarr-plugins@main/source-cdn.json` |

两条线路的区别在于插件下载地址：GitHub 直连从 raw.githubusercontent.com 下载，jsDelivr 线路从 jsDelivr 下载。jsDelivr 有缓存，发布新版本后最长要等 12 小时才会更新，要立刻生效可以访问 `https://purge.jsdelivr.net/gh/HunterWangwei/xarr-plugins@main/source-cdn.json` 手动刷新。

## 插件列表

| 插件 | 说明 |
|---|---|
| [binance_pay](plugins/binance_pay/) | 币安ID收款：通过币安官方 Pay 接口监控到账 |

## 发布新版本

1. 修改 `plugins/<插件名>/` 里的代码，然后在 `manifest.json` 里提高 `version`。
2. 运行 `node build.js`（需要 Node 22 以上），它会重新生成 `dist/*.zip`、`source.json` 和 `source-cdn.json`。
3. commit 后 push。

新增插件时，在 `plugins/` 下建一个和插件名同名的目录，放入 `manifest.json` 和 `plugin.lua`。`manifest.name` 必须和目录名一致。
