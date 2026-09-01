import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // 다른 앱의 "다음으로 열기"로 들어온 PDF 는 대기열에 넣고 여기서 끝낸다(딥링크가 아니다).
        if url.isFileURL && MdtlIntake.stage(url) { return true }
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

/// 다른 앱에서 넘어온 PDF 를 웹 레이어가 읽는 대기열에 넣는다.
///
/// 대기열 = Caches/mdtl-intake/ + 파일 목록 intake.json. 이 위치는 Capacitor Filesystem 의
/// `Directory.CACHE` 와 같은 곳이라 assets/site.js 의 `mdtlCheckIntake()` 가 플러그인 추가 없이 읽는다.
/// 네이티브에서 JS 를 호출하지 않고 파일로 남기는 이유: 콜드스타트에서는 URL 이 웹뷰 스크립트보다
/// 먼저 도착해 이벤트가 사라진다. 파일로 두면 페이지가 뜬 뒤 스스로 확인한다.
enum MdtlIntake {

    private static let dirName = "mdtl-intake"
    private static let listName = "intake.json"

    /// 파일 URL 을 캐시 대기열로 복사한다. 처리했으면 true.
    static func stage(_ url: URL) -> Bool {
        let fm = FileManager.default
        guard let caches = fm.urls(for: .cachesDirectory, in: .userDomainMask).first else { return false }
        let dir = caches.appendingPathComponent(dirName, isDirectory: true)

        // 원본 위치에서 여는 경우(LSSupportsOpeningDocumentsInPlace) 보안 스코프를 열어야 읽힌다
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        do {
            try? fm.removeItem(at: dir)   // 소비되지 않은 이전 파일이 되살아나지 않게
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            let name = safeName(url.lastPathComponent)
            try Data(contentsOf: url).write(to: dir.appendingPathComponent(name))
            let list = try JSONSerialization.data(withJSONObject: ["files": [name]])
            try list.write(to: dir.appendingPathComponent(listName))
            return true
        } catch {
            try? fm.removeItem(at: dir)
            return false
        }
    }

    /// 경로 구분자를 걷어내고 .pdf 확장자를 보장한다.
    static func safeName(_ raw: String) -> String {
        var name = (raw as NSString).lastPathComponent
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { name = "shared.pdf" }
        if !name.lowercased().hasSuffix(".pdf") { name += ".pdf" }
        return name
    }
}
