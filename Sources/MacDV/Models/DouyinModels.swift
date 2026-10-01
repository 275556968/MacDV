import Foundation

// MARK: - Feed Response
public struct FeedResponse: Codable {
    public let statusCode: Int?
    public let minCursor: Int64?
    public let maxCursor: Int64?
    public let hasMore: Int?
    public let awemeList: [AwemeItem]?
    
    enum CodingKeys: String, CodingKey {
        case statusCode = "status_code"
        case minCursor = "min_cursor"
        case maxCursor = "max_cursor"
        case hasMore = "has_more"
        case awemeList = "aweme_list"
    }
}

// MARK: - Aweme Item (Video Model)
public struct AwemeItem: Codable, Identifiable {
    public var id: String { awemeId }
    public let awemeId: String
    public let desc: String?
    public let createTime: Int64?
    public let author: AuthorInfo?
    public let video: VideoInfo?
    public let statistics: StatisticsInfo?
    public let music: MusicInfo?
    
    enum CodingKeys: String, CodingKey {
        case awemeId = "aweme_id"
        case desc
        case createTime = "create_time"
        case author
        case video
        case statistics
        case music
    }
    
    public var isHorizontal: Bool {
        video?.isHorizontal ?? true
    }
    
    public var highestQualityUrl: URL? {
        video?.highestQualityUrl ?? video?.playUrl
    }
    
    public var qualityLabel: String {
        video?.highestQualityLabel ?? "1080P 超清"
    }
}

// MARK: - Author Info
public struct AuthorInfo: Codable {
    public let uid: String?
    public let secUid: String?
    public let nickname: String?
    public let signature: String?
    public let avatarThumb: UrlListHolder?
    public let avatarMedium: UrlListHolder?
    public let followerCount: Int64?
    public let totalFavorited: Int64?
    
    enum CodingKeys: String, CodingKey {
        case uid
        case secUid = "sec_uid"
        case nickname
        case signature
        case avatarThumb = "avatar_thumb"
        case avatarMedium = "avatar_medium"
        case followerCount = "follower_count"
        case totalFavorited = "total_favorited"
    }
    
    public var bestAvatarUrl: URL? {
        if let first = avatarMedium?.urlList?.first, let url = URL(string: first) {
            return url
        }
        if let first = avatarThumb?.urlList?.first, let url = URL(string: first) {
            return url
        }
        return nil
    }
}

// MARK: - Video BitRate Item
public struct BitRateItem: Codable {
    public let gearName: String?
    public let qualityType: Int?
    public let bitRate: Int64?
    public let fps: Int?
    public let isH265: Int?
    public let playAddr: UrlListHolder?
    
    enum CodingKeys: String, CodingKey {
        case gearName = "gear_name"
        case qualityType = "quality_type"
        case bitRate = "bit_rate"
        case fps = "FPS"
        case isH265 = "is_h265"
        case playAddr = "play_addr"
    }
    
    public var playUrl: URL? {
        guard let list = playAddr?.urlList, !list.isEmpty else { return nil }
        
        // Priority 1: Official play redirector (/aweme/v1/play/)
        if let playEndpoint = list.first(where: { $0.contains("/aweme/v1/play/") && !$0.contains("/dash/") }) {
            return URL(string: playEndpoint)
        }
        
        // Priority 2: Standard CDN URLs without "-prime"
        if let standardUrl = list.first(where: { !$0.contains("-prime") && ($0.starts(with: "http://") || $0.starts(with: "https://")) }) {
            return URL(string: standardUrl)
        }
        
        // Priority 3: Any play redirector
        if let playEndpoint = list.first(where: { $0.contains("/aweme/v1/play/") }) {
            return URL(string: playEndpoint)
        }
        
        // Fallback
        for item in list {
            if item.starts(with: "http://") || item.starts(with: "https://") {
                return URL(string: item)
            }
        }
        return nil
    }
    
    public var resolutionLabel: String {
        let gear = (gearName ?? "").lowercased()
        if gear.contains("4k") || gear.contains("2160") { return "4K 极清" }
        if gear.contains("2k") || gear.contains("1440") { return "2K 超清" }
        if gear.contains("1080") { return "1080P 超清" }
        if gear.contains("720") { return "720P 高清" }
        if gear.contains("540") { return "540P 标清" }
        if let w = playAddr?.width, let h = playAddr?.height, h > 0 {
            let maxDim = max(w, h)
            if maxDim >= 2500 { return "2K 超清" }
            if maxDim >= 1800 { return "1080P 超清" }
            if maxDim >= 1200 { return "720P 高清" }
            if maxDim >= 800 { return "540P 标清" }
        }
        return "1080P"
    }
}

// MARK: - Video Info
public struct VideoInfo: Codable {
    public let playAddr: UrlListHolder?
    public let bitRate: [BitRateItem]?
    public let cover: UrlListHolder?
    public let dynamicCover: UrlListHolder?
    public let duration: Int?
    public let width: Int?
    public let height: Int?
    public let ratio: String?
    
    enum CodingKeys: String, CodingKey {
        case playAddr = "play_addr"
        case bitRate = "bit_rate"
        case cover
        case dynamicCover = "dynamic_cover"
        case duration
        case width
        case height
        case ratio
    }
    
    public var playUrl: URL? {
        guard let list = playAddr?.urlList, !list.isEmpty else { return nil }
        
        // Priority 1: Official play redirector (always 200 OK)
        if let playEndpoint = list.first(where: { $0.contains("/aweme/v1/play/") }) {
            return URL(string: playEndpoint)
        }
        
        // Priority 2: Standard CDN URLs without "-prime"
        if let standardUrl = list.first(where: { !$0.contains("-prime") && ($0.starts(with: "http://") || $0.starts(with: "https://")) }) {
            return URL(string: standardUrl)
        }
        
        // Fallback: any valid URL
        for item in list {
            if item.starts(with: "http://") || item.starts(with: "https://") {
                return URL(string: item)
            }
        }
        return nil
    }
    
    // Pick the item with the highest resolution and bitrate
    public var highestBitRateItem: BitRateItem? {
        guard let list = bitRate, !list.isEmpty else { return nil }
        
        let valid = list.filter { $0.playUrl != nil }
        let candidates = valid.isEmpty ? list : valid
        
        return candidates.max { a, b in
            let aScore = scoreForBitRate(a)
            let bScore = scoreForBitRate(b)
            if aScore != bScore {
                return aScore < bScore
            }
            return (a.bitRate ?? 0) < (b.bitRate ?? 0)
        }
    }
    
    private func scoreForBitRate(_ item: BitRateItem) -> Int {
        let gear = (item.gearName ?? "").lowercased()
        if gear.contains("4k") || gear.contains("2160") { return 4000 }
        if gear.contains("2k") || gear.contains("1440") { return 2500 }
        if gear.contains("1080") { return 1080 }
        if gear.contains("720") { return 720 }
        if gear.contains("540") { return 540 }
        if let h = item.playAddr?.height, let w = item.playAddr?.width {
            return max(w, h)
        }
        return 0
    }
    
    public var highestQualityUrl: URL? {
        if let top = highestBitRateItem, let url = top.playUrl {
            return url
        }
        return playUrl
    }
    
    public var highestQualityLabel: String {
        highestBitRateItem?.resolutionLabel ?? "1080P 超清"
    }
    
    public var isHorizontal: Bool {
        guard let w = width, let h = height, h > 0 else { return true }
        return w >= h
    }
    
    public var coverUrl: URL? {
        guard let list = cover?.urlList else { return nil }
        if let first = list.first {
            return URL(string: first)
        }
        return nil
    }
}

// MARK: - Url List Holder (for Cover, Avatar, PlayAddr)
public struct UrlListHolder: Codable {
    public let uri: String?
    public let urlList: [String]?
    public let width: Int?
    public let height: Int?
    
    enum CodingKeys: String, CodingKey {
        case uri
        case urlList = "url_list"
        case width
        case height
    }
}

// MARK: - Statistics Info
public struct StatisticsInfo: Codable {
    public let diggCount: Int64?
    public let commentCount: Int64?
    public let collectCount: Int64?
    public let shareCount: Int64?
    public let playCount: Int64?
    
    enum CodingKeys: String, CodingKey {
        case diggCount = "digg_count"
        case commentCount = "comment_count"
        case collectCount = "collect_count"
        case shareCount = "share_count"
        case playCount = "play_count"
    }
    
    public var formattedDiggCount: String { formatNumber(diggCount ?? 0) }
    public var formattedCommentCount: String { formatNumber(commentCount ?? 0) }
    public var formattedCollectCount: String { formatNumber(collectCount ?? 0) }
    public var formattedShareCount: String { formatNumber(shareCount ?? 0) }
    
    private func formatNumber(_ n: Int64) -> String {
        if n >= 100000000 {
            return String(format: "%.1f亿", Double(n) / 100000000.0)
        } else if n >= 10000 {
            return String(format: "%.1f万", Double(n) / 10000.0)
        } else {
            return "\(n)"
        }
    }
}

// MARK: - Music Info
public struct MusicInfo: Codable {
    public let id: Int64?
    public let title: String?
    public let author: String?
    public let playUrl: UrlListHolder?
    
    enum CodingKeys: String, CodingKey {
        case id
        case title
        case author
        case playUrl = "play_url"
    }
}

// MARK: - Comment Response
public struct CommentListResponse: Codable {
    public let statusCode: Int?
    public let comments: [CommentItem]?
    public let cursor: Int64?
    public let hasMore: Int?
    public let total: Int64?
    
    enum CodingKeys: String, CodingKey {
        case statusCode = "status_code"
        case comments
        case cursor
        case hasMore = "has_more"
        case total
    }
}

// MARK: - Comment Item
public struct CommentItem: Codable, Identifiable {
    public var id: String { cid }
    public let cid: String
    public let text: String?
    public let createTime: Int64?
    public let diggCount: Int64?
    public let replyCommentTotal: Int64?
    public let user: AuthorInfo?
    
    enum CodingKeys: String, CodingKey {
        case cid
        case text
        case createTime = "create_time"
        case diggCount = "digg_count"
        case replyCommentTotal = "reply_comment_total"
        case user
    }
    
    public var formattedTime: String {
        guard let ct = createTime else { return "" }
        let date = Date(timeIntervalSince1970: TimeInterval(ct))
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}
