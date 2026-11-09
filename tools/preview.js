// 本地预览支付主题: node tools/preview.js [主题名] [端口]
// 渲染 ${...} 模板变量, 并模拟 /api/order/* 接口。?mode=normal 预览普通(支付宝)订单
const http = require('http');
const fs = require('fs');
const path = require('path');

const theme = process.argv[2] || 'crypto_pay';
const port = Number(process.argv[3] || 8787);
const dir = path.join(__dirname, '..', 'themes', theme);
const ORDER = '20261109103614572238';
const now = Math.floor(Date.now() / 1000);

const vars = {
  '"web_title" | get_option': '清风阁 Pay',
  '"web_favicon" | get_option': '',
  '.templateAssets': `/templates/pay/${theme}/assets`,
  '.orderInfo.order_id': ORDER,
};

const info = {
  subject: '赞助一笔', out_order_id: '20261109103610917', order_id: ORDER, status: 1,
  amount: 62, trade_amount: 62, expire_time: now + 280, pay_type: 'usdt', pay_type_text: '币安',
  create_time: '2026-11-09 10:36:14', service_qq: '43551096',
};
const qrcode = {
  crypto: {
    type: 'text', content: '请用币安 App「Pay → 发送」转账 0.09 USDT 到币安ID 39701037。金额必须完全一致(页面上的人民币金额仅供参考), 否则无法自动到账。当前汇率 1 USDT = 6.64 元',
    actual_amount: '0.09', actual_account: '39701037', actual_account_type: 'binance_id',
  },
  normal: { type: 'qrcode', qrcode: 'https://qr.alipay.com/demo', actual_amount: '0.62' },
};

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

function render(file) {
  return fs.readFileSync(file, 'utf8').replace(/\$\{\s*([^}]+?)\s*\}/g, (m, k) => (k in vars ? vars[k] : m));
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const mode = (req.headers.referer || '').includes('mode=normal') ? 'normal' : 'crypto';
  const send = (code, type, body) => { res.writeHead(code, { 'content-type': type }); res.end(body); };

  if (url.pathname.startsWith('/api/order/')) {
    const ep = url.pathname.split('/').pop();
    const data = ep === 'info' ? { ...info, pay_type_text: mode === 'normal' ? '支付宝' : '币安' }
      : ep === 'qrcode' ? qrcode[mode]
      : { status: 1, expire_time: info.expire_time, pay_payed_wait_time: 3 };
    return send(200, 'application/json', JSON.stringify({ code: 200, message: 'success', data }));
  }
  if (url.pathname === '/api/qrcode') {
    // 占位二维码
    return send(200, 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/><path d="M1 1h3v3H1zM6 1h3v3H6zM1 6h3v3H1zM6 6h1v1H6zM8 8h1v1H8z"/></svg>');
  }
  const prefix = `/templates/pay/${theme}/`;
  if (url.pathname.startsWith(prefix)) {
    const f = path.join(dir, url.pathname.slice(prefix.length));
    if (fs.existsSync(f)) return send(200, TYPES[path.extname(f)] || 'application/octet-stream', fs.readFileSync(f));
  }
  if (url.pathname.startsWith('/pay/status')) return send(200, TYPES['.html'], render(path.join(dir, 'status.html')));
  if (url.pathname.startsWith('/pay/separate/')) return send(200, TYPES['.html'], render(path.join(dir, 'separate.html')));
  if (url.pathname.startsWith('/pay/')) return send(200, TYPES['.html'], render(path.join(dir, 'index.html')));
  send(404, 'text/plain', 'not found');
}).listen(port, () => console.log(`http://127.0.0.1:${port}/pay/${ORDER}`));
