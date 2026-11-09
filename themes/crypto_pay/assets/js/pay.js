// 支付页逻辑: 接口见 https://docs.xarr.cn/merchant/templates/pay/api.html
(function () {
  var STATUS = { PENDING: 1, PAID: 2, CLOSED: 3, EXPIRED: 4, FAILED: 5 };
  var POLL_MS = 3000;
  // 收款账号类型为这些值, 或支付内容里带币种的订单, 按加密货币展示
  var CRYPTO_ACCOUNT_TYPES = ['binance_id'];
  var COIN_RE = /([\d.]+)\s*(USDT|USDC|FDUSD|BUSD|BTC|ETH|BNB|TRX)\b/;
  // 插件 1.0.3+ 在支付内容末尾带汇率: "当前汇率 1 USDT = 6.64 元"
  var RATE_RE = /1\s*(USDT|USDC|FDUSD|BUSD|BTC|ETH|BNB|TRX)\s*=\s*([\d.]+)\s*元/;

  var $ = function (id) { return document.getElementById(id); };
  var orderId = (window.PAGE && PAGE.orderId) || location.pathname.split('/').filter(Boolean).pop();
  var expireAt = 0;
  var finished = false;

  function api(path, body) {
    return fetch(path + '?_time=' + Date.now(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || { order_id: orderId })
    }).then(function (r) { return r.json(); });
  }

  function yuan(fen) { return (Number(fen || 0) / 100).toFixed(2); }
  function show(id, on) { $(id).hidden = !on; }
  function text(id, v) { $(id).textContent = v == null ? '' : String(v); }

  function qrSrc(d) {
    if (d.qrcode_data) return d.qrcode_data;
    var t = d.qrcode || '';
    if (!t) return '';
    return /^(data:|https?:\/\/.+\.(png|jpe?g|gif|webp)(\?|$))/i.test(t) ? t : '/api/qrcode?text=' + encodeURIComponent(t);
  }

  function renderCrypto(info, d) {
    var m = COIN_RE.exec(d.content || '');
    var amount = d.actual_amount || (m && m[1]) || yuan(info.trade_amount);
    var unit = (m && m[2]) || 'USDT';
    text('coin-amount', amount);
    text('coin-unit', unit);
    text('step-amount', amount);
    text('step-unit', unit);
    text('coin-account', d.actual_account || '');
    text('cny-ref', yuan(info.trade_amount));
    text('coin-warn', '必须转账 ' + amount + ' ' + unit + '，多一分少一分都无法自动到账');
    var rate = RATE_RE.exec(d.content || '');
    if (rate) {
      text('coin-rate', '当前汇率 1 ' + rate[1] + ' = ' + rate[2] + ' 元');
      show('coin-rate', true);
    }
    var src = qrSrc(d);
    if (src) { $('coin-qr').src = src; show('coin-qr', true); }
    show('crypto', true);
  }

  function renderNormal(info, d) {
    text('cny-amount', d.actual_amount || yuan(info.trade_amount));
    var src = qrSrc(d);
    if (d.type === 'jump' && (d.uri || d.qrcode)) {
      location.href = d.uri || d.qrcode;
      return;
    }
    if (d.type === 'html' && d.content) {
      $('html-content').innerHTML = d.content;
      show('html-content', true);
    } else if (src) {
      $('qr').src = src;
      show('qr', true);
      text('pay-hint', '请使用' + (info.pay_type_text || '') + '扫码支付');
    } else if (d.content) {
      text('text-content', d.content);
      show('text-content', true);
    }
    var link = d.scheme || d.uri;
    if (link && /Mobi|Android|iPhone/i.test(navigator.userAgent)) {
      $('open-app').href = link;
      show('open-app', true);
    }
    show('normal', true);
  }

  function showResult(status, desc) {
    finished = true;
    show('crypto', false);
    show('normal', false);
    var map = {};
    map[STATUS.PAID] = ['✓', '支付成功', 'ok'];
    map[STATUS.CLOSED] = ['!', '订单已关闭', 'bad'];
    map[STATUS.EXPIRED] = ['!', '订单已超时', 'bad'];
    map[STATUS.FAILED] = ['!', '订单创建失败', 'bad'];
    var r = map[status] || ['!', '订单异常', 'bad'];
    text('result-icon', r[0]);
    $('result-icon').className = 'result-icon ' + r[2];
    text('result-title', r[1]);
    text('result-desc', desc || (status === STATUS.PAID ? '感谢您的支付' : '如已付款请联系商户处理'));
    text('timer', '');
    show('result', true);
  }

  function onPaid(st) {
    var wait = Number(st.pay_payed_wait_time || 3);
    if (!st.return_uri) return showResult(STATUS.PAID);
    showResult(STATUS.PAID, wait + ' 秒后返回商户页面');
    setTimeout(function () { location.href = st.return_uri; }, wait * 1000);
  }

  function poll() {
    if (finished) return;
    api('/api/order/status').then(function (r) {
      if (r.code !== 200) return;
      var st = r.data || {};
      if (st.expire_time) expireAt = st.expire_time;
      if (st.status === STATUS.PAID) return onPaid(st);
      if (st.status !== STATUS.PENDING) return showResult(st.status);
    }).catch(function () {}).then(function () {
      if (!finished) setTimeout(poll, POLL_MS);
    });
  }

  function tick() {
    if (finished || !expireAt) return;
    var left = expireAt - Math.floor(Date.now() / 1000);
    if (left <= 0) {
      text('timer', '已超时');
      return;
    }
    text('timer', Math.floor(left / 60) + ' 分 ' + ('0' + (left % 60)).slice(-2) + ' 秒');
  }

  function copy(btn) {
    var v = $(btn.getAttribute('data-copy')).textContent;
    var done = function () { var t = btn.textContent; btn.textContent = '已复制'; setTimeout(function () { btn.textContent = t; }, 1500); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(v).then(done);
    } else {
      var ta = document.createElement('textarea');
      ta.value = v; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      document.body.removeChild(ta);
    }
  }

  function init() {
    api('/api/order/info').then(function (r) {
      show('loading', false);
      show('pay-card', true);
      if (r.code !== 200) {
        showResult(0, r.message || '订单不存在');
        return;
      }
      var info = r.data || {};
      text('subject', info.subject);
      text('order-id', '#' + info.order_id);
      text('pay-type', info.pay_type_text);
      text('create-time', info.create_time);
      if (info.service_qq) { text('contact', 'QQ: ' + info.service_qq); show('contact-row', true); }
      show('details', true);
      expireAt = info.expire_time || 0;
      if (info.status !== STATUS.PENDING) {
        if (info.status === STATUS.PAID) return onPaid(info);
        return showResult(info.status);
      }
      return api('/api/order/qrcode').then(function (q) {
        if (q.code !== 200) return showResult(0, q.message);
        var d = q.data || {};
        var crypto = CRYPTO_ACCOUNT_TYPES.indexOf(d.actual_account_type) >= 0 || COIN_RE.test(d.content || '');
        (crypto ? renderCrypto : renderNormal)(info, d);
        tick();
        setInterval(tick, 1000);
        poll();
      });
    }).catch(function () {
      show('loading', false);
      show('pay-card', true);
      showResult(0, '网络异常，请刷新重试');
    });

    document.addEventListener('click', function (e) {
      if (e.target.classList.contains('copy')) copy(e.target);
    });
    $('refresh').addEventListener('click', function () {
      if (!finished) api('/api/order/status').then(function (r) {
        var st = (r && r.data) || {};
        if (st.status === STATUS.PAID) onPaid(st);
        else if (st.status && st.status !== STATUS.PENDING) showResult(st.status);
      });
    });
  }

  init();
})();
