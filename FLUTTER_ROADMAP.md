# Flutter 路线说明（这是你的第 5 阶段）

> 目的：说清 Flutter 是什么、**现在该不该动它**、怎么装、怎么跑第一个程序、以及网页代码能不能搬过去。
> 写作日期：2026-10-12（Day 27）。
> **本机实测：Flutter 与 Dart 均未安装**（`which flutter` / `which dart` 都查不到）。

---

## 1. 一句话结论

**Flutter 是「写一套代码，同时出手机 App + 电脑桌面程序」的工具。**
它能实现你路线图里那句「Flutter 跨端 APP（Win / macOS / iOS / Android）」——
但**别现在开始**，原因见 §3（顺序问题，做错了要白写一遍）。

---

## 2. Flutter 是什么

| 项 | 内容 |
|---|---|
| 出品方 | Google，开源免费 |
| 编程语言 | **Dart**（不是 JavaScript，要从头学一点） |
| 界面怎么来的 | **自己画**。不像网页那样用 HTML+CSS，Flutter 用 Dart 代码写出一个个「组件（Widget）」 |
| 能出什么 | Android App、iOS App、Windows 程序、macOS 程序、Linux 程序、网页 |
| 当前稳定版 | **Flutter 3.47.x**（最新补丁 3.47.7，2026-10-09），自带 Dart 3.13.5 |
| 下一个版本 | Flutter 3.50 预计 2026 年 11 月（现在还在测试频道） |
| 开发体验最大亮点 | **热重载（Hot Reload）**：改一行代码，模拟器上立刻看到效果，不用重新编译 |

对你最重要的区别：**网页那一套 HTML / CSS / JS 一行都搬不过去**，界面要重写。
**但后端接口和数据模型可以 100% 复用** —— 这才是你前期工作真正的价值。

---

## 3. ⚠️ 现在该不该开始？—— 先看清顺序

你路线图上的五个阶段：

```
① 打磨 → ② 自测 1 个月 → ③ 云端化 → ④ Flutter → ⑤ 开放
```

你目前**卡在 ③ 收尾 + 安全隔离（二期登录）待做**。这个顺序不能跳，因为：

| 如果…… | 后果 |
|---|---|
| 先写 Flutter，之后才换后端（如 PG → 文档型数据库） | Flutter 里所有调接口的代码**全部重写一遍** |
| 先写 Flutter，之后才加登录 | Flutter 的登录态、token 存储、请求鉴权**全部返工** |
| 后端接口还在变（A7 未实现、二期要改） | Flutter 跟着反复改，纯浪费 |

**结论：Flutter 是「接口冻结之后」的活，不是现在。**
正确顺序 = **先定后端与登录（二期） → 接口稳定 → 再开 Flutter**。

> 现在唯一值得做个 10 分钟准备的事：**装 Flutter 跑个 `flutter doctor`，确认环境没问题**。
> 剩下的等接口稳定再动。

---

## 4. 安装（Windows，本机适用）

### 4.1 前置条件

| 名称 | 用途 | 你现在有吗 |
|---|---|---|
| Git | Flutter 工具链依赖它 | ✅ 有（2.55.0） |
| Chrome 或 Edge | 跑「网页版」调试最省事 | ✅ 有 Edge |
| **Visual Studio 2022**（不是 VS Code） | 打 Windows 桌面程序需要，安装时勾选 **「使用 C++ 的桌面开发」** 工作负载 | ❓ 需检查，约 8 GB |
| **Android Studio + Android SDK** | 打 Android App 需要 | ❓ 需安装，约 10 GB |

> 只做「网页版调试」的话，前两项够用；要出手机/桌面安装包，后两项必须装。

### 4.2 安装 Flutter SDK

1. 打开官方文档 `https://docs.flutter.dev/get-started/install/windows`
2. 下载 **Flutter SDK 的 zip 包**（不推荐用 Microsoft Store 版）
3. **解压到路径不含空格和中文的位置**，例如 `C:\src\flutter`
   （**不要**放 `C:\Program Files\` —— 空格会导致构建失败）
4. 把 `C:\src\flutter\bin` **加进系统 PATH 环境变量**
5. **关掉再重开** Git Bash / 终端（PATH 才会生效）

### 4.3 ★ 国内必做：换镜像（否则下载极慢或失败）

这一步对你在国内非常关键。在 Windows「系统环境变量」里新增两条：

| 变量名 | 变量值 |
|---|---|
| `FLUTTER_STORAGE_BASE_URL` | `https://storage.flutter-io.cn` |
| `PUB_HOSTED_URL` | `https://pub.flutter-io.cn` |

设完重开终端。

### 4.4 自检

```
flutter --version
flutter doctor
```

`flutter doctor` 会逐项打勾或打叉（Android 工具链 / Visual Studio / 设备连接…）。
**打叉不一定是错**——比如你没有 Mac，iOS 那项必然是叉，这很正常。只修你确实要用的平台。

---

## 5. 第一个程序：跑起来

在 Git Bash 里（任选一个空目录）：

```
flutter create daily_health_log
cd daily_health_log
flutter run -d windows
```

- `flutter create` 项目名必须**全小写 + 下划线**（`daily_health_log`，不能写 `Daily-Health-Log`）
- `-d windows` 跑成 Windows 桌面程序；`-d chrome` 或 `-d edge` 跑成网页；`-d <设备ID>` 跑手机
- 用 `flutter devices` 看当前有哪些可用设备
- 跑起来后，把 `lib/main.dart` 里任意一句话改掉，按 `r` —— **热重载**，立刻生效

---

## 6. 现有网页代码能复用多少

| 资产 | 能否复用 | 说明 |
|---|---|---|
| HTML / CSS | ❌ **不能** | Flutter 不用 HTML/CSS，界面要用 Dart 的 Widget 重写 |
| `assets/js/*.js` 业务逻辑 | ❌ 不能直接搬 | 要按 Dart 语法重写（但**逻辑思路可以照抄**） |
| 接口契约 `api-contract.md`（A1~A10） | ✅ **100% 复用** | 接口地址、请求方法、字段名、成功/失败形状全都不变 |
| 数据模型（`db/schema.sql` 的列） | ✅ 复用 | 字段含义、取值范围、约束照搬 |
| 业务规则（卡路里估算、坚持率、健康分） | ✅ 算法复用 | 换算公式搬过去重写即可 |
| 配色 / 圆角 / 文案 | ✅ 复用 | 奶油色 + 绿色、圆角卡片、页脚文案，照设计重做一遍 |
| 后端（云函数 + 数据库） | ✅ 完全不动 | Flutter 只是换了个"客户端"，后端继续服务两边 |

**一句话**：Flutter 是「换一张脸」，不是「换一个身体」。身体（后端 + 接口 + 数据）保持不变。

---

## 7. 接口调用要注意的两件事

### 7.1 收到 CORS 的影响不同

你的云函数里有来源白名单校验（`originAllowed()`）：

| 客户端 | 会带 `Origin` 头吗 | 结果 |
|---|---|---|
| **Flutter 原生 App**（Windows / Android / iOS） | ❌ **不带** | 白名单逻辑对「无 Origin」直接放行 → **能直接调用** |
| **Flutter Web**（`flutter build web`） | ✅ 会带，且是站点来源 | 需要把该来源加进 `ALLOWED_ORIGINS`，否则 **403** |

### 7.2 用哪个网络库

Dart 侧用官方的 `http` 包，或功能更全的 `dio` 包。
和前端一样，**建议把「所有接口调用」收在单独一个文件里**（对应现在的 `assets/js/api-source.js`），
这样以后接口一改，只动一个地方。

---

## 8. 打包与发布

| 平台 | 命令 | 产物 | 额外门槛 |
|---|---|---|---|
| Windows | `flutter build windows` | `.exe` 目录 | 需 Visual Studio（§4.1） |
| Android | `flutter build apk` | `.apk` | 需 Android SDK；上架 Google Play 要开发者账号（一次性约 $25） |
| iOS | `flutter build ios` | `.ipa` | **必须在 Mac 上**，需 Xcode + **Apple 开发者账号（约 $99/年）** |
| Web | `flutter build web` | 静态文件 | 可扔到 GitHub Pages（但和 §GITHUB_DEPLOY 一样，后端仍在云上） |

> **iOS 是唯一的硬门槛**：没有 Mac 就打不出 iOS 包。别的平台你现在这台 Windows 都能做。

---

## 9. 学习路径建议（零基础版）

按这个顺序走，每一步都能自己验证：

1. **Dart 语言基础**（3~5 天）：变量、函数、类、`async/await`、`Future`。重点是 `async/await` —— 你现在的接口调用全是异步的。
2. **Widget 基础**（1 周）：`StatelessWidget` / `StatefulWidget`、`Column` / `Row` / `Container` / `ListView`。这是 Flutter 的"HTML"。
3. **状态管理入门**（3~5 天）：先用最朴素的 `setState`，别一上来就上 Provider / Riverpod / Bloc。
4. **网络请求**（2~3 天）：`http` 包 + JSON 解析 + 错误处理。把 A1~A10 挨个调一遍。
5. **本地存储**（1~2 天）：`shared_preferences`（简单键值）/ `sqflite`（本地数据库）。对应你现在的 `localStorage` 兜底机制。
6. **图表**（2~3 天）：`fl_chart` 包。对应你现在的 `chart.umd.js` 体重趋势图。
7. **打包发布**（1~2 天）：`flutter build`。

**总时长预期**：零基础到能出可用 App，大约 **1.5 ~ 2 个月**（每天 1~2 小时）。

---

## 10. 常见坑

| # | 坑 | 说明 |
|---|---|---|
| 1 | SDK 装在带空格的路径 | `C:\Program Files\flutter` 会构建失败。用 `C:\src\flutter` |
| 2 | 不换国内镜像 | 下载卡住/失败。设 `FLUTTER_STORAGE_BASE_URL` + `PUB_HOSTED_URL`（§4.3） |
| 3 | 项目名带大写或连字符 | `flutter create` 会直接报错，必须全小写下划线 |
| 4 | 装了 VS Code 以为够 | **不够**。Windows 桌面构建要的是 **Visual Studio 2022 + C++ 工作负载** |
| 5 | 忘记 `flutter doctor` | 装完就跑一次，比出问题后回头查快得多 |
| 6 | 一开始就上复杂状态管理 | 会淹没在概念里。先 `setState`，痛了再换 |
| 7 | `flutter upgrade` 随手就升 | 升级可能带来破坏性变更。**先能跑，再考虑升** |
| 8 | 3.47 起 Material/Cupertino 拆成独立包 | `material_ui` / `cupertino_ui` 可独立发布，但过渡期核心 SDK 里仍在。**照旧 `import 'package:flutter/material.dart';` 就行**，别被网上帖子绕晕 |
| 9 | 以为 Flutter 能直接读现有网页 | 不能。这是重写界面，不是打包网页 |
| 10 | 后端没定就先写 App | 见 §3，会返工 |

---

## 11. 现在的行动建议

| 优先级 | 动作 | 时机 |
|---|---|---|
| 🟡 可选 | 装 Flutter + 跑通 `flutter doctor`，确认环境 | 本周有空时，10 分钟 |
| 🔴 必须 | 先做**二期登录 + 数据层决策**（PG 还是文档型数据库） | 等额度周期 11-01 重置后 |
| 🟢 之后 | 接口冻结 → 正式开 Flutter | 二期收口后 |
| ⚪ 远期 | iOS 打包（需要 Mac + Apple 开发者账号） | 最后再说 |

**核心判断**：Flutter 本身不难，难的是**别在接口还会变的时候动手**。
把二期做扎实，Flutter 那一步会顺得多 —— 因为到时候你只需要"翻译界面"，不需要"重新想逻辑"。
