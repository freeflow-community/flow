import Foundation

/// Mirrors PROFILE_BIO_MAX / PROFILE_WEBSITE_MAX in `@flow/shared`, which is
/// where the server enforces them. Kept here so the sheets can show the limit
/// instead of failing the save.
let profileBioMax = 500
let profileWebsiteMax = 200

/// Expanded profiles (#220): the client-side half of the website allowlist.
///
/// The server is what keeps a hostile value out of the database — `PatchMeBody`
/// accepts an absolute `http`/`https` URL and nothing else. This function is
/// defence in depth at the point of use: a profile link is a string from
/// another user, so re-check the scheme before handing it to `Link` rather than
/// trusting whatever the row happens to hold. Returns nil for anything that is
/// not an absolute http(s) URL, and the caller then shows plain text.
func safeWebsiteURL(_ s: String) -> URL? {
    guard let url = URL(string: s), let scheme = url.scheme?.lowercased(),
          scheme == "http" || scheme == "https", url.host?.isEmpty == false
    else { return nil }
    return url
}
