import Foundation

/// Persisted for the whole review, including recorder restarts between suites.
struct FocusPolicy {
    enum Action: String { case focused, initial, restore, wait, abort }
    struct State: Codable {
        var initialized = false
        var attempts = 0
        var lastAttempt: Double? = nil
        var aborted = false
    }
    let url: URL
    private(set) var state: State
    var abortURL: URL { url.appendingPathExtension("aborted") }

    init(url: URL) throws {
        self.url = url
        if FileManager.default.fileExists(atPath: url.path) {
            let data = try Data(contentsOf: url)
            if let old = Int(String(data: data, encoding: .utf8) ?? "") {
                state = State(initialized: true, attempts: old)
            } else {
                state = try JSONDecoder().decode(State.self, from: data)
            }
        } else {
            state = State()
        }
        guard (0...3).contains(state.attempts),
              state.lastAttempt == nil || state.lastAttempt!.isFinite else {
            throw NSError(domain: "SpecsReview", code: 7,
                          userInfo: [NSLocalizedDescriptionKey: "Invalid persisted focus policy"])
        }
        if FileManager.default.fileExists(atPath: abortURL.path) { state.aborted = true }
    }

    mutating func request(now: Double, focused: Bool) throws -> Action {
        guard now.isFinite else { throw NSError(domain: "SpecsReview", code: 7) }
        if state.aborted { return .abort }
        if !state.initialized {
            state.initialized = true
            try save()
            return focused ? .focused : .initial
        }
        if focused { return .focused }
        if state.attempts >= 3 {
            state.aborted = true
            try save()
            try "Focus limit reached; explicit user authorization is required to resume.".write(
                to: abortURL, atomically: true, encoding: .utf8)
            return .abort
        }
        if let last = state.lastAttempt, now - last < 1 { return .wait }
        state.attempts += 1
        state.lastAttempt = now
        try save()
        return .restore
    }

    private func save() throws {
        try JSONEncoder().encode(state).write(to: url, options: .atomic)
    }
}
