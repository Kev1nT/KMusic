# KMusic 部署说明

## 当前状态（已部署）

- 项目目录：`/path/to/kmusic`
- 镜像：`kmusic:0.1.0`（约 481 MB，已内置网易云 API）
- 容器：仅 `kmusic` 一个
- 端口：`8090 → 8080`
- 访问：`http://<NAS-IP>:8090`
- 默认密码：`admin`（在 `.env` 修改 `ADMIN_PASSWORD` 后 `docker compose up -d`）
- 默认音乐目录：`/path/to/music`（容器内 `/music`）
- 数据目录：`/path/to/kmusic/data`

健康检查（2026-11-03 单容器验证）：

```bash
curl http://your-host:8090/api/health
# {"ok":true,"version":"0.1.0",...}
```

已迁移账号：QQ（Kian）、网易云（Kevin-T，VIP）、汽水（抖音扫码账号）。
三个平台搜索均在单容器内实测通过（QQ 30 条、网易云 30 条、汽水 30 条；合并搜索 90 条无报错）。

## 日常操作

```bash
cd /path/to/kmusic

docker compose ps          # 状态
docker compose logs -f kmusic
docker compose restart kmusic
docker compose down        # 停止
docker compose up -d       # 启动（已构建镜像时）
```

## 喜马拉雅（2026-11-09 接入）

新增平台 `ximalaya`，源码在 `server/src/providers/ximalaya/`，无需新增依赖，lock 文件未变。

重建并生效：

```bash
cd /path/to/kmusic
sudo docker compose up -d --build
```

生效后在「账号 → 添加账号 → 喜马拉雅」导入 Cookie（必须含 `1&_token`），
搜索页平台标签会出现「喜马拉雅」。

## Apple Music（2026-11-15 接入，原生实现）

kmusic **自带** Apple Music 下载能力，不依赖外部 amdl-web 服务：

- 引擎：`vendor/apple-music-dl`（zhaarey/apple-music-downloader 静态二进制，构建时 COPY 到 `/usr/local/bin/apple-music-dl`）
- 解密：`apple-wrapper` 容器（wrapper-lite，FairPlay key 服务，监听 127.0.0.1:12340）
- kmusic 与 apple-wrapper **共享网络命名空间**（`network_mode: service:apple-wrapper`），所以能访问只绑回环的 12340
- 8090→8080 的端口映射写在 apple-wrapper 上

首次登录（已完成，token 缓存在 `apple-wrapper/mpl_db`）：
1. Apple ID / 密码写在 `.env` 的 `APPLE_ID` / `APPLE_PASSWORD`
2. 2FA 验证码写入 `apple-wrapper/2fa.txt` 后重启 wrapper
3. 成功后 wrapper 日志出现 `token cache loaded` + `listening on 127.0.0.1:12340`

已知坑：
- wrapper 的 `--host 0.0.0.0` 会导致服务模式初始化后退出，必须 `--host 127.0.0.1`（故用共享网络）
- 不要传 `--device-info` 参数（同样会让服务模式退出）
- docker 内网 DNS(127.0.0.11) 会导致 Apple 登录鉴权失败，已用 `dns: 223.5.5.5`

可配置项（设置页）：音质(alac/atmos/aac)、歌词粒度(逐字/逐句)、歌词格式(lrc/ttml)、内嵌/另存歌词、封面尺寸、storefront、wrapper 地址，以及 **ALAC / Atmos / AAC 三个独立落盘目录**。

在线播放（2026-11-15 追加）：
- 后端接口：`GET /api/apple/lyrics?trackId=`（wrapper 的 TTML 逐字歌词）、`POST /api/apple/prepare` + `GET /api/apple/prepare/status`（未缓存时用引擎下到 `/data/playcache`）、`GET /api/apple/stream?trackId=&t=<jwt>`（把缓存 m4a 转 FLAC 后流式返回，支持 Range）
- 鉴权：`<audio>` 不能带 Authorization，stream 允许 `?t=` 传 JWT（见 index.ts onRequest）
- 前端：`web/src/stores/player.ts`（播放/队列/上下首）+ `web/src/components/PlayerBar.vue`（迷你条 + 全屏仿 Apple Music 页）。播放页按 amll 官方 Vue playground（`packages/playground/vue/src/TestApp.vue`）落地：
- 背景 `BackgroundRender`（默认 MeshGradientRenderer，Apple Music 风格动态流体渐变；必须 `position:absolute;inset:0` 给尺寸）
- 歌词 `LyricPlayer`（`:lyric-lines` + `:current-time` + `:playing`，`mix-blend-mode:plus-lighter`，`@line-click` 点击跳转）
- 时间用 requestAnimationFrame 平滑推进（timeupdate 只有 ~4Hz，弹簧动画会顿）
- 歌词解析用官方 `@applemusic-like-lyrics/lyric` 的 parseTTML（返回 {lines}）；异常时本地 `web/src/lib/ttml.ts` 兜底映射

无损转 FLAC 默认开（appleConvertFlac），仅对 alac 产物转码，atmos 不动。

双下（2026-11-15 追加）：设置 `appleDualDownload=true`（默认）时，Apple 任务会对同一 URL 依次跑 `alac` 和 `atmos` 两遍引擎，各自的 config 目录不同 → 同时存在的两版分别落 Lossless / Atmos。某首没有 Atmos 时那一遍 0 产出、不算失败（任务备注提示"无可用全景声资源"）。实测 Taylor Swift - Anti-Hero：Lossless=ALAC 2ch 1.8Mbps / Atmos=E-AC-3 5.1 825kbps。

首页与交互（2026-11-15 追加）：
- 左侧菜单「Apple Music」→ 曲库首页（热门专辑/歌单/歌曲，支持搜索、30s 试听）
- 专辑/歌单详情复用专辑页；「全部下载」对 Apple 一次提交整张 URL（引擎一次下完）
- 「热门歌曲」列表可直接单曲下载；曲目封面悬停可试听

落盘：`/music/Apple/{Lossless,Atmos,AAC}/<Artist>/<Album>/NN. Song.m4a`（带完整 tag、内嵌逐字歌词、cover.jpg、.lrc）

## 重新构建## 重新构建

```bash
cd /path/to/kmusic
docker compose up -d --build
```

注意：本机 Docker 镜像代理（docker.fnnas.com）对 `node:24-alpine` 会返回 401，首次构建前需要先确保基础镜像存在：

```bash
docker pull node:24-alpine
```

（本机已经拉取过，正常增量重建不需要再拉。）

## 目录说明

- `./data`：`kmusic.db`、`secret.key`、临时文件；不要删 `secret.key`，否则账号 Cookie 无法解密
- `/path/to/music`：媒体库，Emby / Jellyfin 直接指向这里
- `DEPLOY.md`：本文件
- `docker-compose.yml`：Compose 定义（项目名 `kmusic`）

## 常见问题

- **8090 被占用**：修改 `docker-compose.yml` 的 `"8090:8080"`。
- **权限问题**：`.env` 中 `PUID/PGID` 改成 NAS 实际用户；音乐目录需要容器用户可写。
- **网易云无响应**：查看容器内日志 `data/netease-api.log`；内置 API 启动需要几秒。
- **汽水封面为空**：汽水接口需要抖音签名模板，当前由前端占位。

## 权限修复记录（2026-10-29）

首次部署时 `.env` 里 `PUID=982`，而媒体目录 `/path/to/music/music` 属主是 `root:root`、其他子目录属主是 `youruser:users`，容器用户没有写权限，下载在最后落盘时报：

```text
EACCES: permission denied, copyfile ... -> /music/music/...flac.part
```

已修复：

- `.env` 改为 `PUID=1000`、`PGID=1001`（对应 NAS 用户 `youruser:users`）
- 已把 `/path/to/music/{music,musicjw,kian,kx}` 递归 `chown 1000:1001`
- `kmusic` 已重建运行；重试一首失败任务成功写入 58MB FLAC

以后如果换账号下载目录，确保该目录属主是 `PUID:PGID`，或执行：

```bash
docker compose exec kmusic chown -R "$PUID:$PGID" /music
```

> 注意：账号里配置的下载目录是容器内路径。例如账号目录填 `/music/music`，实际落盘就是 `/path/to/music/music`，所以路径里会出现 `/music/music`，这是正常的。

## 音质降级策略（2026-10-29）

下载按 `Hi-Res → FLAC → 320K → 128K` 逐档尝试：

- 账号没有 Hi-Res 权益、但能拿到 FLAC 时，会自动下载 FLAC，不报错
- 某档只返回试听片段/无效音频时，会清理临时文件并继续降一档，而不是直接失败
- 任务记录的是**实际下载到的音质**（不会再拿 320K 冒充 Hi-Res）
- 所有档位都没有 URL 时，提示：「无版权/已下架/需单独购买，或账号没有对应音质权限」

注意：网易云部分歌曲（例如周杰伦《等你下课》）即使账号是 VIP，在网易云也没有任何可播地址，这是版权下架，不是 VIP 问题，换平台（QQ）可下载。

## 重复歌曲清理（2026-10-30）

媒体库页「查找重复」：

- 分组：歌手 + 标题 + 时长（±5 秒）+ 版本特征（Instrumental / Remix / Live / feat. / Explicit 等），避免误合并不同版本
- 同尺寸候选文件会计算 MD5，标记“MD5 相同”
- 自动按 `FLAC/DSF > WAV/APE > M4A > MP3` 排序，保留音质最好的一份
- 支持勾选多个文件删除，或「自动清理（保留最佳）」
- 默认移到 `data/trash/<时间戳>/`，也可选「彻底删除」

## 文件管理器 / 标签 / 转码（2026-10-30）

- 媒体库页签改成懒加载文件管理：进入不扫描，点击目录才调用 `/api/files/list`
- 文件操作：重命名、复制、移动、删除到回收站/彻底删除、新建目录
- 标签：单曲读取/写入 ffmpeg 元数据（标题/歌手/专辑/年份/音轨）
- 查缺：扫描目录下缺失 `year / lyric / cover / nfo`，自动从 QQ/网易云搜索匹配并补封面、歌词、NFO、标签
- 简繁：`/api/files/convert-names`（支持 s2t/t2s）与 `/api/files/convert-lyrics`（GB18030/BIG5/UTF-16 → UTF-8，可选简繁）
- 歌单导入：`POST /api/playlists/resolve` 支持 QQ/网易云/汽水链接或 ID

## 2026-10-30 交互与文件管理修复

- 站内弹窗：确认/输入/提示统一走 `web/src/components/DialogHost.vue`，不再使用浏览器原生弹窗
- 下拉框：`styles.css` 统一深色 `select/option` 样式，解决白底白字
- 加载反馈：全局顶部进度条（`GlobalLoadingBar`）+ 目录/查缺/刮削/导入等按钮 loading
- 查缺：按当前选中目录或当前打开目录执行，支持勾选 `标签 / 歌词 / 封面 / NFO`
- 汽水歌单：修正 `base_info.title`、`resource_cnt`、`owner_id`；登录过期时自动尝试刷新，无法刷新提示重新扫码

## 自动整理目录（2026-10-30）

文件管理器工具栏「整理」：

- 可对选中的文件/目录，或当前目录执行
- 目标根目录默认是当前目录，也可改成任意媒体库路径
- 命名规则默认取设置页模板，例如 `{artist}/{album}/{track:02d} - {title}`
- 先「预览」列出每条源路径 → 目标路径，确认后「开始整理」
- 不会覆盖已存在目标文件，冲突会单独统计
- 自动同步同目录 `.lrc`，并复制 `cover.jpg` / `album.nfo` 到新专辑目录
- 会更新媒体库索引并清理空的源目录

## 歌手分隔符说明（2026-10-30）

旧库里的 FLAC 标签经常是 `ARTIST=本兮;李魏西`（分号是标签层的多歌手分隔符），不是文件名里的 `&`。自动整理此前直接使用标签值，所以目录会变成 `本兮;李魏西`。

已修正整理逻辑：生成目标路径时把标签中的 `; / ；` 统一显示为 ` & `，例如：

```text
本兮&李魏西-那天午后 - 本兮;李魏西.flac
→ /music/other/本兮&李魏西/Run Away/02 - 本兮&李魏西-那天午后.flac
```

注意：这只影响**整理后的路径**，不会自动改写音频内的 `ARTIST` 标签；如果需要改标签，可在文件管理器选中该歌曲 →「标签」里编辑。

## 标题带歌手前缀的整理修正（2026-10-30）

部分老文件的 `TITLE` 标签是 `本兮&韦琪-超速度`（歌手名被写进了标题），即使模板是 `{artist}/{album}/{title} - {artist}`，歌曲名前面也会再次出现歌手。

整理时现在会去掉标题开头的歌手前缀（匹配完整合作歌手名或单个歌手名 + `- / – / — / :` 分隔符），预览结果：

```text
/music/other/本兮&韦琪/超速度/超速度 - 本兮&韦琪.flac
```

只影响整理后的路径，不修改音频标签。

## 账号登录态失效后的重新登录（2026-11-03）

账号卡片新增 **「重新登录」** 按钮：

- 会自动选中该账号对应的平台（QQ / 网易云 / 汽水）
- 直接打开扫码登录弹窗，重新扫码后按同一 `provider + uid` 更新原账号
- 保留原备注名、下载目录、默认下载账号设置
- 账号检测失败不再返回 401 把管理员踢下线，而是标记 `登录态失效` 并保留管理页面

汽水音乐登录态过期时，会先尝试 access-code 自动刷新；刷新失败再通过「重新登录」重新扫码。

## QQ 账号重复修复（2026-11-03）

QQ 的 `musicid` 是 19 位数字，直接 `JSON.parse` 会丢精度：

```text
1152921504735055032 → 1152921504735055000
```

导致扫码登录时 `provider + uid` 对不上，原账号被当成新账号插入。

已修复：

- QQ 扫码 / 微信扫码都从原始 JSON 文本中用正则提取精确 `musicid`
- 同一 QQ 号重新登录会更新原账号，不再新建
- 已把本次产生的重复账号合并回原账号，并迁移：
  - 订阅 `account_id`
  - 任务 `account_id`
  - `settings.downloadAccountId`
  - 原备注名、下载目录、默认下载账号
