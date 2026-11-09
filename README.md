# XArrPay 插件应用源

## 应用源链接

XArrPay 安装插件前，会先向 `{source_site}/api/v1/download/ticket` 发一个 POST 请求申请下载票据。GitHub raw 和 jsDelivr 都是静态托管，不支持 POST，所以应用源必须使用 [worker/](worker/) 里的 Cloudflare Worker 地址：

```
https://<你的 worker 域名>/source
```

Worker 本身不存数据，`source.json` 和 zip 都实时从本仓库读取，所以发布新版本时只需要 push，不用重新部署 Worker。

部署 Worker：

```bash
cd worker
npx wrangler login
npx wrangler deploy
```

`*.workers.dev` 域名在国内可能访问不了，建议在 Cloudflare 后台给 Worker 绑定一个自己的域名。

下面两个静态文件只能用来查看插件列表，不能用来安装：

| 线路 | 链接 |
|---|---|
| GitHub | `https://raw.githubusercontent.com/HunterWangwei/xarr-plugins/main/source.json` |
| jsDelivr | `https://cdn.jsdelivr.net/gh/HunterWangwei/xarr-plugins@main/source-cdn.json` |

## 插件列表

| 插件 | 说明 |
|---|---|
| [binance_pay](plugins/binance_pay/) | 币安ID收款：通过币安官方 Pay 接口监控到账 |

## 发布新版本

1. 修改 `plugins/<插件名>/` 里的代码，然后在 `manifest.json` 里提高 `version`。
2. 运行 `node build.js`（需要 Node 22 以上），它会重新生成 `dist/*.zip`、`source.json` 和 `source-cdn.json`。
3. commit 后 push。

新增插件时，在 `plugins/` 下建一个和插件名同名的目录，放入 `manifest.json` 和 `plugin.lua`。`manifest.name` 必须和目录名一致。
