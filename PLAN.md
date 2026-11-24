# KMusic 实施计划 v0.7

> 2026-10-30。汽水音乐以独立 Provider 接入；QQ 搜索端点已切换到可用线路。

## 1. 汽水音乐接入

### 实现方式
使用 `qishui-music-api@0.2.2`（汽水车机协议 Node 客户端，MIT）：

- 抖音扫码授权，会话写入 `accounts.cookie_enc`（AES-256-GCM）
- 设备 ID 持久化在 `settings.qishui_device_id`，会话恢复不需要重复扫码
- 支持：`search`、`audio`、`lyrics`、`user_playlists`、`playlist_tracks`、`artist_detail`、`liked_songs`
- 已接入：三平台合并搜索、平台筛选、账号扫码弹窗、歌单页、订阅、下载/整理管线

### 验证
- 搜索「晴天」返回 30 首，字段映射正常（歌手/专辑/时长）
- 音频取链返回 `standard`（m4a），下载 1.9MB，标签/歌词正常
- 抖音扫码：二维码生成成功（前端已可显示），待真实扫码确认会话写入

### 限制（协议本身）
- 只提供未加密 `standard` 音质，**无法无损/Hi-Res**；客户端拒绝解密受保护音频
- 无专辑/艺术家详情接口（搜索页对汽水禁用这两个 Tab）
- 封面需要抖音签名模板，当前留空占位

## 2. 本轮同时修复

- QQ 搜索旧接口 `client_search_cp` 返回 500，切换到 `search_for_qq_cp`，并兼容旧字段（sizeflac/size320/interval/pubtime）
- 下载/封面按平台设置 Referer（汽水 CDN 用 QQ Referer 会 403）
- 三平台合并搜索：`/api/search/all?sources=qq,netease,qishui`，实测 90 条、无错误

## 3. 需求完成度

| 需求 | 状态 |
| --- | --- |
| 汽水登录 / 我喜欢 / 下载 | ✅ 基础接入（standard 音质，待扫码验证） |
| 按账号下载目录 | ✅ |
| QQ 微信扫码 | ✅ 待实扫 |
| 合并搜索 + 平台筛选 | ✅ 三平台 |
| 歌单账号浮标 | ✅ |
| 媒体库扫描 + 去重 | ✅ |

## 4. 下一阶段

- 汽水抖音扫码实扫验证；二维码过期自动刷新
- 汽水封面模板签名（若上游提供）
- 微信扫码实扫验证
- 酷狗 Provider（如需第三/第四平台）
- Emby/Jellyfin 刷新、镜像瘦身
