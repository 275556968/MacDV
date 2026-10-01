// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MacDV",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "MacDV", targets: ["MacDV"])
    ],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "MacDV",
            dependencies: [],
            path: "Sources/MacDV"
        )
    ]
)
