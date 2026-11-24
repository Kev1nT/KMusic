# QQ 音乐扫码登录协议（2026-10-29 实测）

旧教程里的 `ptqrshow.qq.com` 已经 **NXDOMAIN**，新版登录把二维码和轮询都放在了
`xui.ptlogin2.qq.com/ssl/` 下。以下是本机实测可用的链路，已推进到"轮询二维码状态"。

## 1. 预取登录页 cookie（可选）

```
GET https://xui.ptlogin2.qq.com/cgi-bin/xlogin
    ?appid=716027609&daid=383&style=33&hide_title_bar=1&low_login=0
    &qlogin_auto_login=1&no_verifyimg=1&link_target=blank
    &appname=QQ%E9%9F%B3%E4%B9%90&target=self
    &s_url=https%3A%2F%2Fy.qq.com%2F&pt_3rd_aid=0
```

拿到 `pt_login_sig`、`uikey`、`pt_local_token` 等 cookie。`pt_login_sig` 会作为后面轮询的
`login_sig` 参数（实测传空也能拿到 `66`，建议带上）。

## 2. 获取二维码

```
GET https://xui.ptlogin2.qq.com/ssl/ptqrshow
    ?appid=716027609&e=2&l=M&s=3&d=72&v=4&t=<随机小数>
    &daid=383&pt_3rd_aid=100497308
    &u1=https%3A%2F%2Fgraph.qq.com%2Foauth2.0%2Flogin_jump
```

- 返回 `image/png`（111×111，1-bit）
- `Set-Cookie: qrsig=<...>`（domain `.ptlogin2.qq.com`）
- 实测：`200` + 436 字节 PNG

```
ptqrtoken = hash33(qrsig)          # 无种子版本
# hash33: e=0; for c of s: e += (e<<5) + c.charCodeAt(0); return 2147483647 & e
```

## 3. 轮询扫码状态

```
GET https://xui.ptlogin2.qq.com/ssl/ptqrlogin
    ?u1=https%3A%2F%2Fgraph.qq.com%2Foauth2.0%2Flogin_jump
    &ptqrtoken=<ptqrtoken>&ptredirect=0&h=1&t=1&g=1&from_ui=1
    &ptlang=2052&action=0-0-<毫秒时间戳>&js_ver=26100915&js_type=1
    &login_sig=<pt_login_sig>&pt_uistyle=40
    &aid=716027609&daid=383&pt_3rd_aid=100497308
```

返回 JS 片段：

```
ptuiCB('66','0','','0','二维码未失效。', '')        // 未扫码
ptuiCB('67','0','','0','二维码认证中。', '')        // 已扫，待确认
ptuiCB('0','0','https://graph.qq.com/oauth2.0/login_jump?...','0','登录成功', '<昵称>')
ptuiCB('65','0','','0','二维码已失效。', '')
```

## 4. 拿 code

用同一个 cookie jar 请求 `ptuiCB` 返回的 URL，跟随 302：

```
https://graph.qq.com/oauth2.0/login_jump?... 
  → https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=...&code=<CODE>
```

从最终 URL 里取 `code`。

## 5. 用 code 换音乐登录态

来源：`https://y.qq.com/portal/wx_redirect.html` 内联 JS（login_type=1 分支）。

```
POST https://u.y.qq.com/cgi-bin/musicu.fcg
Content-Type: application/x-www-form-urlencoded

{
  "comm": { "g_tk": <hash33(skey, 5381)>, "platform": "yqq", "ct": 24, "cv": 0 },
  "req": {
    "module": "QQConnectLogin.LoginServer",
    "method": "QQLogin",
    "param": { "code": "<CODE>" }
  }
}
```

- `g_tk`：优先 `qqmusic_key` / `p_skey` / `skey` / `p_lskey` / `lskey`，
  `hash33(key, seed=5381)`；没有 skey 时可先传 5381 试
- 响应取 `req.data.musickey`（以及 `musicid` / `uin`）
- 写入 cookie：`qm_keyst=<musickey>`、`qqmusic_key=<musickey>`、`uin=o<musicid>`

微信扫码（login_type=2）走的是另一个分支：

```
{"comm":{"tmeAppID":"qqmusic","tmeLoginType":"1"},
 "req":{"module":"music.login.LoginServer","method":"Login",
        "param":{"strAppid":"wx48db31d50e334801","code":"<CODE>"}}}
```

## 待验证

第 5 步的响应结构尚未用真实扫码确认（响应字段做兼容解析即可）。下一次用手机扫一次码，
把 `QQLogin` 的原始响应记下来，就能把"账号自动出现"闭掉。

## 参考

- 二维码接口：`xui.ptlogin2.qq.com/ssl/ptqrshow`（旧域名已失效）
- 轮询接口：`xui.ptlogin2.qq.com/ssl/ptqrlogin`
- 交换脚本：`y.qq.com/portal/wx_redirect.html` 内联 JS
