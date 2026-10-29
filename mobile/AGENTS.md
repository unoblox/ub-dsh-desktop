# 手机 App 约束

继承根目录规则。设计、构建与发布见 [手机 App 说明](../docs/mobile-apps.md)。

## 定位

- 手机 App 是桌面端的配套客户端：智能体、Harness、项目文件和 API key 都留在电脑上。不在手机上运行 Agent runtime，不另建手机版业务前端。
- 对话界面由桌面手机桥接服务提供（`src/main/mobile/lan-mobile-pages.ts`）。界面或 API 变化改桌面端，不在 App 里复制一份页面或协议。
- App 只负责原生部分：扫码、已配对电脑列表、启动时重开上次的电脑、连接失败提示、图标与权限说明。

## 安全与隐私

- 只打开 `mobile/shared/pairing-links.json` 描述的地址（私网 IPv4 的 HTTP、桌面隧道域名的 HTTPS）。改动 `Links.kt` / `Links.swift` 必须同步修改该文件，三端测试（Android、iOS、`test/mobile-pairing-contract.test.ts`）一起通过。
- 页面不获得任何原生桥：不加 `addJavascriptInterface`、`WKScriptMessageHandler` 或自定义 URL scheme。离开已配对电脑的链接交给系统浏览器。
- 不加入统计、崩溃上报、广告或推送 SDK。App 只与已配对的电脑通信；如需推送，先更新设计文档与 `docs/privacy.md` 并说明数据内容。
- Cookie、已配对电脑列表不进备份，不写日志。测试与示例只用文档保留地址或私网示例地址，不放真实 token。

## 代码

- Android：Kotlin + Views，`minSdk 26`；依赖保持精简，扫码用 ZXing（不依赖 Google Play 服务）。iOS：SwiftUI + WKWebView，iOS 16+，扫码用 AVFoundation，不引入第三方库。
- iOS 工程由 `mobile/ios/project.yml` 经 XcodeGen 生成，`.xcodeproj` 不提交。App 图标由 `scripts/generate-brand-assets.mjs` 生成，不手改。
- 文案中英文同批维护（Android `values` / `values-zh`，iOS `en.lproj` / `zh-Hans.lproj`）。品牌名 `unoblox` 一律小写。

## 验证

- 改 App：`./gradlew testDebugUnitTest lintDebug assembleDebug`（mobile/android）；iOS 单元测试在 macOS 上运行，Linux 上无法编译 UIKit/SwiftUI，以 CI 为准。
- 改桥接或配对链接：再跑 `npx vitest run test/mobile-pairing-contract.test.ts test/lan-mobile-bridge.test.ts`。
- `.github/workflows/build-mobile.yml` 在模拟器中与真实桥接配对；它不覆盖摄像头扫码、真机 Wi-Fi 与隧道 PIN，交付说明须写明这些未验证项。
