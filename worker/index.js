// XArrPay 插件源网关 (Cloudflare Worker, 无存储)
// 插件文件和 source.json 仍托管在 GitHub, Worker 只补上 XArrPay 需要的动态接口:
//   GET  /source                     插件列表, source_site 改写为 Worker 地址
//   POST /api/v1/download/ticket     安装前申请下载票据 body: { open_id, uuid, version, version_code }
//   GET  /dl/:name/:version          代理下载 zip
// 协议参考 https://github.com/xarrpro/xarr-cf-plugin-store/blob/main/src/routes/source.ts

const UPSTREAM = 'https://raw.githubusercontent.com/HunterWangwei/xarr-plugins/main';

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function loadSource() {
  const resp = await fetch(`${UPSTREAM}/source.json`, { cf: { cacheTtl: 60 } });
  if (!resp.ok) throw new Error(`upstream ${resp.status}`);
  return resp.json();
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = url.origin;
    const path = url.pathname.replace(/\/+$/, '');

    if (request.method === 'GET' && path === '/source') {
      const source = await loadSource();
      for (const p of source.data.plugins) {
        p.source_site = origin;
        p.download_url = `${origin}/dl/${encodeURIComponent(p.name)}/${encodeURIComponent(p.version)}`;
      }
      return json(source);
    }

    if (request.method === 'POST' && path === '/api/v1/download/ticket') {
      const body = await request.json().catch(() => ({}));
      const source = await loadSource();
      const p = source.data.plugins.find((x) => x.uuid === String(body.uuid || ''));
      if (!p) return json({ code: 404, message: '插件不存在', data: null });
      // 上游只保留最新版本的 zip
      return json({
        code: 200,
        message: 'ok',
        data: {
          ticket: p.uuid,
          download_url: `${origin}/dl/${encodeURIComponent(p.name)}/${encodeURIComponent(p.version)}`,
          expire_at: Math.floor(Date.now() / 1000) + 600,
          content_length: 0,
        },
      });
    }

    const m = request.method === 'GET' && path.match(/^\/dl\/([a-z0-9_]+)\/([0-9A-Za-z.\-]+)$/);
    if (m) {
      const resp = await fetch(`${UPSTREAM}/dist/${m[1]}-${m[2]}.zip`);
      if (!resp.ok) return new Response('404 Not Found', { status: 404 });
      return new Response(resp.body, {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${m[1]}-${m[2]}.zip"`,
        },
      });
    }

    return new Response('404 Not Found', { status: 404 });
  },
};
