// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MyChat",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "7.0.0"),
    ],
    targets: [
        .executableTarget(
            name: "MyChat",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
            ]
        ),
        .testTarget(
            name: "MyChatTests",
            dependencies: ["MyChat"]
        ),
    ]
)
