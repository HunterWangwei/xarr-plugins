---@diagnostic disable: undefined-global
package.path = package.path .. ";" .. luaCommonPath .. "/?.lua"
require("autoload")

-- 币安ID收款监控
-- 原理: 下单时把订单金额换算成稳定币并做递增金额去重, 用户通过币安 Pay 转账到指定币安ID;
-- 定时任务调用官方接口 GET /sapi/v1/pay/transactions 拉取到账记录, 入库并上报给框架按金额匹配订单。
-- API Key 只需开启「读取」权限。

local PLUGIN = "binance_pay"
local CHANNEL_CODE = "binance_pay"
local TX_PATH = "/sapi/v1/pay/transactions"
local RATE_CACHE_KEY = "rate_cache"
local RATE_CACHE_TTL = 300
local P2P_URL = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search"
local FX_URL = "https://open.er-api.com/v6/latest/USD"

local plugin = {}

function plugin.pluginInfo()
    return {
        channels = {
            -- 自定义支付类型 usdt, 如后台已有其他类型可自行修改 key
            ["usdt"] = { {
                label = '币安ID收款',
                value = CHANNEL_CODE,
                options = {
                    -- 同一金额同时只能有一笔待支付订单, 靠递增金额区分
                    use_add_amount = 1,
                }
            } },
        },
        options = {
            callback = 0,
            detection_interval = 0,
            detection_type = "cron",
            crontab_list = {
                {
                    -- 接口权重 3000/次(按 UID 计), 不建议低于 15 秒
                    crontab = "*/20 * * * * *",
                    fun = "check_account",
                    name = "币安ID到账检查",
                    scope = "account",
                    args = "",
                    options = { has_wait_pay_order = 1 },
                },
            },
            options = {
                -- 实时汇率缓存, 由插件自动写入, 无需手动修改
                { title = "汇率缓存(自动维护)", key = RATE_CACHE_KEY, default = "{}" },
            },
        }
    }
end

function plugin.formItems(ctx)
    local required = { { required = true, trigger = { "input", "blur" }, message = "请输入" } }
    return {
        inputs = {
            {
                name = 'binance_id', label = '收款币安ID', type = types.InputTypes.INPUT, default = "",
                placeholder = "币安 App → 个人中心 → 用户ID(UID)",
                rules = required,
            },
            {
                name = 'api_key', label = 'API Key', type = types.InputTypes.INPUT, default = "",
                hidden_list = 1,
                options = { tip = '只开启「读取」权限, 不要开启交易/提现' },
                rules = required,
            },
            {
                name = 'api_secret', label = 'API Secret', type = types.InputTypes.PASSWORD, default = "",
                hidden_list = 1,
                rules = required,
            },
            {
                name = 'currency', label = '收款币种', type = types.InputTypes.SELECT, default = "USDT",
                values = {
                    { label = "USDT", value = "USDT" },
                    { label = "USDC", value = "USDC" },
                    { label = "FDUSD", value = "FDUSD" },
                },
            },
            {
                name = 'rate_mode', label = '汇率来源', type = types.InputTypes.SELECT, default = "fixed",
                values = {
                    { label = "固定汇率", value = "fixed" },
                    { label = "币安 C2C 实时价(人民币买币价)", value = "binance_p2p" },
                    { label = "美元兑人民币实时汇率", value = "usd_cny" },
                },
                options = { tip = '实时汇率每 5 分钟更新一次, 获取失败时使用上次的汇率或下面的固定汇率' },
            },
            {
                name = 'rate', label = '固定汇率', type = types.InputTypes.INPUT, default = "7.2",
                options = { tip = '1 收款币 = 多少元。订单金额 ÷ 汇率 = 应付币数, 填 1 则不换算。实时模式下作为兜底' },
                rules = required,
            },
            {
                name = 'rate_adjust', label = '汇率浮动(%)', type = types.InputTypes.INPUT, default = "0",
                when = "this.formModel.options.rate_mode && this.formModel.options.rate_mode != 'fixed'",
                options = { tip = '在实时汇率上调整, 如 -1 表示汇率下调 1%(客户多付约 1%), 用于覆盖手续费和波动' },
            },
            {
                name = 'show_mode', label = '支付页展示', type = types.InputTypes.SELECT, default = "text",
                values = {
                    { label = "文字(显示币安ID和USDT金额, 推荐)", value = "text" },
                    { label = "收款二维码", value = "qrcode" },
                },
                options = { tip = '多数支付模板只显示人民币金额, 选「收款二维码」时客户可能看不到应付的币数' },
            },
            {
                name = 'qrcode', label = '收款码内容', type = types.InputTypes.INPUT, default = "",
                placeholder = "币安 App 收款码解析出的链接",
                when = "this.formModel.options.show_mode == 'qrcode'",
                options = { append_deqrocde = 1 },
            },
            {
                name = 'api_host', label = '接口地址', type = types.InputTypes.INPUT,
                default = "https://api.binance.com",
                options = { tip = '国内服务器可能需要代理或使用 api1~api4.binance.com' },
            },
            {
                name = 'lookback', label = '回溯分钟数', type = types.InputTypes.INPUT, default = "30",
                placeholder = "30",
                options = { tip = '每次拉取最近 N 分钟的到账记录, 建议不小于订单有效期' },
            },
        }
    }
end

-- 订单金额(分, 订单币) → 应付金额(分, 收款币), 向上取整避免少收
local function to_coin_cents(trade_amount, rate)
    if rate == 1 then
        return trade_amount
    end
    return math.ceil(trade_amount / rate - 0.000001)
end

local function http_json(method, url, body)
    local resp, err = http.request(method, url, {
        body = body,
        timeout = "8s",
        headers = { ["content-type"] = "application/json" },
    })
    if err ~= nil or not resp or not resp.body then
        return nil, tostring(err)
    end
    return json.decode(resp.body), nil
end

-- 币安 C2C 人民币买币广告前 10 条价格的中位数
local function fetch_p2p_rate(currency)
    local r, err = http_json("POST", P2P_URL, json.encode({
        fiat = "CNY", asset = currency, tradeType = "BUY", page = 1, rows = 10,
    }))
    if not r or r.code ~= "000000" or type(r.data) ~= "table" or #r.data == 0 then
        return nil, "C2C 价格获取失败: " .. tostring(err or (r and r.message))
    end
    local prices = {}
    for _, ad in ipairs(r.data) do
        local p = tonumber(ad.adv and ad.adv.price)
        if p and p > 0 then table.insert(prices, p) end
    end
    if #prices == 0 then return nil, "C2C 无有效报价" end
    table.sort(prices)
    return prices[math.ceil(#prices / 2)], nil
end

-- 美元兑人民币, 稳定币按 1:1 美元计
local function fetch_usd_cny_rate()
    local r, err = http_json("GET", FX_URL, nil)
    local cny = r and r.rates and tonumber(r.rates.CNY)
    if not cny or cny <= 0 then
        return nil, "美元汇率获取失败: " .. tostring(err or (r and r.result))
    end
    return cny, nil
end

-- 返回 汇率, 来源说明。实时汇率缓存 RATE_CACHE_TTL 秒, 获取失败依次退回旧缓存、固定汇率
local function resolve_rate(opt)
    local fixed = tonumber(opt.rate)
    local mode = opt.rate_mode or "fixed"
    if mode ~= "binance_p2p" and mode ~= "usd_cny" then
        return fixed, "fixed"
    end

    local currency = opt.currency or "USDT"
    local key = mode .. ":" .. currency
    local cache = json.decode(helper.get_plugin_option(PLUGIN, RATE_CACHE_KEY, "{}") or "{}") or {}
    local hit = cache[key]
    local now = helper.time_now_timestamp()
    local rate
    if hit and tonumber(hit.rate) and now - (tonumber(hit.time) or 0) < RATE_CACHE_TTL then
        rate = tonumber(hit.rate)
    else
        local err
        if mode == "binance_p2p" then
            rate, err = fetch_p2p_rate(currency)
        else
            rate, err = fetch_usd_cny_rate()
        end
        if rate then
            cache[key] = { rate = rate, time = now }
            helper.set_plugin_option(PLUGIN, RATE_CACHE_KEY, json.encode(cache))
        else
            log.warning(PLUGIN, key, err)
            rate = hit and tonumber(hit.rate) or nil
            if not rate then return fixed, "fixed(实时汇率获取失败)" end
        end
    end

    local adjust = tonumber(opt.rate_adjust) or 0
    return rate * (1 + adjust / 100), mode
end

function plugin.create(ctx)
    local order = ctx.order_info
    local opt = ctx.account_options
    local rate, source = resolve_rate(opt)
    if not rate or rate <= 0 then
        return { code = 500, message = "汇率配置错误", data = { type = types.PaymentResultTypes.ERROR } }
    end
    log.info(PLUGIN, order.order_id, "汇率", rate, source)
    if not opt.binance_id or opt.binance_id == "" then
        return { code = 500, message = "未配置收款币安ID", data = { type = types.PaymentResultTypes.ERROR } }
    end

    local ok, amount = orderHelper.reset_order_tmp_amount(order.order_id, to_coin_cents(order.trade_amount, rate))
    if ok == false then
        return { code = 500, message = "生成应付金额失败, 请稍后重试", data = { type = types.PaymentResultTypes.ERROR } }
    end

    local currency = opt.currency or "USDT"
    local amountStr = helper.amount_int2str(amount)
    local tip = string.format("请用币安 App「Pay → 发送」转账 %s %s 到币安ID %s。金额必须完全一致(页面上的人民币金额仅供参考), 否则无法自动到账",
        amountStr, currency, opt.binance_id)

    local data = {
        -- text: 支付模板把 content 原样显示在二维码区域
        type = "text",
        content = tip,
        actual_amount = amountStr,
        actual_account_type = "binance_id",
        actual_account = opt.binance_id,
    }
    if opt.show_mode == "qrcode" and opt.qrcode and opt.qrcode ~= "" then
        data.type = types.PaymentResultTypes.QRCODE
        data.qrcode = opt.qrcode
    end
    return { code = 200, message = "success", data = data }
end

-- 币安 Pay 无回调, 到账靠定时任务
function plugin.notify(ctx)
    return { code = 500, message = "本通道不支持回调", data = { response = "fail" } }
end

-- 调用币安签名接口, 成功返回 data 数组, 失败返回 nil, 错误信息
local function fetch_transactions(opt)
    local host = (opt.api_host and opt.api_host ~= "") and opt.api_host or "https://api.binance.com"
    host = string.gsub(host, "/+$", "")
    local lookback = tonumber(opt.lookback) or 30
    local nowMs = helper.time_now_timestamp() * 1000
    local query = string.format("startTime=%.0f&endTime=%.0f&limit=100&recvWindow=10000&timestamp=%.0f",
        nowMs - lookback * 60 * 1000, nowMs + 60 * 1000, nowMs)
    query = query .. "&signature=" .. helper.hmac_sha256_hex(query, opt.api_secret)

    local resp, err = http.request("GET", host .. TX_PATH, {
        query = query,
        timeout = "15s",
        headers = { ["X-MBX-APIKEY"] = opt.api_key },
    })
    if err ~= nil or not resp or not resp.body then
        return nil, "请求失败: " .. tostring(err)
    end
    local r = json.decode(resp.body)
    if not r then
        return nil, "响应解析失败: " .. tostring(resp.body)
    end
    -- 成功: {code="000000", success=true, data=[...]}; 失败: {code=-2015, msg="..."}
    if r.success ~= true and tostring(r.code) ~= "000000" then
        return nil, string.format("接口错误 %s: %s", tostring(r.code), tostring(r.msg or r.message))
    end
    return r.data or {}, nil
end

-- 账号级定时任务: 拉取到账记录 → 去重入库 → 上报匹配订单
local function is_online(account)
    local v = account.online
    return v == true or v == 1 or v == "1"
end

function plugin.check_account(ctx)
    local account = ctx.account_info
    local opt = ctx.account_options
    if not opt.api_key or opt.api_key == "" or not opt.api_secret or opt.api_secret == "" then
        return { code = 500, message = "未配置 API Key" }
    end

    local list, err = fetch_transactions(opt)
    if list == nil then
        log.error(PLUGIN, account.id, err)
        -- -2014/-2015: Key 无效或无权限/IP 不在白名单, 下线账号避免继续分配订单
        if (string.find(err, "-2014", 1, true) or string.find(err, "-2015", 1, true)) and is_online(account) then
            helper.channel_account_offline(account.id)
        end
        return { code = 500, message = err }
    end
    -- 只在状态变化时切换, 每次都调用会反复触发上线通知
    if not is_online(account) then
        helper.channel_account_online(account.id)
    end

    local currency = opt.currency or "USDT"
    local reported = 0
    for _, tx in ipairs(list) do
        local amount = tonumber(tx.amount) or 0
        -- 只处理收入(正数)且币种一致的记录
        if amount > 0 and tx.currency == currency and tx.transactionId then
            local query = {
                pay_type = account.pay_type,
                channel_code = account.code,
                uid = account.uid,
                account_id = account.id,
                third_account = opt.binance_id,
                third_order_id = tx.transactionId,
            }
            if not orderPayHelper.third_order_exist(query) then
                local payer = tx.payerInfo or {}
                -- 向下取到分, 多付零头仍能匹配
                local fen = math.floor(amount * 100 + 0.000005)
                local insertId = orderPayHelper.third_order_insert({
                    pay_type = account.pay_type,
                    channel_code = account.code,
                    uid = account.uid,
                    account_id = account.id,
                    third_account = opt.binance_id,
                    buyer_id = tostring(payer.binanceId or ""),
                    buyer_name = tostring(payer.name or ""),
                    out_order_id = tx.transactionId,
                    third_order_id = tx.transactionId,
                    amount = fen,
                    remark = string.format("%s %s %s", tostring(tx.orderType), tx.amount, tx.currency),
                    trans_time = math.floor((tonumber(tx.transactionTime) or 0) / 1000),
                    type = tostring(tx.orderType),
                })
                if insertId and insertId > 0 then
                    local code, msg = orderPayHelper.third_order_report(insertId)
                    log.info(PLUGIN, "到账", tx.transactionId, tx.amount, tx.currency, code, msg)
                    reported = reported + 1
                end
            end
        end
    end
    return { code = 200, message = string.format("检查完成, 新到账 %d 笔", reported) }
end

return plugin
