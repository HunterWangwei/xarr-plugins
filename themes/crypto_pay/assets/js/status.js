// 支付结果页: /pay/status?order_id= (或 trade_no=)
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var q = new URLSearchParams(location.search);
  var orderId = q.get('order_id') || q.get('trade_no') || '';
  var TEXT = { 1: ['…', '待支付', ''], 2: ['✓', '支付成功', 'ok'], 3: ['!', '订单已关闭', 'bad'], 4: ['!', '订单已超时', 'bad'], 5: ['!', '订单创建失败', 'bad'] };

  function set(status, desc) {
    var t = TEXT[status] || ['!', '订单不存在', 'bad'];
    $('icon').textContent = t[0];
    $('icon').className = 'result-icon ' + t[2];
    $('title').textContent = t[1];
    $('desc').textContent = desc || '';
  }

  if (!orderId) return set(0, '缺少订单号');
  fetch('/api/order/info?_time=' + Date.now(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: orderId })
  }).then(function (r) { return r.json(); }).then(function (r) {
    if (r.code !== 200) return set(0, r.message);
    var d = r.data || {};
    set(d.status);
    $('subject').textContent = d.subject || '';
    $('amount').textContent = '¥' + (Number(d.trade_amount || 0) / 100).toFixed(2);
    $('order-id').textContent = d.order_id || '';
    $('out-order-id').textContent = d.out_order_id || '';
    $('details').hidden = false;
  }).catch(function () { set(0, '网络异常，请刷新重试'); });
})();
